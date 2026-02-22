'use strict';

const { name, version } = require('../package.json');
const UserAgent = `Mozilla/5.0 (compatible; ${name}/${version}; +https://github.com/sefinek/geoip-lite2)`;

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');
const AdmZip = require('adm-zip');
const { ipv4RangeFromCidr, ipv6RangeFromCidr } = require('../scripts/utils.js');

const log = {
	info: (msg, ...logArgs) => console.log(msg, ...logArgs),
	success: (msg, ...logArgs) => console.log(msg, ...logArgs),
	warn: (msg, ...logArgs) => console.warn(msg, ...logArgs),
	error: (msg, ...logArgs) => console.error(msg, ...logArgs),
};

const TOTAL_PIPELINE_STEPS = 5;
const formatNumber = value => Number(value).toLocaleString('en-US');
const formatDuration = milliseconds => {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
};
const getDatabaseLabel = database => database.type.toUpperCase();
const getPipelinePrefix = (part, totalParts) => `[${part}/${totalParts}]`;
const getCurrentPipelinePrefix = database => getPipelinePrefix(database._part, database._totalParts);
const getStepPrefix = step => `[${step}/${TOTAL_PIPELINE_STEPS}]`;
const logPipelineInfo = (database, message) => log.info(`${getCurrentPipelinePrefix(database)} ${getDatabaseLabel(database)}: ${message}`);
const logStepInfo = (database, step, message) => log.info(`${getStepPrefix(step)} ${getDatabaseLabel(database)}: ${message}`);
const logStepWarn = (database, step, message) => log.warn(`${getStepPrefix(step)} ${getDatabaseLabel(database)}: ${message}`);
const logStepError = (database, step, message) => log.error(`${getStepPrefix(step)} ${getDatabaseLabel(database)}: ${message}`);
const logGlobalInfo = message => log.info(`[0/0] ${message}`);
const logGlobalError = message => log.error(`[0/0] ${message}`);
const toLogPreview = line => (line.length > 120 ? `${line.slice(0, 117)}...` : line);
const createProgressLogger = (database, step, activity) => {
	const startedAt = Date.now();
	let lastLogAt = startedAt;
	const prefix = getStepPrefix(step);
	const dbLabel = getDatabaseLabel(database);

	return {
		maybeLog: (processedRows, writtenRows) => {
			const now = Date.now();
			if ((now - lastLogAt) < 10000) return;
			lastLogAt = now;

			const elapsedSeconds = Math.max((now - startedAt) / 1000, 1);
			const avgRowsPerSecond = Math.round(processedRows / elapsedSeconds);
			log.info(
				`${prefix} ${dbLabel}: ${activity}... processed=${formatNumber(processedRows)} written=${formatNumber(writtenRows)} avg=${formatNumber(avgRowsPerSecond)}/s`
			);
		},
		done: (processedRows, writtenRows) => {
			const durationMs = Date.now() - startedAt;
			const elapsedSeconds = Math.max(durationMs / 1000, 1);
			const avgRowsPerSecond = Math.round(processedRows / elapsedSeconds);
			log.info(
				`${prefix} ${dbLabel}: Done! processed=${formatNumber(processedRows)} written=${formatNumber(writtenRows)} avg=${formatNumber(avgRowsPerSecond)}/s duration=${formatDuration(durationMs)}`
			);
		},
	};
};

const args = process.argv.slice(2);
let license_key = args.find(arg => arg.match(/^license_key=[a-zA-Z0-9]+/) !== null);
if (typeof license_key === 'undefined' && typeof process.env.MAXMIND_KEY !== 'undefined') {
	license_key = `license_key=${process.env.MAXMIND_KEY}`;
}

let geoDataDir = args.find(arg => arg.match(/^geoDataDir=[\w./]+/) !== null);
if (typeof geoDataDir === 'undefined' && typeof process.env.GEODATADIR !== 'undefined') {
	geoDataDir = `geoDataDir=${process.env.GEODATADIR}`;
}

let dataPath = path.resolve(__dirname, '..', 'data');
if (typeof geoDataDir !== 'undefined') {
	dataPath = path.resolve(process.cwd(), geoDataDir.split('=')[1]);
	if (!fs.existsSync(dataPath)) {
		logGlobalError(`Directory does not exist: ${dataPath}`);
		process.exit(1);
	}
}

const tmpPath = process.env.GEOTMPDIR || path.resolve(__dirname, '..', 'tmp');
const countryLookup = {};
const cityLookup = { NaN: -1 };
const databases = [{
	type: 'country',
	url: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country-CSV&suffix=zip&${license_key}`,
	checksum: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country-CSV&suffix=zip.sha256&${license_key}`,
	fileName: 'GeoLite2-Country-CSV.zip',
	src: [
		'GeoLite2-Country-Locations-en.csv',
		'GeoLite2-Country-Blocks-IPv4.csv',
		'GeoLite2-Country-Blocks-IPv6.csv',
	],
	dest: ['', 'geoip-country.dat', 'geoip-country6.dat'],
},
{
	type: 'city',
	url: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City-CSV&suffix=zip&${license_key}`,
	checksum: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City-CSV&suffix=zip.sha256&${license_key}`,
	fileName: 'GeoLite2-City-CSV.zip',
	src: [
		'GeoLite2-City-Locations-en.csv',
		'GeoLite2-City-Blocks-IPv4.csv',
		'GeoLite2-City-Blocks-IPv6.csv',
	],
	dest: ['geoip-city-names.dat', 'geoip-city.dat', 'geoip-city6.dat'],
}];

const mkdir = dirName => {
	const dir = path.dirname(dirName);
	fs.mkdirSync(dir, { recursive: true });
};

const removePathSync = targetPath => {
	fs.rmSync(targetPath, { recursive: true, force: true });
};

const tryFixingLine = line => {
	let pos1 = 0;
	let pos2 = -1;
	line = line.replace(/""/, '\\"').replace(/'/g, '\\\'');

	while (pos1 < line.length && pos2 < line.length) {
		pos1 = pos2;
		pos2 = line.indexOf(',', pos1 + 1);
		if (pos2 < 0) pos2 = line.length;
		if (line.indexOf('\'', (pos1 || 0)) > -1 && line.indexOf('\'', pos1) < pos2 && line[pos1 + 1] !== '"' && line[pos2 - 1] !== '"') {
			line = line.substring(0, pos1 + 1) + '"' + line.substring(pos1 + 1, pos2) + '"' + line.substring(pos2);
			pos2 = line.indexOf(',', pos2 + 1);
			if (pos2 < 0) pos2 = line.length;
		}
	}
	return line;
};

const re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
const re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;

const CSVtoArray = text => {
	if (!re_valid.test(text)) {
		text = tryFixingLine(text);
		if (!re_valid.test(text)) return null;
	}
	const a = [];
	text.replace(re_value,
		(m0, m1, m2, m3) => {
			if (m1 !== undefined) a.push(m1.replace(/\\'/g, '\''));
			else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"').replace(/\\'/g, '\''));
			else if (m3 !== undefined) a.push(m3);
			return '';
		});
	if ((/,\s*$/).test(text)) a.push('');
	return a;
};

const getHTTPOptions = downloadUrl => {
	const parsedUrl = new URL(downloadUrl);
	/** @type {import('node:https').RequestOptions} */
	const options = {
		protocol: parsedUrl.protocol,
		hostname: parsedUrl.hostname,
		port: parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : undefined,
		path: parsedUrl.pathname + parsedUrl.search,
		headers: { 'User-Agent': UserAgent },
	};

	if (process.env.http_proxy || process.env.https_proxy) {
		try {
			const HttpsProxyAgent = require('https-proxy-agent');
			options.agent = new HttpsProxyAgent(process.env.http_proxy || process.env.https_proxy);
		} catch (err) {
			logGlobalError(`Install https-proxy-agent to use an HTTP/HTTPS proxy. ${err.message}`);
			process.exit(-1);
		}
	}

	return options;
};

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

const requestWithRedirect = (downloadUrl, onResponse) => {
	const executeRequest = url => {
		const req = https.get(getHTTPOptions(url), response => {
			const status = response.statusCode || 0;

			if (REDIRECT_STATUS_CODES.has(status)) {
				const redirectLocation = response.headers.location;
				if (!redirectLocation) {
					logGlobalError(`HTTP redirect response without location header [${status}]`);
					process.exit(1);
				}

				response.resume();
				const redirectUrl = new URL(redirectLocation, url).toString();
				executeRequest(redirectUrl);
				return;
			}

			onResponse(response, status);
		});

		req.on('error', err => {
			logGlobalError(`HTTP request failed: ${err.message}`);
			process.exit(1);
		});
	};

	executeRequest(downloadUrl);
};

const writeBuffer = (stream, buffer) => new Promise((resolve, reject) => {
	stream.write(buffer, err => {
		if (err) reject(err);
		else resolve();
	});
});

const closeWriteStream = stream => new Promise((resolve, reject) => {
	stream.end(err => {
		if (err) reject(err);
		else resolve();
	});
});

const processDataFileByLine = async (tmpDataFile, onDataLine) => {
	const input = fs.createReadStream(tmpDataFile, { encoding: 'utf8' });
	let pending = '';
	let lineNumber = 0;

	for await (const chunk of input) {
		pending += chunk;

		let newlineIndex = pending.indexOf('\n');
		while (newlineIndex !== -1) {
			let line = pending.slice(0, newlineIndex);
			pending = pending.slice(newlineIndex + 1);

			if (line.endsWith('\r')) line = line.slice(0, -1);

			lineNumber++;
			if (lineNumber !== 1) {
				await onDataLine(line);
			}

			newlineIndex = pending.indexOf('\n');
		}
	}

	if (pending.length > 0) {
		let line = pending;
		if (line.endsWith('\r')) line = line.slice(0, -1);
		lineNumber++;
		if (lineNumber !== 1) {
			await onDataLine(line);
		}
	}
};

const check = (database, cb) => {
	if (args.indexOf('force') !== -1) {
		logStepInfo(database, 1, 'Force mode enabled, skipping checksum verification');
		return cb(null, database);
	}

	const checksumUrl = database.checksum;
	if (typeof checksumUrl === 'undefined') return cb(null, database);
	fs.readFile(path.join(dataPath, `${database.type}.checksum`), { encoding: 'utf8' }, (err, data) => {
		if (!err && data && data.length) database.checkValue = data;

		logStepInfo(database, 1, `Checking checksum for ${database.fileName}...`);

		requestWithRedirect(checksumUrl, (response, status) => {
			if (status !== 200) {
				logStepError(database, 1, `HTTP request failed [${status} ${http.STATUS_CODES[status]}]`);
				response.destroy();
				process.exit(1);
			}

			let str = '';
			response.on('data', chunk => {
				str += chunk;
			});

			response.on('end', () => {
				if (str && str.length) {
					if (str === database.checkValue) {
						logStepInfo(database, 1, 'Checksum unchanged, skipping download, extraction, processing and checksum write');
						database.skip = true;
					} else {
						logStepInfo(database, 1, 'New data detected, continuing with update...');
						database.checkValue = str;
					}
				}
				else {
					logStepError(database, 1, 'Could not retrieve checksum, aborting...');
					logStepError(database, 1, 'Use "force" to bypass checksum validation');
					response.destroy();
					process.exit(1);
				}
				cb(null, database);
			});
		});
	});
};

const fetch = (database, cb) => {
	if (database.skip) return cb(null, null, null, database);

	const downloadUrl = database.url;
	let fileName = database.fileName;
	const gzip = path.extname(fileName) === '.gz';
	if (gzip) fileName = fileName.replace('.gz', '');

	const tmpFile = path.join(tmpPath, fileName);
	if (fs.existsSync(tmpFile)) {
		logStepInfo(database, 2, `Reusing cached download: ${fileName}`);
		return cb(null, tmpFile, fileName, database);
	}

	logStepInfo(database, 2, `Downloading ${fileName}...`);
	mkdir(tmpFile);

	requestWithRedirect(downloadUrl, (response, status) => {
		if (status !== 200) {
			logStepError(database, 2, `HTTP request failed [${status} ${http.STATUS_CODES[status]}]`);
			response.destroy();
			process.exit(1);
		}

		let settled = false;
		const finish = err => {
			if (settled) return;
			settled = true;

			if (err) {
				fs.unlink(tmpFile, unlinkErr => {
					if (unlinkErr && unlinkErr.code !== 'ENOENT') {
						logStepWarn(database, 2, `Failed to remove incomplete download: ${unlinkErr.message}`);
					}
					cb(err);
				});
				return;
			}

			cb(null, tmpFile, fileName, database);
		};

		const tmpFileStream = fs.createWriteStream(tmpFile);
		tmpFileStream.on('error', finish);
		response.on('error', finish);

		if (gzip) {
			const gunzipStream = zlib.createGunzip();
			gunzipStream.on('error', finish);
			response.pipe(gunzipStream).pipe(tmpFileStream);
		} else {
			response.pipe(tmpFileStream);
		}

		tmpFileStream.on('close', () => finish());
	});
};

const extract = (tmpFile, tmpFileName, database, cb) => {
	if (database.skip) return cb(null, database);

	if (path.extname(tmpFileName) !== '.zip') {
		logStepInfo(database, 3, 'Extraction skipped (non-zip file)');
		cb(null, database);
	} else {
		logStepInfo(database, 3, `Extracting ${tmpFileName}...`);
		const zip = new AdmZip(tmpFile);
		const zipEntries = zip.getEntries();
		let extractedCount = 0;

		zipEntries.forEach(entry => {
			if (entry.isDirectory) return;

			const filePath = entry.entryName.split('/');
			const fileName = filePath[filePath.length - 1];
			const destinationPath = path.join(tmpPath, fileName);

			fs.writeFileSync(destinationPath, entry.getData());
			extractedCount++;
		});
		logStepInfo(database, 3, `Extracted ${formatNumber(extractedCount)} files`);

		cb(null, database);
	}
};

const processLookupCountry = (database, src, cb) => {
	let loadedRows = 0;
	let malformedRows = 0;

	const processLine = line => {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			malformedRows++;
			logStepWarn(database, 4, `Malformed lookup line skipped: ${toLogPreview(line)}`);
			return;
		}

		loadedRows++;
		countryLookup[fields[0]] = fields[4];
	};
	const tmpDataFile = path.join(tmpPath, src);

	logStepInfo(database, 4, `Building country lookup table from ${src}...`);

	const rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile, { encoding: 'latin1' }),
		output: process.stdout,
		terminal: false,
	});
	let settled = false;

	const finish = err => {
		if (settled) return;
		settled = true;
		if (err) {
			cb(err);
		} else {
			logStepInfo(database, 4, `Country lookup completed! loaded=${formatNumber(loadedRows)} malformed=${formatNumber(malformedRows)}`);
			cb();
		}
	};

	let lineCount = 0;
	rl.on('line', line => {
		if (lineCount > 0) processLine(line);
		lineCount++;
	});

	rl.on('close', () => finish());
	rl.on('error', finish);
};

const processCountryData = async (database, ipFamily, src, dest) => {
	let processedRows = 0;
	let writtenRows = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	removePathSync(dataFile);
	mkdir(dataFile);

	logStepInfo(database, 4, `Processing ${ipFamily}: source=${src}; output=${dest}`);
	const progress = createProgressLogger(database, 4, `Processing ${ipFamily}`);
	const datFile = fs.createWriteStream(dataFile);

	const processLine = async line => {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			logStepWarn(database, 4, `Malformed ${ipFamily} line skipped: ${toLogPreview(line)}`);
			return;
		}

		processedRows++;

		let sip;
		let eip;
		const cc = countryLookup[fields[1]];
		let b;
		let bsz;
		let i;
		if (cc) {
			if (fields[0].match(/:/)) {
				bsz = 34;
				[sip, eip] = ipv6RangeFromCidr(fields[0]);

				b = Buffer.alloc(bsz);
				for (i = 0; i < sip.length; i++) {
					b.writeUInt32BE(sip[i], i * 4);
				}

				for (i = 0; i < eip.length; i++) {
					b.writeUInt32BE(eip[i], 16 + (i * 4));
				}
			} else {
				bsz = 10;

				[sip, eip] = ipv4RangeFromCidr(fields[0]);

				b = Buffer.alloc(bsz);
				b.fill(0);
				b.writeUInt32BE(sip, 0);
				b.writeUInt32BE(eip, 4);
			}

			b.write(cc, bsz - 2);
			await writeBuffer(datFile, b);
			writtenRows++;
		}

		progress.maybeLog(processedRows, writtenRows);
	};

	let processingError = null;
	try {
		await processDataFileByLine(tmpDataFile, processLine);
	} catch (err) {
		processingError = err;
	}

	await closeWriteStream(datFile);
	if (processingError) throw processingError;
	progress.done(processedRows, writtenRows);
};

const processCityData = async (database, ipFamily, src, dest) => {
	let processedRows = 0;
	let writtenRows = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	removePathSync(dataFile);

	logStepInfo(database, 4, `Processing ${ipFamily}: source=${src}; output=${dest}`);
	const progress = createProgressLogger(database, 4, `Processing ${ipFamily}`);
	const datFile = fs.createWriteStream(dataFile);

	const processLine = async line => {
		if (line.match(/^Copyright/) || !line.match(/\d/)) return;

		const fields = CSVtoArray(line);
		if (!fields) {
			logStepWarn(database, 4, `Malformed ${ipFamily} line skipped: ${toLogPreview(line)}`);
			return;
		}
		let sip;
		let eip;
		let locId;
		let b;
		let bsz;
		let lat;
		let lon;
		let area;

		let i;

		processedRows++;

		if (fields[0].match(/:/)) {
			let offset = 0;
			bsz = 48;
			[sip, eip] = ipv6RangeFromCidr(fields[0]);
			locId = parseInt(fields[1], 10);
			locId = cityLookup[locId];

			b = Buffer.alloc(bsz);
			b.fill(0);

			for (i = 0; i < sip.length; i++) {
				b.writeUInt32BE(sip[i], offset);
				offset += 4;
			}

			for (i = 0; i < eip.length; i++) {
				b.writeUInt32BE(eip[i], offset);
				offset += 4;
			}
			b.writeUInt32BE(locId >>> 0, 32);

			lat = Math.round(parseFloat(fields[7]) * 10000);
			lon = Math.round(parseFloat(fields[8]) * 10000);
			area = parseInt(fields[9], 10);
			b.writeInt32BE(lat, 36);
			b.writeInt32BE(lon, 40);
			b.writeInt32BE(area, 44);
		} else {
			bsz = 24;

			[sip, eip] = ipv4RangeFromCidr(fields[0]);
			locId = parseInt(fields[1], 10);
			locId = cityLookup[locId];
			b = Buffer.alloc(bsz);
			b.fill(0);
			b.writeUInt32BE(sip >>> 0, 0);
			b.writeUInt32BE(eip >>> 0, 4);
			b.writeUInt32BE(locId >>> 0, 8);

			lat = Math.round(parseFloat(fields[7]) * 10000);
			lon = Math.round(parseFloat(fields[8]) * 10000);
			area = parseInt(fields[9], 10);
			b.writeInt32BE(lat, 12);
			b.writeInt32BE(lon, 16);
			b.writeInt32BE(area, 20);
		}

		await writeBuffer(datFile, b);
		writtenRows++;
		progress.maybeLog(processedRows, writtenRows);
	};

	let processingError = null;
	try {
		await processDataFileByLine(tmpDataFile, processLine);
	} catch (err) {
		processingError = err;
	}

	await closeWriteStream(datFile);
	if (processingError) throw processingError;
	progress.done(processedRows, writtenRows);
};

const processCityDataNames = (database, src, dest, cb) => {
	let locId = null;
	let linesCount = 0;
	let malformedRows = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	removePathSync(dataFile);
	logStepInfo(database, 4, `Processing city names: source=${src}; output=${dest}`);

	const datFile = fs.openSync(dataFile, 'w');

	const processLine = (line) => {
		if (line.match(/^Copyright/) || !line.match(/\d/)) return;

		const b = Buffer.alloc(88);
		const fields = CSVtoArray(line);
		if (!fields) {
			malformedRows++;
			logStepWarn(database, 4, `Malformed city names line skipped: ${toLogPreview(line)}`);
			return;
		}

		locId = parseInt(fields[0]);

		cityLookup[locId] = linesCount;
		const cc = fields[4];
		const rg = fields[6];
		const city = fields[10];
		const metro = parseInt(fields[11]);
		const tz = fields[12];
		const isEuFlag = fields[13];

		b.fill(0);
		b.write(cc, 0);
		b.write(rg, 2);

		if (metro) b.writeInt32BE(metro, 5);
		b.write(isEuFlag, 9);
		b.write(tz, 10);
		b.write(city, 42);

		fs.writeSync(datFile, b, 0, b.length, null);
		linesCount++;
	};

	const rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile, { encoding: 'utf8' }),
		output: process.stdout,
		terminal: false,
	});
	let settled = false;

	const finish = (err) => {
		if (settled) return;
		settled = true;
		fs.closeSync(datFile);
		if (err) {
			cb(err);
		} else {
			logStepInfo(database, 4, `City names completed! written=${formatNumber(linesCount)} malformed=${formatNumber(malformedRows)}`);
			cb();
		}
	};

	let lineCount = 0;
	rl.on('line', line => {
		if (lineCount > 0) processLine(line);

		lineCount++;
	});

	rl.on('close', () => finish());
	rl.on('error', finish);
};

const processData = (database, cb) => {
	if (database.skip) return cb(null, database);

	const type = database.type;
	const src = database.src;
	const dest = database.dest;

	if (type === 'country') {
		if (Array.isArray(src)) {
			processLookupCountry(database, src[0], err => {
				if (err) return cb(err);
				processCountryData(database, 'country IPv4 data', src[1], dest[1]).then(() => {
					return processCountryData(database, 'country IPv6 data', src[2], dest[2]);
				}).then(() => {
					cb(null, database);
				}).catch(cb);
			});
		}
		else {
			processCountryData(database, 'country data', src, dest).then(() => {
				cb(null, database);
			}).catch(cb);
		}
	} else if (type === 'city') {
		processCityDataNames(database, src[0], dest[0], err => {
			if (err) return cb(err);
			processCityData(database, 'city IPv4 data', src[1], dest[1]).then(() => {
				return processCityData(database, 'city IPv6 data', src[2], dest[2]);
			}).then(() => {
				cb(null, database);
			}).catch(cb);
		});
	}
};

const updateChecksum = (database, cb) => {
	if (database.skip || !database.checkValue) return cb();

	fs.writeFile(path.join(dataPath, database.type + '.checksum'), database.checkValue, 'utf8', err => {
		if (err) logStepError(database, 5, `Failed to write checksum: ${err.message}`);
		cb();
	});
};

if (!license_key) {
	logGlobalError('Missing license_key');
	process.exit(1);
}

removePathSync(tmpPath);
mkdir(tmpPath);

const invokeStep = (fn, ...stepArgs) => new Promise((resolve, reject) => {
	fn(...stepArgs, (err, ...results) => {
		if (err) reject(err);
		else resolve(results);
	});
});

const run = async () => {
	const totalDatabases = databases.length;
	for (const [index, database] of databases.entries()) {
		database._part = index + 1;
		database._totalParts = totalDatabases;
		const startedAt = Date.now();
		logPipelineInfo(database, `Starting update (${database.fileName})!`);

		const [checkedDatabase] = await invokeStep(check, database);
		const [tmpFile, tmpFileName, fetchedDatabase] = await invokeStep(fetch, checkedDatabase);
		const [extractedDatabase] = await invokeStep(extract, tmpFile, tmpFileName, fetchedDatabase);
		const [processedDatabase] = await invokeStep(processData, extractedDatabase);
		await invokeStep(updateChecksum, processedDatabase);

		logPipelineInfo(database, `Finished update in ${formatDuration(Date.now() - startedAt)}`);
	}
};

const runStartedAt = Date.now();
run()
	.then(() => {
		log.success(`[${databases.length}/${databases.length}] All databases were successfully updated in ${formatDuration(Date.now() - runStartedAt)}!`);
		if (args.indexOf('debug') !== -1) {
			logGlobalInfo(`Debug mode enabled. Temporary files preserved at ${tmpPath}.`);
		} else {
			removePathSync(tmpPath);
		}
		process.exit(0);
	})
	.catch(err => {
		logGlobalError(`Failed to update databases from MaxMind: ${err?.stack || err?.message || String(err)}`);
		process.exit(1);
	});
