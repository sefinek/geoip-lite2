const { name, version, homepage } = require('../package.json');

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const AdmZip = require('adm-zip');
const { ipv4RangeFromCidr, ipv6RangeFromCidr, NO_LOCATION_INFO } = require('../scripts/utils.js');

const USER_AGENT = `Mozilla/5.0 (compatible; ${name}/${version}; +${homepage})`;
const MAXMIND_DOWNLOAD_URL = 'https://download.maxmind.com/app/geoip_download';

const COUNTRY_RECORD_SIZE = 10;
const COUNTRY6_RECORD_SIZE = 34;
const CITY_RECORD_SIZE = 24;
const CITY6_RECORD_SIZE = 48;
const LOCATION_RECORD_SIZE = 88;

const WRITE_BATCH_SIZE = 256 * 1024;
const PROGRESS_INTERVAL_MS = 10 * 1000;
const HTTP_TIMEOUT_MS = 15 * 60 * 1000;
const SHA256_RE = /^[a-f0-9]{64}\b/i;

// Failure with a message that is meant to be shown to the user as is (no stack trace).
class UpdateError extends Error {}

// --- Logging ---

const TOTAL_STEPS = 5;
const MAX_MALFORMED_LOGS = 5;

const formatNumber = value => Number(value).toLocaleString('en-US');
const formatDuration = ms => {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
};
const toLogPreview = line => line.length > 120 ? `${line.slice(0, 117)}...` : line;

// Messages are prefixed with the database and the pipeline step, e.g. "[CITY 4/5] ...".
const createLogger = (database, step) => {
	const prefix = step ? `[${database.type.toUpperCase()} ${step}/${TOTAL_STEPS}]` : `[${database.type.toUpperCase()}]`;

	return {
		info: msg => console.log(`${prefix} ${msg}`),
		warn: msg => console.warn(`${prefix} ${msg}`),
		error: msg => console.error(`${prefix} ${msg}`),
	};
};

const createProgressLogger = (log, activity) => {
	const startedAt = Date.now();
	let lastLogAt = startedAt;
	const averagePerSecond = (processed, now) => formatNumber(Math.round(processed / Math.max((now - startedAt) / 1000, 1)));

	return {
		maybeLog: (processed, written) => {
			const now = Date.now();
			if (now - lastLogAt < PROGRESS_INTERVAL_MS) return;

			lastLogAt = now;
			log.info(`${activity}: ${formatNumber(processed)} rows processed, ${formatNumber(written)} written (avg ${averagePerSecond(processed, now)}/s)`);
		},
		done: (processed, written) => {
			const now = Date.now();
			log.info(`${activity}: done, ${formatNumber(processed)} rows processed, ${formatNumber(written)} written in ${formatDuration(now - startedAt)} (avg ${averagePerSecond(processed, now)}/s)`);
		},
	};
};

// Logs only the first few malformed lines of a file, so a broken file cannot flood the console.
const createMalformedTracker = (log, what) => {
	let count = 0;

	return {
		report: line => {
			count++;
			if (count <= MAX_MALFORMED_LOGS) log.warn(`Skipping malformed ${what} line: ${toLogPreview(line)}`);
			else if (count === MAX_MALFORMED_LOGS + 1) log.warn(`Further malformed ${what} lines will be skipped silently`);
		},
		summarize: () => {
			if (count > 0) log.warn(`Skipped ${formatNumber(count)} malformed ${what} lines`);
		},
	};
};

// --- Configuration ---

const readArg = (args, key) => {
	const prefix = `${key}=`;
	const arg = args.find(a => a.startsWith(prefix) && a.length > prefix.length);
	return arg ? arg.slice(prefix.length) : undefined;
};

const buildDatabases = licenseKey => {
	const url = (edition, suffix) => `${MAXMIND_DOWNLOAD_URL}?${new URLSearchParams({ edition_id: edition, suffix, license_key: licenseKey })}`;

	return [
		{
			type: 'country',
			url: url('GeoLite2-Country-CSV', 'zip'),
			checksumUrl: url('GeoLite2-Country-CSV', 'zip.sha256'),
			fileName: 'GeoLite2-Country-CSV.zip',
			src: ['GeoLite2-Country-Locations-en.csv', 'GeoLite2-Country-Blocks-IPv4.csv', 'GeoLite2-Country-Blocks-IPv6.csv'],
			dest: ['', 'geoip-country.dat', 'geoip-country6.dat'],
		},
		{
			type: 'city',
			url: url('GeoLite2-City-CSV', 'zip'),
			checksumUrl: url('GeoLite2-City-CSV', 'zip.sha256'),
			fileName: 'GeoLite2-City-CSV.zip',
			src: ['GeoLite2-City-Locations-en.csv', 'GeoLite2-City-Blocks-IPv4.csv', 'GeoLite2-City-Blocks-IPv6.csv'],
			dest: ['geoip-city-names.dat', 'geoip-city.dat', 'geoip-city6.dat'],
		},
	];
};

const createConfig = (args, env) => {
	const licenseKey = readArg(args, 'license_key') ?? env.MAXMIND_KEY;
	if (!licenseKey) throw new UpdateError('Missing license_key');

	const geoDataDir = readArg(args, 'geoDataDir') ?? env.GEOIP_DATA_DIR;
	const dataPath = geoDataDir ? path.resolve(process.cwd(), geoDataDir) : path.resolve(__dirname, '..', 'data');
	if (geoDataDir && !fs.existsSync(dataPath)) throw new UpdateError(`Directory does not exist: ${dataPath}`);

	return {
		dataPath,
		tmpBasePath: env.GEOIP_TMP_DIR || path.resolve(__dirname, '..', 'tmp'),
		force: args.includes('force'),
		debug: args.includes('debug'),
		databases: buildDatabases(licenseKey),
	};
};

// --- CSV parsing ---

const isBlank = ch => ch === ' ' || ch === '\t';

// Minimal RFC 4180 parser: quoted fields with "" escapes, unquoted fields trimmed. Returns null for malformed lines.
const parseCsvLine = line => {
	if (!line.includes('"')) return line.split(',').map(field => field.trim());

	const fields = [];
	const length = line.length;
	let pos = 0;

	for (;;) {
		while (pos < length && isBlank(line[pos])) pos++;

		let value;
		if (line[pos] === '"') {
			value = '';
			let from = ++pos;
			for (;;) {
				const quote = line.indexOf('"', from);
				if (quote === -1) return null;

				value += line.slice(pos, quote);
				if (line[quote + 1] === '"') {
					value += '"';
					pos = from = quote + 2;
				} else {
					pos = quote + 1;
					break;
				}
			}

			while (pos < length && isBlank(line[pos])) pos++;
			if (pos < length && line[pos] !== ',') return null;
		} else {
			let comma = line.indexOf(',', pos);
			if (comma === -1) comma = length;
			value = line.slice(pos, comma).trim();
			if (value.includes('"')) return null;
			pos = comma;
		}

		fields.push(value);
		if (pos >= length) return fields;
		pos++;
	}
};

// --- HTTP ---

const httpGet = async url => {
	let response;
	try {
		response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
	} catch (err) {
		throw new UpdateError(`HTTP request failed: ${err.cause?.message ?? err.message}`);
	}

	if (response.status !== 200) {
		await response.body?.cancel();
		throw new UpdateError(`HTTP request failed [${response.status} ${http.STATUS_CODES[response.status]}]`);
	}

	return response;
};

// --- Files and streams ---

const sha256File = async filePath => {
	const hash = crypto.createHash('sha256');
	await pipeline(fs.createReadStream(filePath), hash);
	return hash.digest('hex');
};

// Yields every line except the header.
async function* readDataLines(filePath) {
	const input = fs.createReadStream(filePath, { encoding: 'utf8' });
	const lines = readline.createInterface({ input, crlfDelay: Infinity });

	try {
		let isHeader = true;
		for await (const line of lines) {
			if (isHeader) {
				isHeader = false;
				continue;
			}

			yield line;
		}
	} finally {
		lines.close();
		input.destroy();
	}
}

// Groups small records into large chunks, so the file stream is not written to once per record.
async function* batchBuffers(buffers, size = WRITE_BATCH_SIZE) {
	let chunk = Buffer.allocUnsafe(size);
	let used = 0;

	for await (const buffer of buffers) {
		if (used + buffer.length > size) {
			yield chunk.subarray(0, used);
			chunk = Buffer.allocUnsafe(size);
			used = 0;
		}

		buffer.copy(chunk, used);
		used += buffer.length;
	}

	if (used > 0) yield chunk.subarray(0, used);
}

// Data files are first written to staging files and renamed together once the whole database is built.
// This way a process watching the data directory never sees a partially written file or a mix of old and new files
// (e.g. new city names with an old IPv4 index, which would break location ids).
const stageDataFile = async (ctx, filePath, buffers) => {
	const stagingFile = `${filePath}.tmp`;

	try {
		await pipeline(batchBuffers(buffers), fs.createWriteStream(stagingFile));
	} catch (err) {
		await fsp.rm(stagingFile, { force: true });
		throw err;
	}

	ctx.staged.push({ stagingFile, filePath });
};

const commitStagedFiles = async ctx => {
	while (ctx.staged.length > 0) {
		const { stagingFile, filePath } = ctx.staged[0];
		await fsp.rename(stagingFile, filePath);
		ctx.staged.shift();
	}
};

const discardStagedFiles = async ctx => {
	const staged = ctx.staged.splice(0);
	await Promise.all(staged.map(({ stagingFile }) => fsp.rm(stagingFile, { force: true })));
};

// --- Record builders ---

const writeRange4 = (buffer, [start, end]) => {
	buffer.writeUInt32BE(start, 0);
	buffer.writeUInt32BE(end, 4);
};

const writeRange6 = (buffer, [start, end]) => {
	for (let i = 0; i < 4; i++) {
		buffer.writeUInt32BE(start[i], i * 4);
		buffer.writeUInt32BE(end[i], 16 + (i * 4));
	}
};

const buildCountryRecord = (cidr, countryCode) => {
	const isIpv6 = cidr.includes(':');
	const buffer = Buffer.alloc(isIpv6 ? COUNTRY6_RECORD_SIZE : COUNTRY_RECORD_SIZE);

	if (isIpv6) writeRange6(buffer, ipv6RangeFromCidr(cidr)); else writeRange4(buffer, ipv4RangeFromCidr(cidr));
	buffer.write(countryCode, buffer.length - 2);
	return buffer;
};

const buildCityRecord = (cidr, locationId, lat, lon, area) => {
	const isIpv6 = cidr.includes(':');
	const buffer = Buffer.alloc(isIpv6 ? CITY6_RECORD_SIZE : CITY_RECORD_SIZE);
	const base = isIpv6 ? 32 : 8;

	if (isIpv6) writeRange6(buffer, ipv6RangeFromCidr(cidr)); else writeRange4(buffer, ipv4RangeFromCidr(cidr));
	buffer.writeUInt32BE(locationId >>> 0, base);
	buffer.writeInt32BE(lat, base + 4);
	buffer.writeInt32BE(lon, base + 8);
	buffer.writeUInt32BE(area, base + 12);
	return buffer;
};

// --- Data processors ---

// buildRecord(line, malformed) contract:
//   undefined -> skip the line entirely (not counted, e.g. malformed)
//   null      -> count as processed, but do not write (e.g. country with unknown cc)
//   Buffer    -> count as processed and write
const processIPData = async (ctx, database, label, src, dest, buildRecord) => {
	const log = createLogger(database, 4);
	const stats = { processed: 0, written: 0 };
	const progress = createProgressLogger(log, label);
	const malformed = createMalformedTracker(log, label);
	const dataFile = path.join(ctx.dataPath, dest);

	log.info(`${label}: ${src} -> ${dest}`);

	async function* records() {
		for await (const line of readDataLines(path.join(ctx.tmpPath, src))) {
			const record = buildRecord(line, malformed);
			if (record === undefined) continue;

			stats.processed++;
			if (record !== null) {
				stats.written++;
				yield record;
			}

			progress.maybeLog(stats.processed, stats.written);
		}
	}

	await fsp.mkdir(path.dirname(dataFile), { recursive: true });
	await stageDataFile(ctx, dataFile, records());
	malformed.summarize();
	progress.done(stats.processed, stats.written);
};

const processLookupCountry = async (ctx, database, src) => {
	const log = createLogger(database, 4);
	const malformed = createMalformedTracker(log, 'country lookup');
	let loadedRows = 0;

	log.info(`Country lookup: building from ${src}`);

	for await (const line of readDataLines(path.join(ctx.tmpPath, src))) {
		const fields = parseCsvLine(line);
		if (!fields || fields.length < 6) {
			malformed.report(line);
			continue;
		}

		loadedRows++;
		ctx.countryLookup.set(fields[0], fields[4]);
	}

	malformed.summarize();
	log.info(`Country lookup: done, ${formatNumber(loadedRows)} countries loaded`);
};

const processCountryData = (ctx, database, label, src, dest) =>
	processIPData(ctx, database, label, src, dest, (line, malformed) => {
		const fields = parseCsvLine(line);
		if (!fields || fields.length < 6) {
			malformed.report(line);
			return undefined;
		}

		const countryCode = ctx.countryLookup.get(fields[1]);
		return countryCode ? buildCountryRecord(fields[0], countryCode) : null;
	});

const processCityData = (ctx, database, label, src, dest) =>
	processIPData(ctx, database, label, src, dest, (line, malformed) => {
		if (line.startsWith('Copyright') || !(/\d/).test(line)) return undefined;

		const fields = parseCsvLine(line);
		if (!fields || fields.length < 10) {
			malformed.report(line);
			return undefined;
		}

		const locationId = ctx.cityLookup.get(Number.parseInt(fields[1], 10)) ?? NO_LOCATION_INFO;
		const lat = Math.round(Number.parseFloat(fields[7]) * 10000);
		const lon = Math.round(Number.parseFloat(fields[8]) * 10000);
		const area = Number.parseInt(fields[9], 10);

		return buildCityRecord(fields[0], locationId, lat, lon, area);
	});

const processCityDataNames = async (ctx, database, src, dest) => {
	const log = createLogger(database, 4);
	const malformed = createMalformedTracker(log, 'city names');
	const dataFile = path.join(ctx.dataPath, dest);
	let linesCount = 0;

	log.info(`City names: ${src} -> ${dest}`);

	async function* records() {
		for await (const line of readDataLines(path.join(ctx.tmpPath, src))) {
			if (line.startsWith('Copyright') || !(/\d/).test(line)) continue;

			const fields = parseCsvLine(line);
			if (!fields || fields.length < 14) {
				malformed.report(line);
				continue;
			}

			ctx.cityLookup.set(Number.parseInt(fields[0], 10), linesCount++);

			const buffer = Buffer.alloc(LOCATION_RECORD_SIZE);
			buffer.write(fields[4], 0);
			buffer.write(fields[6], 2);
			const metro = Number.parseInt(fields[11], 10);
			if (metro) buffer.writeInt32BE(metro, 5);
			buffer.write(fields[13], 9);
			buffer.write(fields[12], 10);
			buffer.write(fields[10], 42);
			yield buffer;
		}
	}

	await fsp.mkdir(path.dirname(dataFile), { recursive: true });
	await stageDataFile(ctx, dataFile, records());
	malformed.summarize();
	log.info(`City names: done, ${formatNumber(linesCount)} locations written`);
};

const processData = async (ctx, database) => {
	const { type, src, dest } = database;
	ctx.staged = [];

	try {
		if (type === 'country') {
			await processLookupCountry(ctx, database, src[0]);
			await processCountryData(ctx, database, 'IPv4 data', src[1], dest[1]);
			await processCountryData(ctx, database, 'IPv6 data', src[2], dest[2]);
		} else if (type === 'city') {
			await processCityDataNames(ctx, database, src[0], dest[0]);
			await processCityData(ctx, database, 'IPv4 data', src[1], dest[1]);
			await processCityData(ctx, database, 'IPv6 data', src[2], dest[2]);
		} else {
			throw new Error(`Unknown database type: "${type}"`);
		}

		await commitStagedFiles(ctx);
	} finally {
		await discardStagedFiles(ctx);
	}
};

// --- Pipeline steps ---

const readStoredChecksum = async (ctx, database) => {
	try {
		return (await fsp.readFile(path.join(ctx.dataPath, `${database.type}.checksum`), 'utf8')).trim();
	} catch (err) {
		if (err.code === 'ENOENT') return '';
		throw err;
	}
};

// Returns false when the data is up to date and the remaining steps can be skipped.
const check = async (ctx, database) => {
	const log = createLogger(database, 1);

	if (ctx.force) {
		log.info('Force mode enabled, skipping the checksum check');
		return true;
	}

	log.info(`Checking the checksum of ${database.fileName}`);

	const response = await httpGet(database.checksumUrl);
	const remote = (await response.text()).trim();
	if (!remote) throw new UpdateError('Could not retrieve the checksum. Use "force" to bypass the checksum check');

	if (remote === await readStoredChecksum(ctx, database)) {
		log.info('Data is up to date, nothing to do');
		return false;
	}

	log.info('New data available');
	database.checkValue = remote;
	return true;
};

const verifyDownload = async (database, filePath) => {
	const log = createLogger(database, 2);
	const expected = SHA256_RE.exec(database.checkValue ?? '')?.[0].toLowerCase();
	if (!expected) {
		if (database.checkValue) log.warn('Unexpected checksum file format, skipping SHA-256 verification');
		return;
	}

	const actual = await sha256File(filePath);
	if (actual !== expected) throw new UpdateError(`SHA-256 mismatch for ${database.fileName} (expected ${expected}, got ${actual})`);

	log.info('SHA-256 verified');
};

const download = async (ctx, database) => {
	const tmpFile = path.join(ctx.tmpPath, database.fileName);

	createLogger(database, 2).info(`Downloading ${database.fileName}`);

	const response = await httpGet(database.url);
	await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpFile));
	await verifyDownload(database, tmpFile);

	return tmpFile;
};

const extract = async (ctx, database, zipFile) => {
	const log = createLogger(database, 3);
	log.info(`Extracting ${database.fileName}`);

	const wanted = new Set(database.src);
	const entries = new AdmZip(zipFile).getEntries().filter(entry => !entry.isDirectory && wanted.has(path.posix.basename(entry.entryName)));

	const missing = database.src.filter(file => !entries.some(entry => path.posix.basename(entry.entryName) === file));
	if (missing.length > 0) throw new UpdateError(`Missing files in the archive: ${missing.join(', ')}`);

	for (const entry of entries) {
		await fsp.writeFile(path.join(ctx.tmpPath, path.posix.basename(entry.entryName)), entry.getData());
	}

	log.info(`Extracted ${entries.length} files`);
};

const updateChecksum = async (ctx, database) => {
	if (!database.checkValue) return;

	try {
		await fsp.writeFile(path.join(ctx.dataPath, `${database.type}.checksum`), `${database.checkValue}\n`, 'utf8');
	} catch (err) {
		createLogger(database, 5).error(`Failed to save the checksum: ${err.message}`);
	}
};

// --- Main ---

const updateDatabase = async (ctx, database) => {
	const log = createLogger(database);
	const startedAt = Date.now();

	try {
		log.info(`Updating from ${database.fileName}`);
		if (!await check(ctx, database)) return;

		const zipFile = await download(ctx, database);
		await extract(ctx, database, zipFile);
		await processData(ctx, database);
		await updateChecksum(ctx, database);

		log.info(`Finished in ${formatDuration(Date.now() - startedAt)}`);
	} catch (err) {
		if (err instanceof UpdateError) err.message = `[${database.type.toUpperCase()}] ${err.message}`;
		throw err;
	}
};

const run = async config => {
	// Makes fetch() honor HTTP_PROXY, HTTPS_PROXY and NO_PROXY.
	http.setGlobalProxyFromEnv();

	await fsp.mkdir(config.tmpBasePath, { recursive: true });

	// A dedicated directory, so cleanup never touches anything else inside GEOIP_TMP_DIR.
	const ctx = {
		dataPath: config.dataPath,
		tmpPath: await fsp.mkdtemp(path.join(config.tmpBasePath, 'geoip-')),
		force: config.force,
		countryLookup: new Map(),
		cityLookup: new Map(),
	};

	try {
		for (const database of config.databases) await updateDatabase(ctx, database);
	} finally {
		if (config.debug) {
			console.log(`Debug mode: temporary files preserved at ${ctx.tmpPath}`);
		} else {
			await fsp.rm(ctx.tmpPath, { recursive: true, force: true });
		}
	}
};

const main = async () => {
	const startedAt = Date.now();

	try {
		const config = createConfig(process.argv.slice(2), process.env);
		await run(config);
		console.log(`All databases are up to date (${formatDuration(Date.now() - startedAt)})`);
	} catch (err) {
		console.error(err instanceof UpdateError ? `Error: ${err.message}` : `Error: Failed to update databases from MaxMind\n${err?.stack || err}`);
		process.exitCode = 1;
	}
};

if (require.main === module) {
	void main();
} else {
	module.exports = { parseCsvLine, batchBuffers, readDataLines, stageDataFile, commitStagedFiles, discardStagedFiles, buildCountryRecord, buildCityRecord, createConfig, processData, UpdateError };
}
