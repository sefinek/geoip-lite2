const { readFileSync } = require('node:fs');
const fsPromises = require('node:fs/promises');
const { basename, join, resolve } = require('node:path');
const { isIP } = require('node:net');
const { aton4, aton6, cmp6, removeNullTerminator, readIp6, createGeoData, populateGeoDataFromLocation } = require('./scripts/utils.js');
const fsWatcher = require('./scripts/fsWatcher.js');
const { version } = require('./package.json');

const WATCHER_NAME = 'dataWatcher';

const GEO_DATA_DIR = resolve(__dirname, globalThis.geoDataDir || process.env.GEOIP_DATA_DIR || './data/');
const DATA_FILES = {
	city: join(GEO_DATA_DIR, 'geoip-city.dat'),
	city6: join(GEO_DATA_DIR, 'geoip-city6.dat'),
	cityNames: join(GEO_DATA_DIR, 'geoip-city-names.dat'),
	country: join(GEO_DATA_DIR, 'geoip-country.dat'),
	country6: join(GEO_DATA_DIR, 'geoip-country6.dat'),
};
const WATCHED_DATA_FILES = Object.values(DATA_FILES).map(filePath => basename(filePath));

const PRIVATE_RANGE4 = [
	[aton4('10.0.0.0'), aton4('10.255.255.255')],
	[aton4('172.16.0.0'), aton4('172.31.255.255')],
	[aton4('192.168.0.0'), aton4('192.168.255.255')],
];

const RECORD_SIZE = 10;
const RECORD_SIZE6 = 34;

const CONF4 = {
	firstIP: null,
	lastIP: null,
	lastRecordIdx: 0,
	locationBuffer: null,
	locationRecordSize: 88,
	mainBuffer: null,
	recordSize: 24,
};

const CONF6 = {
	firstIP: null,
	lastIP: null,
	lastRecordIdx: 0,
	mainBuffer: null,
	recordSize: 48,
};

let cache4 = { ...CONF4 };
let cache6 = { ...CONF6 };

const reportReloadError = err => err ? console.error('[geoip-lite2] Failed to reload GeoIP data:', err) : null;

const lookup4 = ip => {
	if (!cache4.mainBuffer) return null;

	const buffer = cache4.mainBuffer;
	const locBuffer = cache4.locationBuffer;
	const recordSize = cache4.recordSize;
	const locRecordSize = cache4.locationRecordSize;

	if (ip > cache4.lastIP || ip < cache4.firstIP) return null;
	for (let i = 0; i < PRIVATE_RANGE4.length; i++) {
		if (ip >= PRIVATE_RANGE4[i][0] && ip <= PRIVATE_RANGE4[i][1]) return null;
	}

	const geoData = createGeoData();
	let fline = 0;
	let cline = cache4.lastRecordIdx;

	while (true) {
		const line = (fline + cline) >>> 1;
		const offset = line * recordSize;
		const floor = buffer.readUInt32BE(offset);
		const ceil = buffer.readUInt32BE(offset + 4);

		if (floor <= ip && ceil >= ip) {
			if (recordSize === RECORD_SIZE) {
				geoData.country = removeNullTerminator(buffer.toString('utf8', offset + 8, offset + 10));
			} else {
				const locId = buffer.readUInt32BE(offset + 8);
				populateGeoDataFromLocation({
					geoData,
					locationBuffer: locBuffer,
					locationRecordSize: locRecordSize,
					locationId: locId,
					coordBuffer: buffer,
					latitudeOffset: offset + 12,
					longitudeOffset: offset + 16,
					areaOffset: offset + 20,
				});
			}

			return geoData;
		} else if (fline === cline) {
			return null;
		} else if (fline === cline - 1) {
			fline = cline;
		} else if (floor > ip) {
			cline = line;
		} else {
			fline = line;
		}
	}
};

const lookup6 = ip => {
	if (!cache6.mainBuffer) return null;
	if (cmp6(ip, cache6.lastIP) > 0 || cmp6(ip, cache6.firstIP) < 0) return null;

	const buffer = cache6.mainBuffer;
	const recordSize = cache6.recordSize;
	const locBuffer = cache4.locationBuffer;
	const locRecordSize = cache4.locationRecordSize;

	const geoData = createGeoData();
	let fline = 0;
	let cline = cache6.lastRecordIdx;

	while (true) {
		const line = (fline + cline) >>> 1;
		const floor = readIp6(buffer, line, recordSize, 0);
		const ceil = readIp6(buffer, line, recordSize, 1);
		const floorCmp = cmp6(floor, ip);
		const ceilCmp = cmp6(ceil, ip);

		if (floorCmp <= 0 && ceilCmp >= 0) {
			const offset = line * recordSize;
			if (recordSize === RECORD_SIZE6) {
				geoData.country = removeNullTerminator(buffer.toString('utf8', offset + 32, offset + 34));
			} else {
				const locId = buffer.readUInt32BE(offset + 32);
				populateGeoDataFromLocation({
					geoData,
					locationBuffer: locBuffer,
					locationRecordSize: locRecordSize,
					locationId: locId,
					coordBuffer: buffer,
					latitudeOffset: offset + 36,
					longitudeOffset: offset + 40,
					areaOffset: offset + 44,
				});
			}
			return geoData;
		} else if (fline === cline) {
			return null;
		} else if (fline === cline - 1) {
			fline = cline;
		} else if (floorCmp > 0) {
			cline = line;
		} else {
			fline = line;
		}
	}
};

const V4_MAPPED_RE = /^(?:0:0:0:0:0:ffff:|::ffff:)(.+)$/i;
const get4mapped = ip => {
	const match = V4_MAPPED_RE.exec(ip);
	return match ? match[1] : null;
};

const isExpectedMissingDataError = err => err?.code === 'ENOENT' || err?.code === 'EBADF';

const finalizeCache4 = cache => {
	cache.lastRecordIdx = (cache.mainBuffer.length / cache.recordSize) - 1;
	cache.lastIP = cache.mainBuffer.readUInt32BE((cache.lastRecordIdx * cache.recordSize) + 4);
	cache.firstIP = cache.mainBuffer.readUInt32BE(0);
	return cache;
};

const finalizeCache6 = cache => {
	cache.lastRecordIdx = (cache.mainBuffer.length / cache.recordSize) - 1;
	cache.lastIP = readIp6(cache.mainBuffer, cache.lastRecordIdx, cache.recordSize, 1);
	cache.firstIP = readIp6(cache.mainBuffer, 0, cache.recordSize, 0);
	return cache;
};

const preloadAsync = async () => {
	const newCache = { ...CONF4 };

	try {
		const cityNamesBuffer = await fsPromises.readFile(DATA_FILES.cityNames);
		if (cityNamesBuffer.length > 0) {
			newCache.locationBuffer = cityNamesBuffer;
			newCache.mainBuffer = await fsPromises.readFile(DATA_FILES.city);
		} else {
			newCache.recordSize = RECORD_SIZE;
			newCache.mainBuffer = await fsPromises.readFile(DATA_FILES.country);
		}
	} catch (err) {
		if (!isExpectedMissingDataError(err)) throw err;
		newCache.recordSize = RECORD_SIZE;
		newCache.mainBuffer = await fsPromises.readFile(DATA_FILES.country);
	}

	cache4 = finalizeCache4(newCache);
};

const preload = callback => {
	if (typeof callback === 'function') return preloadAsync().then(() => callback()).catch(callback);

	const newCache = { ...CONF4 };
	try {
		const cityNamesBuffer = readFileSync(DATA_FILES.cityNames);
		if (cityNamesBuffer.length > 0) {
			newCache.locationBuffer = cityNamesBuffer;
			newCache.mainBuffer = readFileSync(DATA_FILES.city);
		} else {
			newCache.recordSize = RECORD_SIZE;
			newCache.mainBuffer = readFileSync(DATA_FILES.country);
		}
	} catch (err) {
		if (!isExpectedMissingDataError(err)) throw err;
		newCache.recordSize = RECORD_SIZE;
		newCache.mainBuffer = readFileSync(DATA_FILES.country);
	}

	cache4 = finalizeCache4(newCache);
};

const preload6Async = async () => {
	const newCache = { ...CONF6 };

	try {
		const city6Buffer = await fsPromises.readFile(DATA_FILES.city6);
		if (city6Buffer.length > 0) {
			newCache.mainBuffer = city6Buffer;
		} else {
			newCache.recordSize = RECORD_SIZE6;
			newCache.mainBuffer = await fsPromises.readFile(DATA_FILES.country6);
		}
	} catch (err) {
		if (!isExpectedMissingDataError(err)) throw err;
		newCache.recordSize = RECORD_SIZE6;
		newCache.mainBuffer = await fsPromises.readFile(DATA_FILES.country6);
	}

	cache6 = finalizeCache6(newCache);
};

const preload6 = callback => {
	if (typeof callback === 'function') return preload6Async().then(() => callback()).catch(callback);

	const newCache = { ...CONF6 };
	try {
		const city6Buffer = readFileSync(DATA_FILES.city6);
		if (city6Buffer.length > 0) {
			newCache.mainBuffer = city6Buffer;
		} else {
			newCache.recordSize = RECORD_SIZE6;
			newCache.mainBuffer = readFileSync(DATA_FILES.country6);
		}
	} catch (err) {
		if (!isExpectedMissingDataError(err)) throw err;
		newCache.recordSize = RECORD_SIZE6;
		newCache.mainBuffer = readFileSync(DATA_FILES.country6);
	}

	cache6 = finalizeCache6(newCache);
};

const runAsyncReload = callback => {
	Promise.all([preloadAsync(), preload6Async()])
		.then(() => callback())
		.catch(callback);
};

module.exports = {
	lookup: ip => {
		if (ip === undefined || ip === null) throw new TypeError('lookup(ip) requires an IP address');
		if (typeof ip === 'number') {
			if (!Number.isFinite(ip) || !Number.isInteger(ip) || ip < 0 || ip > 0xFFFFFFFF) return null;
			return lookup4(ip);
		}

		const ipVersion = isIP(ip);
		if (ipVersion === 4) {
			return lookup4(aton4(ip));
		} else if (ipVersion === 6) {
			const ipv4 = get4mapped(ip);
			return ipv4 ? lookup4(aton4(ipv4)) : lookup6(aton6(ip));
		}

		return null;
	},
	startWatchingDataUpdate: callback => {
		fsWatcher.makeFsWatchFilter(WATCHER_NAME, GEO_DATA_DIR, WATCHED_DATA_FILES, 60 * 1000, change => {
			if (change?.file) {
				console.log(`[geoip-lite2] Detected change in "${change.file}", reloading data...`);
			} else {
				console.log('[geoip-lite2] Detected change in GeoIP data directory, reloading data...');
			}

			if (typeof callback === 'function') {
				runAsyncReload(callback);
			} else {
				runAsyncReload(reportReloadError);
			}
		});
	},
	stopWatchingDataUpdate: () => fsWatcher.stopWatching(WATCHER_NAME),
	clear: () => {
		cache4 = { ...CONF4 };
		cache6 = { ...CONF6 };
	},
	reloadDataSync: () => {
		void preload();
		void preload6();
	},
	reloadData: callback => {
		if (typeof callback === 'function') {
			runAsyncReload(callback);
			return;
		}

		return new Promise((resolve, reject) => {
			runAsyncReload(err => {
				if (err) reject(err); else resolve();
			});
		});
	},

	version,
};

void preload();
void preload6();
