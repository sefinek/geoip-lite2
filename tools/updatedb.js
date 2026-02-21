'use strict';

const { name, version } = require('../package.json');
const UserAgent = `Mozilla/5.0 (compatible; ${name}/${version}; +https://github.com/sefinek/geoip-lite2)`;

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');

const async = require('async');
const { decodeStream } = require('iconv-lite');
const rimraf = require('rimraf').sync;
const AdmZip = require('adm-zip');
const utils = require('../scripts/utils.js');
const { Address6, Address4 } = require('ip-address');
const log = {
	info: (msg, ...logArgs) => console.log(`[INFO] ${msg}`, ...logArgs),
	success: (msg, ...logArgs) => console.log(`[SUCCESS] ${msg}`, ...logArgs),
	warn: (msg, ...logArgs) => console.warn(`[WARN] ${msg}`, ...logArgs),
	error: (msg, ...logArgs) => console.error(`[ERROR] ${msg}`, ...logArgs),
};

const args = process.argv.slice(2);
let license_key = args.find(arg => arg.match(/^license_key=[a-zA-Z0-9]+/) !== null);
if (typeof license_key === 'undefined' && typeof process.env.LICENSE_KEY !== 'undefined') {
	license_key = `license_key=${process.env.LICENSE_KEY}`;
}

let geoDataDir = args.find(arg => arg.match(/^geoDataDir=[\w./]+/) !== null);
if (typeof geoDataDir === 'undefined' && typeof process.env.GEODATADIR !== 'undefined') {
	geoDataDir = `geoDataDir=${process.env.GEODATADIR}`;
}

let dataPath = path.resolve(__dirname, '..', 'data');
if (typeof geoDataDir !== 'undefined') {
	dataPath = path.resolve(process.cwd(), geoDataDir.split('=')[1]);
	if (!fs.existsSync(dataPath)) {
		log.error('Directory does not exist:', dataPath);
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
	if (!fs.existsSync(dir)) fs.mkdirSync(dir);
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
			log.error(`Install https-proxy-agent to use an HTTP/HTTPS proxy. ${err.message}`);
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
					log.error('HTTP redirect response without location header [%d]', status);
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
			log.error('HTTP request failed:', err.message);
			process.exit(1);
		});
	};

	executeRequest(downloadUrl);
};

const writeBuffer = (stream, buffer) => new Promise((resolve, reject) => {
	const onError = err => {
		reject(err);
	};

	const onDrain = () => {
		stream.off('error', onError);
		resolve();
	};

	stream.once('error', onError);

	if (stream.write(buffer)) {
		stream.off('error', onError);
		resolve();
		return;
	}

	stream.once('drain', onDrain);
});

const closeWriteStream = stream => new Promise((resolve, reject) => {
	stream.end(err => {
		if (err) reject(err);
		else resolve();
	});
});

const processDataFileByLine = (tmpDataFile, onDataLine) => new Promise((resolve, reject) => {
	const rl = readline.createInterface({ input: fs.createReadStream(tmpDataFile), crlfDelay: Infinity });
	let settled = false;
	let closed = false;
	let lineNumber = 0;

	const finish = err => {
		if (settled) return;
		settled = true;

		if (err) {
			if (!closed) rl.close();
			reject(err);
			return;
		}

		resolve();
	};

	rl.on('line', line => {
		if (settled) return;

		lineNumber++;
		if (lineNumber === 1) return;

		rl.pause();
		Promise.resolve()
			.then(() => onDataLine(line))
			.then(() => {
				if (!settled) rl.resume();
			})
			.catch(finish);
	});

	rl.on('close', () => {
		closed = true;
		finish();
	});

	rl.on('error', finish);
});

const check = (database, cb) => {
	if (args.indexOf('force') !== -1) {
		return cb(null, database);
	}

	const checksumUrl = database.checksum;
	if (typeof checksumUrl === 'undefined') return cb(null, database);
	fs.readFile(path.join(dataPath, `${database.type}.checksum`), { encoding: 'utf8' }, (err, data) => {
		if (!err && data && data.length) database.checkValue = data;

		log.info('Checking database:', database.fileName);

		requestWithRedirect(checksumUrl, (response, status) => {
			if (status !== 200) {
				log.error('HTTP Request Failed [%d %s]', status, http.STATUS_CODES[status]);
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
						log.info(`Database "${database.type}" is up to date`);
						database.skip = true;
					} else {
						log.info(`Database "${database.type}" has new data available!`);
						database.checkValue = str;
					}
				}
				else {
					log.error(`Could not retrieve checksum for ${database.type}. Aborting...`);
					log.error('Run with "force" to update without checksum');
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
	if (fs.existsSync(tmpFile)) return cb(null, tmpFile, fileName, database);

	log.info(`Downloading ${fileName}...`);
	mkdir(tmpFile);

	requestWithRedirect(downloadUrl, (response, status) => {
		if (status !== 200) {
			log.error('HTTP Request Failed [%d %s]', status, http.STATUS_CODES[status]);
			response.destroy();
			process.exit(1);
		}

		let tmpFilePipe;
		const tmpFileStream = fs.createWriteStream(tmpFile);

		if (gzip) {
			tmpFilePipe = response.pipe(zlib.createGunzip()).pipe(tmpFileStream);
		} else {
			tmpFilePipe = response.pipe(tmpFileStream);
		}

		tmpFilePipe.on('close', () => {
			log.info(`Retrieved ${fileName}`);
			cb(null, tmpFile, fileName, database);
		});
	});
};

const extract = (tmpFile, tmpFileName, database, cb) => {
	if (database.skip) return cb(null, database);

	if (path.extname(tmpFileName) !== '.zip') {
		cb(null, database);
	} else {
		log.info(`Extracting ${tmpFileName}...`);
		const zip = new AdmZip(tmpFile);
		const zipEntries = zip.getEntries();

		zipEntries.forEach((entry) => {
			if (entry.isDirectory) return;

			const filePath = entry.entryName.split('/');
			const fileName = filePath[filePath.length - 1];
			const destinationPath = path.join(tmpPath, fileName);

			fs.writeFileSync(destinationPath, entry.getData());
		});

		cb(null, database);
	}
};

const processLookupCountry = (src, cb) => {
	const processLine = line => {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			log.warn('Malformed line detected:', line);
			return;
		}
		countryLookup[fields[0]] = fields[4];
	};
	const tmpDataFile = path.join(tmpPath, src);

	log.info('Processing lookup data...');

	const rl = readline.createInterface({ input: fs.createReadStream(tmpDataFile).pipe(decodeStream('latin1')), output: process.stdout, terminal: false });
	let settled = false;

	const finish = err => {
		if (settled) return;
		settled = true;
		if (err) cb(err);
		else cb();
	};

	let lineCount = 0;
	rl.on('line', line => {
		if (lineCount > 0) processLine(line);
		lineCount++;
	});

	rl.on('close', () => finish());
	rl.on('error', finish);
};

const processCountryData = async (src, dest) => {
	let lines = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);
	mkdir(dataFile);

	log.info('Processing country data...');
	let tstart = Date.now();
	const datFile = fs.createWriteStream(dataFile);

	const processLine = async line => {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) return log.warn('Malformed line detected:', line);

		lines++;

		let sip;
		let eip;
		let rngip;
		const cc = countryLookup[fields[1]];
		let b;
		let bsz;
		let i;
		if (cc) {
			if (fields[0].match(/:/)) {
				bsz = 34;
				rngip = new Address6(fields[0]);
				sip = utils.aton6(rngip.startAddress().correctForm());
				eip = utils.aton6(rngip.endAddress().correctForm());

				b = Buffer.alloc(bsz);
				for (i = 0; i < sip.length; i++) {
					b.writeUInt32BE(sip[i], i * 4);
				}

				for (i = 0; i < eip.length; i++) {
					b.writeUInt32BE(eip[i], 16 + (i * 4));
				}
			} else {
				bsz = 10;

				rngip = new Address4(fields[0]);
				sip = parseInt(rngip.startAddress().bigInt().toString(), 10);
				eip = parseInt(rngip.endAddress().bigInt().toString(), 10);

				b = Buffer.alloc(bsz);
				b.fill(0);
				b.writeUInt32BE(sip, 0);
				b.writeUInt32BE(eip, 4);
			}

			b.write(cc, bsz - 2);
			if (Date.now() - tstart > 5000) {
				tstart = Date.now();
				log.info(`Processing country data (${lines} entries)`);
			}

			await writeBuffer(datFile, b);
		}
	};

	let processingError = null;
	try {
		await processDataFileByLine(tmpDataFile, processLine);
	} catch (err) {
		processingError = err;
	}

	await closeWriteStream(datFile);
	if (processingError) throw processingError;
};

const processCityData = async (src, dest) => {
	let lines = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);

	log.info('Processing city data...');
	let tstart = Date.now();
	const datFile = fs.createWriteStream(dataFile);

	const processLine = async line => {
		if (line.match(/^Copyright/) || !line.match(/\d/)) return;

		const fields = CSVtoArray(line);
		if (!fields) return log.warn('Malformed line detected:', line);
		let sip;
		let eip;
		let rngip;
		let locId;
		let b;
		let bsz;
		let lat;
		let lon;
		let area;

		let i;

		lines++;

		if (fields[0].match(/:/)) {
			let offset = 0;
			bsz = 48;
			rngip = new Address6(fields[0]);
			sip = utils.aton6(rngip.startAddress().correctForm());
			eip = utils.aton6(rngip.endAddress().correctForm());
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

			rngip = new Address4(fields[0]);
			sip = parseInt(rngip.startAddress().bigInt().toString(), 10);
			eip = parseInt(rngip.endAddress().bigInt().toString(), 10);
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

		if (Date.now() - tstart > 5000) {
			tstart = Date.now();
			log.info(`Processing city data (${lines} entries)`);
		}

		await writeBuffer(datFile, b);
	};

	let processingError = null;
	try {
		await processDataFileByLine(tmpDataFile, processLine);
	} catch (err) {
		processingError = err;
	}

	await closeWriteStream(datFile);
	if (processingError) throw processingError;
};

const processCityDataNames = (src, dest, cb) => {
	let locId = null;
	let linesCount = 0;
	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);

	const datFile = fs.openSync(dataFile, 'w');

	const processLine = (line) => {
		if (line.match(/^Copyright/) || !line.match(/\d/)) return;

		const b = Buffer.alloc(88);
		const fields = CSVtoArray(line);
		if (!fields) {
			log.warn('Malformed line detected:', line);
			return;
		}

		locId = parseInt(fields[0]);

		cityLookup[locId] = linesCount;
		const cc = fields[4];
		const rg = fields[6];
		const city = fields[10];
		const metro = parseInt(fields[11]);
		const tz = fields[12];
		const eu = fields[13];

		b.fill(0);
		b.write(cc, 0);
		b.write(rg, 2);

		if (metro) b.writeInt32BE(metro, 5);
		b.write(eu, 9);
		b.write(tz, 10);
		b.write(city, 42);

		fs.writeSync(datFile, b, 0, b.length, null);
		linesCount++;
	};

	const rl = readline.createInterface({ input: fs.createReadStream(tmpDataFile).pipe(decodeStream('utf-8')), output: process.stdout, terminal: false });
	let settled = false;

	const finish = (err) => {
		if (settled) return;
		settled = true;
		fs.closeSync(datFile);
		if (err) cb(err);
		else cb();
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
			processLookupCountry(src[0], err => {
				if (err) return cb(err);
				processCountryData(src[1], dest[1]).then(() => {
					return processCountryData(src[2], dest[2]);
				}).then(() => {
					cb(null, database);
				}).catch(cb);
			});
		}
		else {
			processCountryData(src, dest).then(() => {
				cb(null, database);
			}).catch(cb);
		}
	} else if (type === 'city') {
		processCityDataNames(src[0], dest[0], err => {
			if (err) return cb(err);
			processCityData(src[1], dest[1]).then(() => {
				log.info('Processed city IPv4 data');
				return processCityData(src[2], dest[2]);
			}).then(() => {
				log.info('Processed city IPv6 data');
				cb(null, database);
			}).catch(cb);
		});
	}
};

const updateChecksum = (database, cb) => {
	if (database.skip || !database.checkValue) return cb();

	fs.writeFile(path.join(dataPath, database.type + '.checksum'), database.checkValue, 'utf8', err => {
		if (err) log.error('Failed to update checksum for database:', database.type);
		cb();
	});
};

if (!license_key) {
	log.error('Missing license_key');
	process.exit(1);
}

rimraf(tmpPath);
mkdir(tmpPath);

async.eachSeries(databases, (database, nextDatabase) => {
	async.seq(check, fetch, extract, processData, updateChecksum)(database, nextDatabase);
}, err => {
	if (err) {
		log.error('Failed to update databases from MaxMind!', err);
		process.exit(1);
	} else {
		log.success('All databases have been successfully updated from MaxMind');
		if (args.indexOf('debug') !== -1) {
			log.info('Debug mode: temporary files preserved at ' + tmpPath);
		} else {
			rimraf(tmpPath);
		}
		process.exit(0);
	}
});
