const { openSync, fstatSync, readSync, closeSync } = require('node:fs');
const fsPromises = require('node:fs/promises');
const { basename, join, resolve } = require('node:path');
const { isIP } = require('node:net');
const { aton4, aton6, cmp6, removeNullTerminator, readIp6, createGeoData, populateGeoDataFromLocation } = require('./scripts/utils.js');
const fsWatcher = require('./scripts/fsWatcher.js');
const { version } = require('./package.json');

const watcherName = 'dataWatcher';
const reportReloadError = err => {
	if (err) console.error('[geoip-lite2] Failed to reload GeoIP data:', err);
};

const geoDataDir = resolve(
	__dirname,
	globalThis['geoDataDir'] || process.env.GEOIP_DATA_DIR || './data/'
);

const dataFiles = {
	city: join(geoDataDir, 'geoip-city.dat'),
	city6: join(geoDataDir, 'geoip-city6.dat'),
	cityNames: join(geoDataDir, 'geoip-city-names.dat'),
	country: join(geoDataDir, 'geoip-country.dat'),
	country6: join(geoDataDir, 'geoip-country6.dat'),
};
const watchedDataFiles = Object.values(dataFiles).map(filePath => basename(filePath));

const privateRange4 = [
	[aton4('10.0.0.0'), aton4('10.255.255.255')],
	[aton4('172.16.0.0'), aton4('172.31.255.255')],
	[aton4('192.168.0.0'), aton4('192.168.255.255')],
];

const conf4 = {
	firstIP: null,
	lastIP: null,
	lastRecordIdx: 0,
	locationBuffer: null,
	locationRecordSize: 88,
	mainBuffer: null,
	recordSize: 24,
};

const conf6 = {
	firstIP: null,
	lastIP: null,
	lastRecordIdx: 0,
	mainBuffer: null,
	recordSize: 48,
};

let cache4 = { ...conf4 };
let cache6 = { ...conf6 };

const RECORD_SIZE = 10;
const RECORD_SIZE6 = 34;

const lookup4 = ip => {
	if (!cache4.mainBuffer) return null;

	let fline = 0;
	let cline = cache4.lastRecordIdx;
	let floor;
	let ceil;
	let line, locId;

	const buffer = cache4.mainBuffer;
	const locBuffer = cache4.locationBuffer;
	const privateRange = privateRange4;
	const recordSize = cache4.recordSize;
	const locRecordSize = cache4.locationRecordSize;

	if (ip > cache4.lastIP || ip < cache4.firstIP) return null;
	for (let i = 0; i < privateRange.length; i++) {
		if (ip >= privateRange[i][0] && ip <= privateRange[i][1]) return null;
	}

	const geoData = createGeoData();

	while (true) {
		line = Math.round((cline - fline) / 2) + fline;
		const offset = line * recordSize;
		floor = buffer.readUInt32BE(offset);
		ceil = buffer.readUInt32BE(offset + 4);

		if (floor <= ip && ceil >= ip) {
			if (recordSize === RECORD_SIZE) {
				geoData.country = removeNullTerminator(buffer.toString('utf8', offset + 8, offset + 10));
			} else {
				locId = buffer.readUInt32BE(offset + 8);
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
		} else if (fline === (cline - 1)) {
			if (line === fline) {
				fline = cline;
			} else {
				cline = fline;
			}
		} else if (floor > ip) {
			cline = line;
		} else if (ceil < ip) {
			fline = line;
		}
	}
};

const lookup6 = ip => {
	if (!cache6.mainBuffer) return null;

	const buffer = cache6.mainBuffer;
	const recordSize = cache6.recordSize;
	const locBuffer = cache4.locationBuffer;
	const locRecordSize = cache4.locationRecordSize;

	let fline = 0;
	let cline = cache6.lastRecordIdx;
	let floor;
	let ceil;
	let line, locId;

	if (cmp6(ip, cache6.lastIP) > 0 || cmp6(ip, cache6.firstIP) < 0) return null;

	const geoData = createGeoData();

	while (true) {
		line = Math.round((cline - fline) / 2) + fline;
		floor = readIp6(buffer, line, recordSize, 0);
		ceil = readIp6(buffer, line, recordSize, 1);

		if (cmp6(floor, ip) <= 0 && cmp6(ceil, ip) >= 0) {
			const offset = line * recordSize;
			if (recordSize === RECORD_SIZE6) {
				geoData.country = removeNullTerminator(buffer.toString('utf8', offset + 32, offset + 34));
			} else {
				locId = buffer.readUInt32BE(offset + 32);
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
		} else if (fline === (cline - 1)) {
			if (line === fline) {
				fline = cline;
			} else {
				cline = fline;
			}
		} else if (cmp6(floor, ip) > 0) {
			cline = line;
		} else if (cmp6(ceil, ip) < 0) {
			fline = line;
		}
	}
};

const V6_PREFIX_1 = '0:0:0:0:0:FFFF:';
const V6_PREFIX_2 = '::FFFF:';
const get4mapped = ip => {
	const ipv6 = ip.toUpperCase();
	if (ipv6.startsWith(V6_PREFIX_1)) return ipv6.substring(V6_PREFIX_1.length);
	if (ipv6.startsWith(V6_PREFIX_2)) return ipv6.substring(V6_PREFIX_2.length);
	return null;
};

const readFileBuffer = async filePath => {
	const buffer = await fsPromises.readFile(filePath);
	return { buffer, size: buffer.length };
};

const isExpectedMissingDataError = err => err?.code === 'ENOENT' || err?.code === 'EBADF';

const preloadAsync = async () => {
	const asyncCache = { ...conf4 };
	let mainData;

	try {
		const cityNamesData = await readFileBuffer(dataFiles.cityNames);
		if (cityNamesData.size === 0) {
			const emptyFileError = new Error('geoip-city-names.dat is empty');
			emptyFileError.code = 'ENOENT';
			throw emptyFileError;
		}

		asyncCache.locationBuffer = cityNamesData.buffer;
		mainData = await readFileBuffer(dataFiles.city);
	} catch (err) {
		if (!isExpectedMissingDataError(err)) throw err;
		asyncCache.locationBuffer = null;
		mainData = await readFileBuffer(dataFiles.country);
		asyncCache.recordSize = RECORD_SIZE;
	}

	asyncCache.mainBuffer = mainData.buffer;
	asyncCache.lastRecordIdx = (mainData.size / asyncCache.recordSize) - 1;
	asyncCache.lastIP = asyncCache.mainBuffer.readUInt32BE((asyncCache.lastRecordIdx * asyncCache.recordSize) + 4);
	asyncCache.firstIP = asyncCache.mainBuffer.readUInt32BE(0);
	cache4 = asyncCache;
};

const preload = callback => {
	if (typeof callback === 'function') {
		preloadAsync().then(() => callback()).catch(callback);
	} else {
		let datFile;
		let datSize;
		try {
			datFile = openSync(dataFiles.cityNames, 'r');
			datSize = fstatSync(datFile).size;
			if (datSize === 0) {
				closeSync(datFile);
				datFile = openSync(dataFiles.country, 'r');
				datSize = fstatSync(datFile).size;
				cache4.recordSize = RECORD_SIZE;
			} else {
				cache4.locationBuffer = Buffer.alloc(datSize);
				readSync(datFile, cache4.locationBuffer, 0, datSize, 0);
				closeSync(datFile);

				datFile = openSync(dataFiles.city, 'r');
				datSize = fstatSync(datFile).size;
			}
		} catch (err) {
			if (err.code !== 'ENOENT' && err.code !== 'EBADF') {
				throw err;
			}

			cache4.locationBuffer = null;
			datFile = openSync(dataFiles.country, 'r');
			datSize = fstatSync(datFile).size;
			cache4.recordSize = RECORD_SIZE;
		}

		cache4.mainBuffer = Buffer.alloc(datSize);
		readSync(datFile, cache4.mainBuffer, 0, datSize, 0);
		closeSync(datFile);

		cache4.lastRecordIdx = (datSize / cache4.recordSize) - 1;
		cache4.lastIP = cache4.mainBuffer.readUInt32BE((cache4.lastRecordIdx * cache4.recordSize) + 4);
		cache4.firstIP = cache4.mainBuffer.readUInt32BE(0);
	}
};

const preload6Async = async () => {
	const asyncCache6 = { ...conf6 };
	let mainData;

	try {
		const cityData = await readFileBuffer(dataFiles.city6);
		if (cityData.size === 0) {
			const emptyFileError = new Error('geoip-city6.dat is empty');
			emptyFileError.code = 'ENOENT';
			throw emptyFileError;
		}

		mainData = cityData;
	} catch (err) {
		if (!isExpectedMissingDataError(err)) throw err;
		mainData = await readFileBuffer(dataFiles.country6);
		asyncCache6.recordSize = RECORD_SIZE6;
	}

	asyncCache6.mainBuffer = mainData.buffer;
	asyncCache6.lastRecordIdx = (mainData.size / asyncCache6.recordSize) - 1;
	asyncCache6.lastIP = readIp6(asyncCache6.mainBuffer, asyncCache6.lastRecordIdx, asyncCache6.recordSize, 1);
	asyncCache6.firstIP = readIp6(asyncCache6.mainBuffer, 0, asyncCache6.recordSize, 0);
	cache6 = asyncCache6;
};

const preload6 = callback => {
	if (typeof callback === 'function') {
		preload6Async().then(() => callback()).catch(callback);
	} else {
		let datFile;
		let datSize;
		try {
			datFile = openSync(dataFiles.city6, 'r');
			datSize = fstatSync(datFile).size;

			if (datSize === 0) {
				closeSync(datFile);
				datFile = openSync(dataFiles.country6, 'r');
				datSize = fstatSync(datFile).size;
				cache6.recordSize = RECORD_SIZE6;
			}
		} catch (err) {
			if (err.code !== 'ENOENT' && err.code !== 'EBADF') {
				throw err;
			}

			datFile = openSync(dataFiles.country6, 'r');
			datSize = fstatSync(datFile).size;
			cache6.recordSize = RECORD_SIZE6;
		}

		cache6.mainBuffer = Buffer.alloc(datSize);
		readSync(datFile, cache6.mainBuffer, 0, datSize, 0);
		closeSync(datFile);

		cache6.lastRecordIdx = (datSize / cache6.recordSize) - 1;
		cache6.lastIP = readIp6(cache6.mainBuffer, cache6.lastRecordIdx, cache6.recordSize, 1);
		cache6.firstIP = readIp6(cache6.mainBuffer, 0, cache6.recordSize, 0);
	}
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
			if (!Number.isFinite(ip) || !Number.isInteger(ip) || ip < 0) return null;
			return lookup4(ip);
		}

		const ipVersion = isIP(ip);
		if (ipVersion === 4) {
			return lookup4(aton4(ip));
		} else if (ipVersion === 6) {
			const ipv4 = get4mapped(ip);
			if (ipv4) {
				return lookup4(aton4(ipv4));
			} else {
				return lookup6(aton6(ip));
			}
		}

		return null;
	},
	startWatchingDataUpdate: callback => {
		fsWatcher.makeFsWatchFilter(watcherName, geoDataDir, watchedDataFiles, 60 * 1000, change => {
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
	stopWatchingDataUpdate: () => fsWatcher.stopWatching(watcherName),
	clear: () => {
		cache4 = { ...conf4 };
		cache6 = { ...conf6 };
	},
	reloadDataSync: () => {
		preload();
		preload6();
	},
	reloadData: callback => {
		if (typeof callback === 'function') {
			runAsyncReload(callback);
			return;
		}

		return new Promise((resolve, reject) => {
			runAsyncReload(err => {
				if (err) reject(err);
				else resolve();
			});
		});
	},

	version,
};

preload();
preload6();
