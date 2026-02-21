const { open, fstat, read, close, openSync, fstatSync, readSync, closeSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { isIP } = require('node:net');
const async = require('async');
const { aton4, aton6, cmp6, removeNullTerminator, readIp6, createGeoData, populateGeoDataFromLocation } = require('./scripts/utils.js');
const fsWatcher = require('./scripts/fsWatcher.js');
const { version } = require('./package.json');

const watcherName = 'dataWatcher';
const reportReloadError = err => {
	if (err) console.error('[geoip-lite2] Failed to reload GeoIP data:', err);
};

const geoDataDir = resolve(
	__dirname,
	globalThis['geoDataDir'] || process.env.GEODATADIR || './data/'
);

const dataFiles = {
	city: join(geoDataDir, 'geoip-city.dat'),
	city6: join(geoDataDir, 'geoip-city6.dat'),
	cityNames: join(geoDataDir, 'geoip-city-names.dat'),
	country: join(geoDataDir, 'geoip-country.dat'),
	country6: join(geoDataDir, 'geoip-country6.dat'),
};

const privateRange4 = [
	[aton4('10.0.0.0'), aton4('10.255.255.255')],
	[aton4('172.16.0.0'), aton4('172.31.255.255')],
	[aton4('192.168.0.0'), aton4('192.168.255.255')],
];

const conf4 = {
	firstIP: null,
	lastIP: null,
	lastLine: 0,
	locationBuffer: null,
	locationRecordSize: 88,
	mainBuffer: null,
	recordSize: 24,
};

const conf6 = {
	firstIP: null,
	lastIP: null,
	lastLine: 0,
	mainBuffer: null,
	recordSize: 48,
};

let cache4 = { ...conf4 };
let cache6 = { ...conf6 };

const RECORD_SIZE = 10;
const RECORD_SIZE6 = 34;

const lookup4 = ip => {
	let fline = 0;
	let cline = cache4.lastLine;
	let floor;
	let ceil;
	let line, locId;

	const buffer = cache4.mainBuffer;
	const locBuffer = cache4.locationBuffer;
	const privateRange = privateRange4;
	const recordSize = cache4.recordSize;
	const locRecordSize = cache4.locationRecordSize;

	const geoData = createGeoData();
	if (ip > cache4.lastIP || ip < cache4.firstIP) return null;
	for (let i = 0; i < privateRange.length; i++) {
		if (ip >= privateRange[i][0] && ip <= privateRange[i][1]) return null;
	}

	while (true) {
		line = Math.round((cline - fline) / 2) + fline;
		const offset = line * recordSize;
		floor = buffer.readUInt32BE(offset);
		ceil = buffer.readUInt32BE(offset + 4);

		if (floor <= ip && ceil >= ip) {
			geoData.range = [floor, ceil];

			if (recordSize === RECORD_SIZE) {
				geoData.country = buffer.toString('utf8', offset + 8, offset + 10);
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
	const buffer = cache6.mainBuffer;
	const recordSize = cache6.recordSize;
	const locBuffer = cache4.locationBuffer;
	const locRecordSize = cache4.locationRecordSize;

	const geoData = createGeoData();

	let fline = 0;
	let cline = cache6.lastLine;
	let floor;
	let ceil;
	let line, locId;

	if (cmp6(ip, cache6.lastIP) > 0 || cmp6(ip, cache6.firstIP) < 0) return null;

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

const preload = callback => {
	let datFile;
	let datSize;
	const asyncCache = { ...conf4 };
	if (typeof callback === 'function') {
		void async.series([
			cb => {
				void async.series([
					cb2 => {
						open(dataFiles.cityNames, 'r', (err, file) => {
							datFile = file;
							cb2(err);
						});
					},
					cb2 => {
						fstat(datFile, (err, stats) => {
							datSize = stats.size;
							asyncCache.locationBuffer = Buffer.alloc(datSize);
							cb2(err);
						});
					},
					cb2 => {
						read(datFile, asyncCache.locationBuffer, 0, datSize, 0, cb2);
					},
					cb2 => {
						close(datFile, cb2);
					},
					cb2 => {
						open(dataFiles.city, 'r', (err, file) => {
							datFile = file;
							cb2(err);
						});
					},
					cb2 => {
						fstat(datFile, (err, stats) => {
							datSize = stats.size;
							cb2(err);
						});
					},
				], err => {
					if (err) {
						if (err.code !== 'ENOENT' && err.code !== 'EBADF') {
							cb(err);
							return;
						}

						open(dataFiles.country, 'r', (err, file) => {
							if (err) {
								cb(err);
							} else {
								datFile = file;
								fstat(datFile, (err, stats) => {
									datSize = stats.size;
									asyncCache.recordSize = RECORD_SIZE;

									cb();
								});
							}
						});

					} else {
						cb();
					}
				});
			}, () => {
				asyncCache.mainBuffer = Buffer.alloc(datSize);

				void async.series([
					cb2 => {
						read(datFile, asyncCache.mainBuffer, 0, datSize, 0, cb2);
					},
					cb2 => {
						close(datFile, cb2);
					},
				], err => {
					if (!err) {
						asyncCache.lastLine = (datSize / asyncCache.recordSize) - 1;
						asyncCache.lastIP = asyncCache.mainBuffer.readUInt32BE((asyncCache.lastLine * asyncCache.recordSize) + 4);
						asyncCache.firstIP = asyncCache.mainBuffer.readUInt32BE(0);
						cache4 = asyncCache;
					}
					callback(err);
				});
			},
		]);
	} else {
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

			datFile = openSync(dataFiles.country, 'r');
			datSize = fstatSync(datFile).size;
			cache4.recordSize = RECORD_SIZE;
		}

		cache4.mainBuffer = Buffer.alloc(datSize);
		readSync(datFile, cache4.mainBuffer, 0, datSize, 0);
		closeSync(datFile);

		cache4.lastLine = (datSize / cache4.recordSize) - 1;
		cache4.lastIP = cache4.mainBuffer.readUInt32BE((cache4.lastLine * cache4.recordSize) + 4);
		cache4.firstIP = cache4.mainBuffer.readUInt32BE(0);
	}
};

const preload6 = callback => {
	let datFile;
	let datSize;
	const asyncCache6 = { ...conf6 };
	if (typeof callback === 'function') {
		void async.series([
			cb => {
				void async.series([
					cb2 => {
						open(dataFiles.city6, 'r', (err, file) => {
							datFile = file;
							cb2(err);
						});
					},
					cb2 => {
						fstat(datFile, (err, stats) => {
							datSize = stats.size;
							cb2(err);
						});
					},
				], err => {
					if (err) {
						if (err.code !== 'ENOENT' && err.code !== 'EBADF') {
							cb(err);
							return;
						}

						open(dataFiles.country6, 'r', (err, file) => {
							if (err) {
								cb(err);
							} else {
								datFile = file;
								fstat(datFile, (err, stats) => {
									datSize = stats.size;
									asyncCache6.recordSize = RECORD_SIZE6;

									cb();
								});
							}
						});
					} else {
						cb();
					}
				});
			}, () => {
				asyncCache6.mainBuffer = Buffer.alloc(datSize);

				void async.series([
					cb2 => {
						read(datFile, asyncCache6.mainBuffer, 0, datSize, 0, cb2);
					},
					cb2 => {
						close(datFile, cb2);
					},
				], err => {
					if (!err) {
						asyncCache6.lastLine = (datSize / asyncCache6.recordSize) - 1;
						asyncCache6.lastIP = readIp6(asyncCache6.mainBuffer, asyncCache6.lastLine, asyncCache6.recordSize, 1);
						asyncCache6.firstIP = readIp6(asyncCache6.mainBuffer, 0, asyncCache6.recordSize, 0);
						cache6 = asyncCache6;
					}
					callback(err);
				});
			},
		]);
	} else {
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

		cache6.lastLine = (datSize / cache6.recordSize) - 1;
		cache6.lastIP = readIp6(cache6.mainBuffer, cache6.lastLine, cache6.recordSize, 1);
		cache6.firstIP = readIp6(cache6.mainBuffer, 0, cache6.recordSize, 0);
	}
};

const runAsyncReload = callback => {
	void async.series([
		cb => {
			preload(cb);
		},
		cb => {
			preload6(cb);
		},
	], callback);
};

module.exports = {
	lookup: ip => {
		if (ip === undefined || ip === null) throw new TypeError('lookup(ip) requires an IP address');
		if (typeof ip === 'number') return lookup4(ip);

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
		fsWatcher.makeFsWatchFilter(watcherName, geoDataDir, 60 * 1000, () => {
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

