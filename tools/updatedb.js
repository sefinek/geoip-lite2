const { name, version } = require('../package.json');
const UserAgent = `Mozilla/5.0 (compatible; ${name}/${version}; +https://github.com/sefinek/geoip-lite2)`;

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const { ipv4RangeFromCidr, ipv6RangeFromCidr } = require('../scripts/utils.js');

// --- Logging ---

const log = {
	info: (msg, ...args) => console.log(msg, ...args),
	success: (msg, ...args) => console.log(msg, ...args),
	warn: (msg, ...args) => console.warn(msg, ...args),
	error: (msg, ...args) => console.error(msg, ...args),
};

const TOTAL_PIPELINE_STEPS = 5;
const formatNumber = value => Number(value).toLocaleString('en-US');
const formatDuration = ms => {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
};

const getDatabaseLabel = db => db.type.toUpperCase();
const getPipelinePrefix = db => `[${db._part}/${db._totalParts}]`;
const getStepPrefix = step => `[${step}/${TOTAL_PIPELINE_STEPS}]`;

const logPipelineInfo = (db, msg) => log.info(`${getPipelinePrefix(db)} ${getDatabaseLabel(db)}: ${msg}`);
const logStepInfo = (db, step, msg) => log.info(`${getPipelinePrefix(db)}${getStepPrefix(step)} ${getDatabaseLabel(db)}: ${msg}`);
const logStepWarn = (db, step, msg) => log.warn(`${getPipelinePrefix(db)}${getStepPrefix(step)} ${getDatabaseLabel(db)}: ${msg}`);
const logStepError = (db, step, msg) => log.error(`${getPipelinePrefix(db)}${getStepPrefix(step)} ${getDatabaseLabel(db)}: ${msg}`);
const logGlobalInfo = msg => log.info(`[0/0] ${msg}`);
const logGlobalError = msg => log.error(`[0/0] ${msg}`);
const toLogPreview = line => line.length > 120 ? `${line.slice(0, 117)}...` : line;

const createProgressLogger = (db, step, activity) => {
	const startedAt = Date.now();
	let lastLogAt = startedAt;
	const prefix = getStepPrefix(step);
	const label = getDatabaseLabel(db);

	return {
		maybeLog: (processed, written) => {
			const now = Date.now();
			if (now - lastLogAt < 10000) return;
			lastLogAt = now;
			const rps = Math.round(processed / Math.max((now - startedAt) / 1000, 1));
			log.info(`${prefix} ${label}: ${activity}... processed=${formatNumber(processed)} written=${formatNumber(written)} avg=${formatNumber(rps)}/s`);
		},
		done: (processed, written) => {
			const durationMs = Date.now() - startedAt;
			const rps = Math.round(processed / Math.max(durationMs / 1000, 1));
			log.info(`${prefix} ${label}: Done! processed=${formatNumber(processed)} written=${formatNumber(written)} avg=${formatNumber(rps)}/s duration=${formatDuration(durationMs)}`);
		},
	};
};

// --- Args & Config ---

const args = process.argv.slice(2);

let license_key = args.find(a => (/^license_key=[a-zA-Z0-9]+/).test(a));
if (!license_key && process.env.MAXMIND_KEY) license_key = `license_key=${process.env.MAXMIND_KEY}`;

let geoDataDir = args.find(a => (/^geoDataDir=[\w./]+/).test(a));
if (!geoDataDir && process.env.GEOIP_DATA_DIR) geoDataDir = `geoDataDir=${process.env.GEOIP_DATA_DIR}`;

let dataPath = path.resolve(__dirname, '..', 'data');
if (geoDataDir) {
	dataPath = path.resolve(process.cwd(), geoDataDir.split('=')[1]);
	if (!fs.existsSync(dataPath)) {
		logGlobalError(`Directory does not exist: ${dataPath}`);
		process.exit(1);
	}
}

const tmpPath = process.env.GEOIP_TMP_DIR || path.resolve(__dirname, '..', 'tmp');
const countryLookup = {};
const cityLookup = { NaN: -1 };

const databases = [
	{
		type: 'country',
		url: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country-CSV&suffix=zip&${license_key}`,
		checksum: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country-CSV&suffix=zip.sha256&${license_key}`,
		fileName: 'GeoLite2-Country-CSV.zip',
		src: ['GeoLite2-Country-Locations-en.csv', 'GeoLite2-Country-Blocks-IPv4.csv', 'GeoLite2-Country-Blocks-IPv6.csv'],
		dest: ['', 'geoip-country.dat', 'geoip-country6.dat'],
	},
	{
		type: 'city',
		url: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City-CSV&suffix=zip&${license_key}`,
		checksum: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City-CSV&suffix=zip.sha256&${license_key}`,
		fileName: 'GeoLite2-City-CSV.zip',
		src: ['GeoLite2-City-Locations-en.csv', 'GeoLite2-City-Blocks-IPv4.csv', 'GeoLite2-City-Blocks-IPv6.csv'],
		dest: ['geoip-city-names.dat', 'geoip-city.dat', 'geoip-city6.dat'],
	},
];

// --- Utilities ---

const ensureParentDir = filePath => fs.mkdirSync(path.dirname(filePath), { recursive: true });
const removePathSync = targetPath => fs.rmSync(targetPath, { recursive: true, force: true });

const writeBuffer = (stream, buffer) => new Promise((resolve, reject) =>
	stream.write(buffer, err => (err ? reject(err) : resolve()))
);

const closeWriteStream = stream => new Promise((resolve, reject) =>
	stream.end(err => (err ? reject(err) : resolve()))
);

const collectResponse = response => new Promise((resolve, reject) => {
	let data = '';
	response.on('data', chunk => data += chunk);
	response.on('end', () => resolve(data));
	response.on('error', reject);
});

// --- CSV Parsing ---

const tryFixingLine = line => {
	let pos1 = 0;
	let pos2 = -1;
	line = line.replace(/""/g, '\\"').replace(/'/g, '\\\'');

	while (pos1 < line.length && pos2 < line.length) {
		pos1 = pos2;
		pos2 = line.indexOf(',', pos1 + 1);
		if (pos2 < 0) pos2 = line.length;
		if (
			line.indexOf('\'', pos1 || 0) > -1 &&
			line.indexOf('\'', pos1) < pos2 &&
			line[pos1 + 1] !== '"' &&
			line[pos2 - 1] !== '"'
		) {
			line = `${line.substring(0, pos1 + 1)}"${line.substring(pos1 + 1, pos2)}"${line.substring(pos2)}`;
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
	text.replace(re_value, (m0, m1, m2, m3) => {
		if (m1 !== undefined) a.push(m1.replace(/\\'/g, '\''));
		else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"').replace(/\\'/g, '\''));
		else if (m3 !== undefined) a.push(m3);
		return '';
	});

	if ((/,\s*$/).test(text)) a.push('');
	return a;
};

// --- HTTP ---

const getHTTPOptions = url => {
	const parsed = new URL(url);
	const options = {
		protocol: parsed.protocol,
		hostname: parsed.hostname,
		port: parsed.port ? Number.parseInt(parsed.port, 10) : undefined,
		path: parsed.pathname + parsed.search,
		headers: { 'User-Agent': UserAgent },
	};

	const proxy = process.env.http_proxy || process.env.https_proxy;
	if (proxy) {
		try {
			const { HttpsProxyAgent } = require('https-proxy-agent');
			options.agent = new HttpsProxyAgent(proxy);
		} catch (err) {
			logGlobalError(`Proxy configured but https-proxy-agent is missing: ${err.message}`);
			process.exit(1);
		}
	}

	return options;
};

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

const requestWithRedirect = (url, onResponse) => {
	const execute = (currentUrl, redirectCount) => {
		const req = https.get(getHTTPOptions(currentUrl), response => {
			const { statusCode: status } = response;

			if (REDIRECT_STATUS_CODES.has(status)) {
				if (redirectCount >= MAX_REDIRECTS) {
					logGlobalError(`Too many redirects (max ${MAX_REDIRECTS})`);
					response.destroy();
					process.exit(1);
				}

				const location = response.headers.location;
				if (!location) {
					logGlobalError(`HTTP redirect response without location header [${status}]`);
					response.destroy();
					process.exit(1);
				}

				response.resume();
				execute(new URL(location, currentUrl).toString(), redirectCount + 1);
				return;
			}

			onResponse(response, status);
		});

		req.on('error', err => {
			logGlobalError(`HTTP request failed: ${err.message}`);
			process.exit(1);
		});
	};

	execute(url, 0);
};

// --- File line processing ---

const processDataFileByLine = async (filePath, onLine) => {
	const input = fs.createReadStream(filePath, { encoding: 'utf8' });
	let pending = '';
	let isFirstLine = true;

	for await (const chunk of input) {
		pending += chunk;

		let newlineIndex = pending.indexOf('\n');
		while (newlineIndex !== -1) {
			let line = pending.slice(0, newlineIndex);
			pending = pending.slice(newlineIndex + 1);
			if (line.endsWith('\r')) line = line.slice(0, -1);

			if (isFirstLine) {
				isFirstLine = false;
			} else {
				await onLine(line);
			}

			newlineIndex = pending.indexOf('\n');
		}
	}

	if (pending.length > 0) {
		const line = pending.endsWith('\r') ? pending.slice(0, -1) : pending;
		if (!isFirstLine) await onLine(line);
	}
};

// Shared boilerplate for IP data processing steps.
// buildBuffer(line) contract:
//   undefined → skip line entirely (not counted, e.g. malformed)
//   null      → count as processed, but do not write (e.g. country with unknown cc)
//   Buffer    → count as processed and write
const processIPData = async (database, step, label, tmpSrc, dataDest, buildBuffer) => {
	let processedRows = 0;
	let writtenRows = 0;
	const dataFile = path.join(dataPath, dataDest);
	const tmpDataFile = path.join(tmpPath, tmpSrc);

	removePathSync(dataFile);
	ensureParentDir(dataFile);
	logStepInfo(database, step, `Processing ${label}: source=${tmpSrc}; output=${dataDest}`);

	const progress = createProgressLogger(database, step, `Processing ${label}`);
	const datFile = fs.createWriteStream(dataFile);
	let processingError = null;

	try {
		await processDataFileByLine(tmpDataFile, async line => {
			const b = buildBuffer(line);
			if (b === undefined) return;

			processedRows++;
			if (b !== null) {
				await writeBuffer(datFile, b);
				writtenRows++;
			}
			progress.maybeLog(processedRows, writtenRows);
		});
	} catch (err) {
		processingError = err;
	}

	await closeWriteStream(datFile);
	if (processingError) throw processingError;
	progress.done(processedRows, writtenRows);
};

// --- Data processors ---

const processLookupCountry = async (database, src) => {
	let loadedRows = 0;
	let malformedRows = 0;
	const tmpDataFile = path.join(tmpPath, src);

	logStepInfo(database, 4, `Building country lookup table from ${src}...`);

	await processDataFileByLine(tmpDataFile, line => {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			malformedRows++;
			logStepWarn(database, 4, `Malformed lookup line skipped: ${toLogPreview(line)}`);
			return;
		}

		loadedRows++;
		countryLookup[fields[0]] = fields[4];
	});

	logStepInfo(database, 4, `Country lookup completed! loaded=${formatNumber(loadedRows)} malformed=${formatNumber(malformedRows)}`);
};

const processCountryData = (database, label, src, dest) =>
	processIPData(database, 4, label, src, dest, line => {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			logStepWarn(database, 4, `Malformed ${label} line skipped: ${toLogPreview(line)}`);
			return undefined;
		}

		const cc = countryLookup[fields[1]];
		if (!cc) return null;

		let b, bsz;
		if (fields[0].includes(':')) {
			bsz = 34;
			const [sip, eip] = ipv6RangeFromCidr(fields[0]);
			b = Buffer.alloc(bsz);
			sip.forEach((v, i) => b.writeUInt32BE(v, i * 4));
			eip.forEach((v, i) => b.writeUInt32BE(v, 16 + i * 4));
		} else {
			bsz = 10;
			const [sip, eip] = ipv4RangeFromCidr(fields[0]);
			b = Buffer.alloc(bsz);
			b.writeUInt32BE(sip, 0);
			b.writeUInt32BE(eip, 4);
		}
		b.write(cc, bsz - 2);
		return b;
	});

const processCityData = (database, label, src, dest) =>
	processIPData(database, 4, label, src, dest, line => {
		if (line.startsWith('Copyright') || !(/\d/).test(line)) return undefined;

		const fields = CSVtoArray(line);
		if (!fields || fields.length < 10) {
			logStepWarn(database, 4, `Malformed ${label} line skipped: ${toLogPreview(line)}`);
			return undefined;
		}

		const locId = cityLookup[Number.parseInt(fields[1], 10)];
		const lat = Math.round(parseFloat(fields[7]) * 10000);
		const lon = Math.round(parseFloat(fields[8]) * 10000);
		const area = Number.parseInt(fields[9], 10);

		if (fields[0].includes(':')) {
			const [sip, eip] = ipv6RangeFromCidr(fields[0]);
			const b = Buffer.alloc(48);
			sip.forEach((v, i) => b.writeUInt32BE(v, i * 4));
			eip.forEach((v, i) => b.writeUInt32BE(v, 16 + i * 4));
			b.writeUInt32BE(locId >>> 0, 32);
			b.writeInt32BE(lat, 36);
			b.writeInt32BE(lon, 40);
			b.writeInt32BE(area, 44);
			return b;
		}

		const [sip, eip] = ipv4RangeFromCidr(fields[0]);
		const b = Buffer.alloc(24);
		b.writeUInt32BE(sip >>> 0, 0);
		b.writeUInt32BE(eip >>> 0, 4);
		b.writeUInt32BE(locId >>> 0, 8);
		b.writeInt32BE(lat, 12);
		b.writeInt32BE(lon, 16);
		b.writeInt32BE(area, 20);
		return b;
	});

const processCityDataNames = async (database, src, dest) => {
	let linesCount = 0;
	let malformedRows = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	removePathSync(dataFile);
	logStepInfo(database, 4, `Processing city names: source=${src}; output=${dest}`);

	const datFile = fs.createWriteStream(dataFile);

	await processDataFileByLine(tmpDataFile, async line => {
		if (line.startsWith('Copyright') || !(/\d/).test(line)) return;

		const fields = CSVtoArray(line);
		if (!fields) {
			malformedRows++;
			logStepWarn(database, 4, `Malformed city names line skipped: ${toLogPreview(line)}`);
			return;
		}

		cityLookup[Number.parseInt(fields[0], 10)] = linesCount;

		const b = Buffer.alloc(88);
		b.write(fields[4], 0);
		b.write(fields[6], 2);
		const metro = Number.parseInt(fields[11], 10);
		if (metro) b.writeInt32BE(metro, 5);
		b.write(fields[13], 9);
		b.write(fields[12], 10);
		b.write(fields[10], 42);

		await writeBuffer(datFile, b);
		linesCount++;
	});

	await closeWriteStream(datFile);
	logStepInfo(database, 4, `City names completed! written=${formatNumber(linesCount)} malformed=${formatNumber(malformedRows)}`);
};

const processData = async database => {
	if (database.skip) return;

	const { type, src, dest } = database;
	if (type === 'country') {
		await processLookupCountry(database, src[0]);
		await processCountryData(database, 'country IPv4 data', src[1], dest[1]);
		await processCountryData(database, 'country IPv6 data', src[2], dest[2]);
	} else if (type === 'city') {
		await processCityDataNames(database, src[0], dest[0]);
		await processCityData(database, 'city IPv4 data', src[1], dest[1]);
		await processCityData(database, 'city IPv6 data', src[2], dest[2]);
	} else {
		throw new Error(`Unknown database type: "${type}"`);
	}
};

// --- Pipeline steps (async, no callbacks) ---

const check = async database => {
	if (args.includes('force')) {
		logStepInfo(database, 1, 'Force mode enabled, skipping checksum verification');
		return;
	}

	if (!database.checksum) return;

	try {
		const stored = await fs.promises.readFile(path.join(dataPath, `${database.type}.checksum`), 'utf8');
		if (stored) database.checkValue = stored;
	} catch { /* ignore – file may not exist yet */ }

	logStepInfo(database, 1, `Checking checksum for ${database.fileName}...`);

	const remote = await new Promise(resolve => {
		requestWithRedirect(database.checksum, (response, status) => {
			if (status !== 200) {
				logStepError(database, 1, `HTTP request failed [${status} ${http.STATUS_CODES[status]}]`);
				response.destroy();
				process.exit(1);
			}
			collectResponse(response).then(resolve);
		});
	});

	if (!remote) {
		logStepError(database, 1, 'Could not retrieve checksum, aborting...');
		logStepError(database, 1, 'Use "force" to bypass checksum validation');
		process.exit(1);
	}

	if (remote === database.checkValue) {
		logStepInfo(database, 1, 'Checksum unchanged, skipping download, extraction, processing and checksum write');
		database.skip = true;
	} else {
		logStepInfo(database, 1, 'New data detected, continuing with update...');
		database.checkValue = remote;
	}
};

const fetch = async database => {
	if (database.skip) return { tmpFile: null, tmpFileName: null };

	let fileName = database.fileName;
	const gzip = path.extname(fileName) === '.gz';
	if (gzip) fileName = fileName.replace('.gz', '');

	const tmpFile = path.join(tmpPath, fileName);
	if (fs.existsSync(tmpFile)) {
		logStepInfo(database, 2, `Reusing cached download: ${fileName}`);
		return { tmpFile, tmpFileName: fileName };
	}

	logStepInfo(database, 2, `Downloading ${fileName}...`);
	ensureParentDir(tmpFile);

	await new Promise((resolve, reject) => {
		requestWithRedirect(database.url, (response, status) => {
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
						reject(err);
					});
					return;
				}
				resolve();
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
	});

	return { tmpFile, tmpFileName: fileName };
};

const extract = async (database, tmpFile, tmpFileName) => {
	if (database.skip) return;

	if (path.extname(tmpFileName) !== '.zip') {
		logStepInfo(database, 3, 'Extraction skipped (non-zip file)');
		return;
	}

	logStepInfo(database, 3, `Extracting ${tmpFileName}...`);
	const zip = new AdmZip(tmpFile);
	const entries = zip.getEntries().filter(e => !e.isDirectory);

	for (const entry of entries) {
		const fileName = entry.entryName.split('/').pop();
		fs.writeFileSync(path.join(tmpPath, fileName), entry.getData());
	}

	logStepInfo(database, 3, `Extracted ${formatNumber(entries.length)} files`);
};

const updateChecksum = async database => {
	if (database.skip || !database.checkValue) return;

	try {
		await fs.promises.writeFile(path.join(dataPath, `${database.type}.checksum`), database.checkValue, 'utf8');
	} catch (err) {
		logStepError(database, 5, `Failed to write checksum: ${err.message}`);
	}
};

// --- Main ---

if (!license_key) {
	logGlobalError('Missing license_key');
	process.exit(1);
}

removePathSync(tmpPath);
fs.mkdirSync(tmpPath, { recursive: true });

const run = async () => {
	const totalDatabases = databases.length;
	for (const [index, database] of databases.entries()) {
		database._part = index + 1;
		database._totalParts = totalDatabases;
		const startedAt = Date.now();
		logPipelineInfo(database, `Starting update (${database.fileName})!`);

		await check(database);
		const { tmpFile, tmpFileName } = await fetch(database);
		await extract(database, tmpFile, tmpFileName);
		await processData(database);
		await updateChecksum(database);

		logPipelineInfo(database, `Finished update in ${formatDuration(Date.now() - startedAt)}`);
	}
};

const runStartedAt = Date.now();
run()
	.then(() => {
		log.success(`[${databases.length}/${databases.length}] All databases were successfully updated in ${formatDuration(Date.now() - runStartedAt)}!`);
		if (args.includes('debug')) {
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
