// Fetches and converts MaxMind lite databases

'use strict';

const { name, version } = require('../package.json');
const user_agent = `Mozilla/5.0 (compatible; ${name}/${version}; +https://sefinek.net)`;

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const url = require('node:url');
const zlib = require('node:zlib');

fs.existsSync = fs.existsSync || path.existsSync;

const async = require('async');
const chalk = require('chalk');
const iconv = require('iconv-lite');
const lazy = require('lazy');
const rimraf = require('rimraf').sync;
const AdmZip = require('adm-zip');
const utils = require('../lib/utils.js');
const { Address6, Address4 } = require('ip-address');

const args = process.argv.slice(2);
let license_key = args.find(function(arg) {
	return arg.match(/^license_key=[a-zA-Z0-9]+/) !== null;
});
if (typeof license_key === 'undefined' && typeof process.env.LICENSE_KEY !== 'undefined') {
	license_key = 'license_key=' + process.env.LICENSE_KEY;
}
let geodatadir = args.find(function(arg) {
	return arg.match(/^geodatadir=[\w./]+/) !== null;
});
if (typeof geodatadir === 'undefined' && typeof process.env.GEODATADIR !== 'undefined') {
	geodatadir = 'geodatadir=' + process.env.GEODATADIR;
}
let dataPath = path.resolve(__dirname, '..', 'data');
if (typeof geodatadir !== 'undefined') {
	dataPath = path.resolve(process.cwd(), geodatadir.split('=')[1]);
	if (!fs.existsSync(dataPath)) {
		console.log(chalk.red('ERROR') + ': Directory doesn\'t exist: ' + dataPath);
		process.exit(1);
	}
}
const tmpPath = path.resolve(__dirname, '..', 'tmp');
const countryLookup = {};
const cityLookup = {};
const databases = [{
	type: 'country',
	url: 'https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country-CSV&suffix=zip&' + license_key,
	checksum: 'https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country-CSV&suffix=zip.sha256&' + license_key,
	fileName: 'GeoLite2-Country-CSV.zip',
	src: [
		'GeoLite2-Country-Locations-en.csv',
		'GeoLite2-Country-Blocks-IPv4.csv',
		'GeoLite2-Country-Blocks-IPv6.csv',
	],
	dest: [
		'',
		'geoip-country.dat',
		'geoip-country6.dat',
	],
}, {
	type: 'city',
	url: 'https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City-CSV&suffix=zip&' + license_key,
	checksum: 'https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City-CSV&suffix=zip.sha256&' + license_key,
	fileName: 'GeoLite2-City-CSV.zip',
	src: [
		'GeoLite2-City-Locations-en.csv',
		'GeoLite2-City-Blocks-IPv4.csv',
		'GeoLite2-City-Blocks-IPv6.csv',
	],
	dest: [
		'geoip-city-names.dat',
		'geoip-city.dat',
		'geoip-city6.dat',
	],
}];

function mkdir(dirName) {
	const dir = path.dirname(dirName);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

// Ref: http://stackoverflow.com/questions/8493195/how-can-i-parse-a-csv-string-with-javascript
// Return array of string values, or NULL if CSV string not well-formed.
// Return array of string values, or NULL if CSV string not well-formed.

function try_fixing_line(line) {
	let pos1 = 0;
	let pos2 = -1;
	// Escape quotes
	line = line.replace(/""/, '\\"').replace(/'/g, '\\\'');

	while (pos1 < line.length && pos2 < line.length) {
		pos1 = pos2;
		pos2 = line.indexOf(',', pos1 + 1);
		if (pos2 < 0) pos2 = line.length;
		if (line.indexOf('\'', (pos1 || 0)) > -1 && line.indexOf('\'', pos1) < pos2 && line[pos1 + 1] != '"' && line[pos2 - 1] != '"') {
			line = line.substr(0, pos1 + 1) + '"' + line.substr(pos1 + 1, pos2 - pos1 - 1) + '"' + line.substr(pos2, line.length - pos2);
			pos2 = line.indexOf(',', pos2 + 1);
			if (pos2 < 0) pos2 = line.length;
		}
	}
	return line;
}

function CSVtoArray(text) {
	const re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
	const re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
	// Return NULL if input string is not well-formed CSV string.
	if (!re_valid.test(text)) {
		text = try_fixing_line(text);
		if (!re_valid.test(text))
		{return null;}
	}
	const a = []; // Initialize array to receive values.
	text.replace(re_value, // "Walk" the string using replace with callback.
		function(m0, m1, m2, m3) {
			// Remove backslash from \' in single quoted values.
			if (m1 !== undefined) a.push(m1.replace(/\\'/g, '\''));
			// Remove backslash from \" in double-quoted values.
			else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"').replace(/\\'/g, '\''));
			else if (m3 !== undefined) a.push(m3);
			return ''; // Return empty string.
		});
	// Handle special case of empty last value.
	if ((/,\s*$/).test(text)) a.push('');
	return a;
}

function getHTTPOptions(downloadUrl) {
	const options = url.parse(downloadUrl);
	options.headers = {
		'User-Agent': user_agent,
	};

	if (process.env.http_proxy || process.env.https_proxy) {
		try {
			const HttpsProxyAgent = require('node:https-proxy-agent');
			options.agent = new HttpsProxyAgent(process.env.http_proxy || process.env.https_proxy);
		}
		catch (e) {
			console.error('Install https-proxy-agent to use an HTTP/HTTPS proxy');
			process.exit(-1);
		}
	}

	return options;
}

function check(database, cb) {
	if (args.indexOf('force') !== -1) {
		// We are forcing database upgrade,
		// So not even using checksums
		return cb(null, database);
	}

	const checksumUrl = database.checksum;

	if (typeof checksumUrl === 'undefined') {
		// No checksum url to check, skipping
		return cb(null, database);
	}

	// Read existing checksum file
	fs.readFile(path.join(dataPath, database.type + '.checksum'), { encoding: 'utf8' }, function(err, data) {
		if (!err && data && data.length) database.checkValue = data;

		console.log('Checking ', database.fileName);

		function onResponse(response) {
			const status = response.statusCode;
			if (status !== 200) {
				console.log(chalk.red('ERROR') + response.data);
				console.log(chalk.red('ERROR') + ': HTTP Request Failed [%d %s]', status, http.STATUS_CODES[status]);
				client.abort();
				process.exit(1);
			}

			let str = '';
			response.on('data', function(chunk) {
				str += chunk;
			});

			response.on('end', function() {
				if (str && str.length) {
					if (str == database.checkValue) {
						console.log(chalk.green('Database "' + database.type + '" is up to date'));
						database.skip = true;
					}
					else {
						console.log(chalk.green('Database ' + database.type + ' has new data'));
						database.checkValue = str;
					}
				}
				else {
					console.log(chalk.red('ERROR') + ': Could not retrieve checksum for', database.type, chalk.red('Aborting'));
					console.log('Run with "force" to update without checksum');
					client.abort();
					process.exit(1);
				}
				cb(null, database);
			});
		}

		var client = https.get(getHTTPOptions(checksumUrl), onResponse);
	});
}

function fetch(database, cb) {
	if (database.skip) return cb(null, null, null, database);

	const downloadUrl = database.url;
	let fileName = database.fileName;
	const gzip = path.extname(fileName) === '.gz';
	if (gzip) fileName = fileName.replace('.gz', '');

	const tmpFile = path.join(tmpPath, fileName);
	if (fs.existsSync(tmpFile)) return cb(null, tmpFile, fileName, database);

	console.log('Fetching ', fileName);

	function onResponse(response) {
		const status = response.statusCode;

		if (status !== 200) {
			console.error(chalk.red('ERROR') + ': HTTP Request Failed [%d %s]', status, http.STATUS_CODES[status]);
			client.abort();
			process.exit(1);
		}

		let tmpFilePipe;
		const tmpFileStream = fs.createWriteStream(tmpFile);

		if (gzip) {
			tmpFilePipe = response.pipe(zlib.createGunzip()).pipe(tmpFileStream);
		} else {
			tmpFilePipe = response.pipe(tmpFileStream);
		}

		tmpFilePipe.on('close', function() {
			console.log(chalk.green(' DONE'));
			cb(null, tmpFile, fileName, database);
		});
	}

	mkdir(tmpFile);

	var client = https.get(getHTTPOptions(downloadUrl), onResponse);

	process.stdout.write('Retrieving ' + fileName + '...');
}

function extract(tmpFile, tmpFileName, database, cb) {
	if (database.skip) {
		return cb(null, database);
	}

	if (path.extname(tmpFileName) !== '.zip') {
		cb(null, database);
	} else {
		process.stdout.write('Extracting ' + tmpFileName + '...');
		const zip = new AdmZip(tmpFile);
		const zipEntries = zip.getEntries();

		zipEntries.forEach((entry) => {
			if (entry.isDirectory) {
				// Skip directory entries
				return;
			}

			const filePath = entry.entryName.split('/');
			const fileName = filePath[filePath.length - 1];
			const destinationPath = path.join(tmpPath, fileName);

			fs.writeFileSync(destinationPath, entry.getData());
		});

		console.log(chalk.green(' DONE'));
		cb(null, database);
	}
}

function processLookupCountry(src, cb) {
	function processLine(line) {
		const fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			console.log('weird line: %s::', line);
			return;
		}
		countryLookup[fields[0]] = fields[4];
	}
	const tmpDataFile = path.join(tmpPath, src);

	process.stdout.write('Processing Lookup Data (may take a moment)...');

	lazy(fs.createReadStream(tmpDataFile))
	.lines
	.map(function(byteArray) {
		return iconv.decode(byteArray, 'latin1');
	})
	.skip(1)
	.map(processLine)
	.on('pipe', function() {
		console.log(chalk.green(' DONE'));
		cb();
	});
}

function processCountryData(src, dest, cb) {
	let lines = 0;
	function processLine(line) {
		const fields = CSVtoArray(line);

		if (!fields || fields.length < 6) {
			console.warn('weird line: %s::', line);
			return;
		}
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
				// IPv6
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
				// IPv4
				bsz = 10;

				rngip = new Address4(fields[0]);
				sip = parseInt(rngip.startAddress().bigInteger(), 10);
				eip = parseInt(rngip.endAddress().bigInteger(), 10);

				b = Buffer.alloc(bsz);
				b.fill(0);
				b.writeUInt32BE(sip, 0);
				b.writeUInt32BE(eip, 4);
			}

			b.write(cc, bsz - 2);

			fs.writeSync(datFile, b, 0, bsz, null);
			if (Date.now() - tstart > 5000) {
				tstart = Date.now();
				process.stdout.write('\nStill working (' + lines + ')...');
			}
		}
	}

	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);
	mkdir(dataFile);

	process.stdout.write('Processing data (may take a moment)...');
	var tstart = Date.now();
	var datFile = fs.openSync(dataFile, 'w');

	lazy(fs.createReadStream(tmpDataFile))
	.lines
	.map(function(byteArray) {
		return iconv.decode(byteArray, 'latin1');
	})
	.skip(1)
	.map(processLine)
	.on('pipe', function() {
		console.log(chalk.green(' DONE'));
		cb();
	});
}

function processCityData(src, dest, cb) {
	let lines = 0;
	function processLine(line) {
		if (line.match(/^Copyright/) || !line.match(/\d/)) {
			return;
		}

		const fields = CSVtoArray(line);
		if (!fields) {
			console.warn('weird line: %s::', line);
			return;
		}
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
			// IPv6
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
			// IPv4
			bsz = 24;

			rngip = new Address4(fields[0]);
			sip = parseInt(rngip.startAddress().bigInteger(), 10);
			eip = parseInt(rngip.endAddress().bigInteger(), 10);
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

		fs.writeSync(datFile, b, 0, b.length, null);
		if (Date.now() - tstart > 5000) {
			tstart = Date.now();
			process.stdout.write('\nStill working (' + lines + ')...');
		}
	}

	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);

	process.stdout.write('Processing Data (may take a moment) ...');
	var tstart = Date.now();
	var datFile = fs.openSync(dataFile, 'w');

	lazy(fs.createReadStream(tmpDataFile))
	.lines
	.map(function(byteArray) {
		return iconv.decode(byteArray, 'latin1');
	})
	.skip(1)
	.map(processLine)
	.on('pipe', cb);
}

function processCityDataNames(src, dest, cb) {
	let locId = null;
	let linesCount = 0;
	function processLine(line) {
		if (line.match(/^Copyright/) || !line.match(/\d/)) {
			return;
		}

		const b = Buffer.alloc(88);
		const fields = CSVtoArray(line);
		if (!fields) {
			// Lots of cities contain ` or ' in the name and can't be parsed correctly with current method
			console.warn('weird line: %s::', line);
			return;
		}

		locId = parseInt(fields[0]);

		cityLookup[locId] = linesCount;
		const cc = fields[4];
		const rg = fields[6];
		const city = fields[10];
		const metro = parseInt(fields[11]);
		// Other possible fields to include
		const tz = fields[12];
		const eu = fields[13];

		b.fill(0);
		b.write(cc, 0); // Country code
		b.write(rg, 2); // Region

		if (metro) b.writeInt32BE(metro, 5);
		b.write(eu, 9); // Is in eu
		b.write(tz, 10); // Timezone
		b.write(city, 42); // City name

		fs.writeSync(datFile, b, 0, b.length, null);
		linesCount++;
	}

	const dataFile = path.join(dataPath, dest);
	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);

	var datFile = fs.openSync(dataFile, 'w');

	lazy(fs.createReadStream(tmpDataFile))
	.lines
	.map(function(byteArray) {
		return iconv.decode(byteArray, 'utf-8');
	})
	.skip(1)
	.map(processLine)
	.on('pipe', cb);
}

function processData(database, cb) {
	if (database.skip) {
		return cb(null, database);
	}

	const type = database.type;
	const src = database.src;
	const dest = database.dest;

	if (type === 'country') {
		if (Array.isArray(src)) {
			processLookupCountry(src[0], function() {
				processCountryData(src[1], dest[1], function() {
					processCountryData(src[2], dest[2], function() {
						cb(null, database);
					});
				});
			});
		}
		else {
			processCountryData(src, dest, function() {
				cb(null, database);
			});
		}
	} else if (type === 'city') {
		processCityDataNames(src[0], dest[0], function() {
			processCityData(src[1], dest[1], function() {
				console.log('city data processed');
				processCityData(src[2], dest[2], function() {
					console.log(chalk.green(' DONE'));
					cb(null, database);
				});
			});
		});
	}
}

function updateChecksum(database, cb) {
	if (database.skip || !database.checkValue) {
		// Don't need to update checksums because it was not fetched or did not change
		return cb();
	}
	fs.writeFile(path.join(dataPath, database.type + '.checksum'), database.checkValue, 'utf8', function(err) {
		if (err) console.log(chalk.red('Failed to Update checksums.'), 'Database:', database.type);
		cb();
	});
}

if (!license_key) {
	console.error(chalk.red('ERROR') + ': Missing license_key');
	process.exit(1);
}

rimraf(tmpPath);
mkdir(tmpPath);

async.eachSeries(databases, function(database, nextDatabase) {
	async.seq(check, fetch, extract, processData, updateChecksum)(database, nextDatabase);
}, function(err) {
	if (err) {
		console.error(chalk.red('Failed to Update Databases from MaxMind.'), err);
		process.exit(1);
	} else {
		console.log(chalk.green('Successfully Updated Databases from MaxMind.'));
		if (args.indexOf('debug') !== -1) {
			console.log(chalk.yellow.bold('Notice: temporary files are not deleted for debug purposes.'));
		} else {
			rimraf(tmpPath);
		}
		process.exit(0);
	}
});
