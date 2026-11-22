const { readFileSync } = require('node:fs');
const fsPromises = require('node:fs/promises');
const { basename, join, resolve } = require('node:path');
const { isIP } = require('node:net');
const { aton4, aton6, cmp6, cmp6At, readString, readIp6, createGeoData, populateGeoDataFromLocation } = require('./scripts/utils.js');
const fsWatcher = require('./scripts/fsWatcher.js');
const { version } = require('./package.json');

const WATCHER_NAME = 'dataWatcher';
const WATCHER_COOLDOWN_MS = 60 * 1000;

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

const LOCATION_RECORD_SIZE = 88;

// Order matters: the first source whose files are available and non-empty wins.
const SOURCES4 = [
	{ files: ['cityNames', 'city'], recordSize: 24, city: true },
	{ files: ['country'], recordSize: 10, city: false },
];
const SOURCES6 = [
	{ files: ['city6'], recordSize: 48, city: true },
	{ files: ['country6'], recordSize: 34, city: false },
];

const EMPTY_CACHE = Object.freeze({
	mainBuffer: null,
	locationBuffer: null,
	recordSize: 0,
	lastRecordIdx: -1,
	firstIP: null,
	lastIP: null,
});

let cache4 = EMPTY_CACHE;
let cache6 = EMPTY_CACHE;

const isExpectedMissingDataError = err => err?.code === 'ENOENT' || err?.code === 'EBADF';

const pickSource = (sources, index, buffers) => (buffers[0].length === 0 && index < sources.length - 1 ? null : { source: sources[index], buffers });

const loadSources = (sources, readFile) => {
	for (let i = 0; i < sources.length; i++) {
		try {
			const picked = pickSource(sources, i, sources[i].files.map(name => readFile(DATA_FILES[name])));
			if (picked) return picked;
		} catch (err) {
			if (i === sources.length - 1 || !isExpectedMissingDataError(err)) throw err;
		}
	}
};

const loadSourcesAsync = async sources => {
	for (let i = 0; i < sources.length; i++) {
		try {
			const buffers = await Promise.all(sources[i].files.map(name => fsPromises.readFile(DATA_FILES[name])));
			const picked = pickSource(sources, i, buffers);
			if (picked) return picked;
		} catch (err) {
			if (i === sources.length - 1 || !isExpectedMissingDataError(err)) throw err;
		}
	}
};

const buildCache4 = ({ source, buffers }) => {
	const mainBuffer = buffers[buffers.length - 1];
	const count = mainBuffer.length / source.recordSize;
	if (!Number.isInteger(count)) throw new Error(`Corrupted GeoIP data: size ${mainBuffer.length} is not a multiple of ${source.recordSize}`);

	return {
		mainBuffer,
		locationBuffer: source.city ? buffers[0] : null,
		recordSize: source.recordSize,
		lastRecordIdx: count - 1,
		firstIP: count ? mainBuffer.readUInt32BE(0) : null,
		lastIP: count ? mainBuffer.readUInt32BE(((count - 1) * source.recordSize) + 4) : null,
	};
};

const buildCache6 = ({ source, buffers }) => {
	const mainBuffer = buffers[0];
	const count = mainBuffer.length / source.recordSize;
	if (!Number.isInteger(count)) throw new Error(`Corrupted GeoIP data: size ${mainBuffer.length} is not a multiple of ${source.recordSize}`);

	return {
		mainBuffer,
		locationBuffer: null,
		recordSize: source.recordSize,
		lastRecordIdx: count - 1,
		firstIP: count ? readIp6(mainBuffer, 0, source.recordSize, 0) : null,
		lastIP: count ? readIp6(mainBuffer, count - 1, source.recordSize, 1) : null,
	};
};

const loadCaches = () => {
	const next4 = buildCache4(loadSources(SOURCES4, readFileSync));
	const next6 = buildCache6(loadSources(SOURCES6, readFileSync));
	cache4 = next4;
	cache6 = next6;
};

const loadCachesAsync = async () => {
	const [loaded4, loaded6] = await Promise.all([loadSourcesAsync(SOURCES4), loadSourcesAsync(SOURCES6)]);
	const next4 = buildCache4(loaded4);
	const next6 = buildCache6(loaded6);
	cache4 = next4;
	cache6 = next6;
};

const lookup4 = ip => {
	const { mainBuffer: buffer, locationBuffer, recordSize, lastRecordIdx, firstIP, lastIP } = cache4;
	if (!buffer || lastRecordIdx < 0 || ip > lastIP || ip < firstIP) return null;

	for (let i = 0; i < PRIVATE_RANGE4.length; i++) {
		if (ip >= PRIVATE_RANGE4[i][0] && ip <= PRIVATE_RANGE4[i][1]) return null;
	}

	let lo = 0;
	let hi = lastRecordIdx;
	while (lo <= hi) {
		const line = (lo + hi) >>> 1;
		const offset = line * recordSize;

		if (buffer.readUInt32BE(offset + 4) < ip) {
			lo = line + 1;
		} else if (buffer.readUInt32BE(offset) > ip) {
			hi = line - 1;
		} else {
			const geoData = createGeoData();
			if (locationBuffer) {
				populateGeoDataFromLocation({
					geoData,
					locationBuffer,
					locationRecordSize: LOCATION_RECORD_SIZE,
					locationId: buffer.readUInt32BE(offset + 8),
					coordBuffer: buffer,
					latitudeOffset: offset + 12,
					longitudeOffset: offset + 16,
					areaOffset: offset + 20,
				});
			} else {
				geoData.country = readString(buffer, offset + 8, offset + 10);
			}

			return geoData;
		}
	}

	return null;
};

const lookup6 = ip => {
	const { mainBuffer: buffer, recordSize, lastRecordIdx, firstIP, lastIP } = cache6;
	if (!buffer || lastRecordIdx < 0 || cmp6(ip, lastIP) > 0 || cmp6(ip, firstIP) < 0) return null;

	const locationBuffer = cache4.locationBuffer;
	const isCity = recordSize === SOURCES6[0].recordSize;

	let lo = 0;
	let hi = lastRecordIdx;
	while (lo <= hi) {
		const line = (lo + hi) >>> 1;
		const offset = line * recordSize;

		if (cmp6At(buffer, offset + 16, ip) < 0) {
			lo = line + 1;
		} else if (cmp6At(buffer, offset, ip) > 0) {
			hi = line - 1;
		} else {
			const geoData = createGeoData();
			if (isCity) {
				populateGeoDataFromLocation({
					geoData,
					locationBuffer,
					locationRecordSize: LOCATION_RECORD_SIZE,
					locationId: buffer.readUInt32BE(offset + 32),
					coordBuffer: buffer,
					latitudeOffset: offset + 36,
					longitudeOffset: offset + 40,
					areaOffset: offset + 44,
				});
			} else {
				geoData.country = readString(buffer, offset + 32, offset + 34);
			}

			return geoData;
		}
	}

	return null;
};

const V4_MAPPED_PREFIX_RE = /^(?:(?:0{1,4}:){5}|::)ffff:(.+)$/i;

// IPv4-mapped addresses (::ffff:a.b.c.d or ::ffff:abcd:efgh) are looked up as IPv4. The address is parsed only once.
// The input has already been validated by isIP, so whatever follows the prefix is a valid dotted IPv4 address.
const lookupIPv6String = ip => {
	const hasDots = ip.includes('.');
	if (hasDots) {
		const dotted = V4_MAPPED_PREFIX_RE.exec(ip);
		if (dotted) return lookup4(aton4(dotted[1]));
	}

	const words = aton6(ip);
	if (!hasDots && words[0] === 0 && words[1] === 0 && words[2] === 0xFFFF) return lookup4(words[3]);

	return lookup6(words);
};

const runAsyncReload = callback => {
	loadCachesAsync().then(() => callback(), callback);
};

const logReloadError = err => {
	if (err) console.error('[geoip-lite2] Failed to reload GeoIP data:', err);
};

module.exports = {
	lookup: ip => {
		if (ip === undefined || ip === null) throw new TypeError('lookup(ip) requires an IP address');
		if (typeof ip === 'number') {
			return Number.isInteger(ip) && ip >= 0 && ip <= 0xFFFFFFFF ? lookup4(ip) : null;
		}

		if (typeof ip !== 'string') return null;

		const ipVersion = isIP(ip);
		if (ipVersion === 4) return lookup4(aton4(ip));
		if (ipVersion === 6) return lookupIPv6String(ip);

		return null;
	},
	startWatchingDataUpdate: callback => {
		const onReloaded = typeof callback === 'function' ? callback : logReloadError;

		fsWatcher.makeFsWatchFilter(WATCHER_NAME, GEO_DATA_DIR, WATCHED_DATA_FILES, WATCHER_COOLDOWN_MS, change => {
			console.log(change?.file
				? `[geoip-lite2] Detected change in "${change.file}", reloading data...`
				: '[geoip-lite2] Detected change in GeoIP data directory, reloading data...');

			runAsyncReload(onReloaded);
		});
	},
	stopWatchingDataUpdate: () => fsWatcher.stopWatching(WATCHER_NAME),
	clear: () => {
		cache4 = EMPTY_CACHE;
		cache6 = EMPTY_CACHE;
	},
	reloadDataSync: loadCaches,
	reloadData: callback => {
		if (typeof callback === 'function') {
			runAsyncReload(callback);
			return;
		}

		return loadCachesAsync();
	},

	version,
};

loadCaches();
