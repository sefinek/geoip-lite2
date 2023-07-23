// Fetches and converts maxmind lite databases

'use strict';

const fs = require('fs');
const path = require('path');

fs.existsSync = fs.existsSync || path.existsSync;

const chalk = require('chalk');
const iconv = require('iconv-lite');
const lazy = require('lazy');
const rimraf = require('rimraf').sync;
const utils = require('../lib/utils');
const { Address6, Address4 } = require('ip-address');

function processCountryData(src, dest, cb) {
	let lines = 0;

	let tstart = Date.now();
	const dataFile = path.join(dataPath, dest);
	const datFile = fs.openSync(dataFile, 'w');

	function processLine(line) {
		const fields = CSVtoArray(line);

		if (!fields || fields.length < 6) {
			console.log('processCountryData(): Weird line: %s::', line);
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
				process.stdout.write('\nStill working (' + lines + ') ...');
			}
		}
	}

	const tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);
	mkdir(dataFile);

	process.stdout.write('Processing Data (may take a moment) ...');


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