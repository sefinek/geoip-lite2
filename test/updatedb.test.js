const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updatedb = require('../tools/updatedb.js');

const collect = async iterable => {
	const items = [];
	for await (const item of iterable) items.push(item);
	return items;
};

describe('updatedb', () => {
	let tmpDir;

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoip-updatedb-test-'));
	});

	after(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe('#parseCsvLine', () => {
		it('should split plain lines and trim fields', () => {
			assert.deepEqual(updatedb.parseCsvLine('a, b ,c,,'), ['a', 'b', 'c', '', '']);
		});

		it('should keep apostrophes in unquoted fields', () => {
			assert.deepEqual(updatedb.parseCsvLine('1,en,CN,Xi\'an'), ['1', 'en', 'CN', 'Xi\'an']);
		});

		it('should handle quoted fields with commas and escaped quotes', () => {
			assert.deepEqual(updatedb.parseCsvLine('1,"Korea, South","Say ""hi""",x'), ['1', 'Korea, South', 'Say "hi"', 'x']);
		});

		it('should return null for malformed lines', () => {
			assert.equal(updatedb.parseCsvLine('"unterminated,a'), null);
			assert.equal(updatedb.parseCsvLine('a,"b"c,d'), null);
			assert.equal(updatedb.parseCsvLine('a,b"c,d'), null);
		});
	});

	describe('#batchBuffers', () => {
		it('should preserve the bytes while grouping records into chunks', async () => {
			const records = Array.from({ length: 100 }, (_, i) => Buffer.alloc(24, i));
			const chunks = await collect(updatedb.batchBuffers(records, 1000));

			assert.ok(chunks.length > 1 && chunks.length < records.length);
			assert.ok(chunks.every(chunk => chunk.length <= 1000));
			assert.equal(Buffer.compare(Buffer.concat(chunks), Buffer.concat(records)), 0);
		});

		it('should yield nothing for no records', async () => {
			assert.deepEqual(await collect(updatedb.batchBuffers([])), []);
		});
	});

	describe('#readDataLines', () => {
		it('should skip the header and handle CRLF and a missing trailing newline', async () => {
			const file = path.join(tmpDir, 'lines.csv');
			fs.writeFileSync(file, 'header\r\none\r\ntwo\nthree');

			assert.deepEqual(await collect(updatedb.readDataLines(file)), ['one', 'two', 'three']);
		});
	});

	describe('#staged data files', () => {
		it('should keep the target untouched until commit, then replace it and leave no staging file', async () => {
			const file = path.join(tmpDir, 'out.dat');
			fs.writeFileSync(file, 'old');
			const ctx = { staged: [] };

			await updatedb.stageDataFile(ctx, file, [Buffer.from('ab'), Buffer.from('cd')]);
			assert.equal(fs.readFileSync(file, 'utf8'), 'old');
			assert.equal(fs.readFileSync(`${file}.tmp`, 'utf8'), 'abcd');

			await updatedb.commitStagedFiles(ctx);
			assert.equal(fs.readFileSync(file, 'utf8'), 'abcd');
			assert.equal(fs.existsSync(`${file}.tmp`), false);
			assert.equal(ctx.staged.length, 0);
		});

		it('should remove the staging file and keep the previous file when writing fails', async () => {
			const file = path.join(tmpDir, 'keep.dat');
			fs.writeFileSync(file, 'old');
			const ctx = { staged: [] };

			async function* failing() {
				yield Buffer.from('new');
				throw new Error('boom');
			}

			await assert.rejects(updatedb.stageDataFile(ctx, file, failing()), /boom/);
			assert.equal(fs.readFileSync(file, 'utf8'), 'old');
			assert.equal(fs.existsSync(`${file}.tmp`), false);
			assert.equal(ctx.staged.length, 0);
		});

		it('should discard staged files without touching the targets', async () => {
			const file = path.join(tmpDir, 'discard.dat');
			fs.writeFileSync(file, 'old');
			const ctx = { staged: [] };

			await updatedb.stageDataFile(ctx, file, [Buffer.from('new')]);
			await updatedb.discardStagedFiles(ctx);

			assert.equal(fs.readFileSync(file, 'utf8'), 'old');
			assert.equal(fs.existsSync(`${file}.tmp`), false);
		});
	});

	describe('#createConfig', () => {
		it('should require a license key', () => {
			assert.throws(() => updatedb.createConfig([], {}), updatedb.UpdateError);
		});

		it('should read the license key from args or env and encode it in URLs', () => {
			const fromArgs = updatedb.createConfig(['license_key=abc_123'], {});
			const fromEnv = updatedb.createConfig([], { MAXMIND_KEY: 'k e&y' });

			assert.ok(fromArgs.databases[0].url.endsWith('license_key=abc_123'));
			assert.ok(fromEnv.databases[1].checksumUrl.endsWith('license_key=k+e%26y'));
		});

		it('should reject a missing data directory', () => {
			assert.throws(() => updatedb.createConfig(['license_key=x', `geoDataDir=${path.join(tmpDir, 'missing')}`], {}), /Directory does not exist/);
		});
	});

	describe('#record builders', () => {
		it('should build country records', () => {
			const v4 = updatedb.buildCountryRecord('1.0.0.0/24', 'AU');
			assert.equal(v4.length, 10);
			assert.equal(v4.readUInt32BE(0), 0x01000000);
			assert.equal(v4.readUInt32BE(4), 0x010000FF);
			assert.equal(v4.toString('utf8', 8, 10), 'AU');

			const v6 = updatedb.buildCountryRecord('2001:db8::/32', 'PL');
			assert.equal(v6.length, 34);
			assert.equal(v6.readUInt32BE(0), 0x20010db8);
			assert.equal(v6.toString('utf8', 32, 34), 'PL');
		});

		it('should build city records', () => {
			const v4 = updatedb.buildCityRecord('1.0.0.0/24', 7, -334940, 1432104, 1000);
			assert.equal(v4.length, 24);
			assert.deepEqual([v4.readUInt32BE(8), v4.readInt32BE(12), v4.readInt32BE(16), v4.readUInt32BE(20)], [7, -334940, 1432104, 1000]);

			const v6 = updatedb.buildCityRecord('2001:db8::/32', 7, 1, 2, 3);
			assert.equal(v6.length, 48);
			assert.deepEqual([v6.readUInt32BE(32), v6.readInt32BE(36), v6.readInt32BE(40), v6.readUInt32BE(44)], [7, 1, 2, 3]);
		});
	});

	describe('#processData', () => {
		it('should leave all existing data files untouched when a later step fails', async () => {
			const srcDir = path.join(tmpDir, 'src-fail');
			const dataDir = path.join(tmpDir, 'data-fail');
			fs.mkdirSync(srcDir);
			fs.mkdirSync(dataDir);

			fs.writeFileSync(path.join(srcDir, 'names.csv'), 'header\n2077456,en,OC,Oceania,AU,Australia,NSW,"New South Wales",,,Sydney,,Australia/Sydney,0');
			fs.writeFileSync(path.join(srcDir, 'blocks4.csv'), 'header\n1.0.0.0/24,2077456,2077456,,0,0,,-33.4940,143.2104,1000');
			fs.writeFileSync(path.join(srcDir, 'blocks6.csv'), 'header\nnot-a-cidr,2077456,2077456,,0,0,,1,2,3');
			for (const name of ['names.dat', 'city.dat', 'city6.dat']) fs.writeFileSync(path.join(dataDir, name), 'old');

			const database = { type: 'city', src: ['names.csv', 'blocks4.csv', 'blocks6.csv'], dest: ['names.dat', 'city.dat', 'city6.dat'] };
			const ctx = { dataPath: dataDir, tmpPath: srcDir, countryLookup: new Map(), cityLookup: new Map() };

			const logMock = mock.method(console, 'log', () => undefined);
			try {
				await assert.rejects(updatedb.processData(ctx, database), TypeError);
			} finally {
				logMock.mock.restore();
			}

			assert.deepEqual(fs.readdirSync(dataDir).sort(), ['city.dat', 'city6.dat', 'names.dat']);
			for (const name of ['names.dat', 'city.dat', 'city6.dat']) assert.equal(fs.readFileSync(path.join(dataDir, name), 'utf8'), 'old');
		});

		it('should produce data files that the lookup code can read', async () => {
			const srcDir = path.join(tmpDir, 'src');
			const dataDir = path.join(tmpDir, 'data');
			fs.mkdirSync(srcDir);
			fs.mkdirSync(dataDir);

			fs.writeFileSync(path.join(srcDir, 'GeoLite2-City-Locations-en.csv'), [
				'header',
				'2077456,en,OC,Oceania,AU,Australia,NSW,"New South Wales",,,"Sydney, Test",,Australia/Sydney,0',
				'2988507,en,EU,Europe,FR,France,IDF,Ile-de-France,75,Paris,Paris,,Europe/Paris,1',
			].join('\n'));
			fs.writeFileSync(path.join(srcDir, 'GeoLite2-City-Blocks-IPv4.csv'), [
				'header',
				'1.0.0.0/24,2077456,2077456,,0,0,,-33.4940,143.2104,1000',
				'5.0.0.0/24,2988507,2988507,,0,0,75001,48.8534,2.3488,20',
			].join('\n'));
			fs.writeFileSync(path.join(srcDir, 'GeoLite2-City-Blocks-IPv6.csv'), [
				'header',
				'2a00:1450::/32,2988507,2988507,,0,0,75001,48.8534,2.3488,20',
			].join('\n'));

			const database = {
				type: 'city',
				src: ['GeoLite2-City-Locations-en.csv', 'GeoLite2-City-Blocks-IPv4.csv', 'GeoLite2-City-Blocks-IPv6.csv'],
				dest: ['geoip-city-names.dat', 'geoip-city.dat', 'geoip-city6.dat'],
			};
			const ctx = { dataPath: dataDir, tmpPath: srcDir, countryLookup: new Map(), cityLookup: new Map() };

			const logMock = mock.method(console, 'log', () => undefined);
			try {
				await updatedb.processData(ctx, database);
			} finally {
				logMock.mock.restore();
			}

			assert.equal(fs.statSync(path.join(dataDir, 'geoip-city-names.dat')).size, 2 * 88);
			assert.equal(fs.statSync(path.join(dataDir, 'geoip-city.dat')).size, 2 * 24);
			assert.equal(fs.statSync(path.join(dataDir, 'geoip-city6.dat')).size, 48);

			for (const name of ['geoip-country.dat', 'geoip-country6.dat']) fs.writeFileSync(path.join(dataDir, name), Buffer.alloc(0));

			const indexPath = path.resolve(__dirname, '..', 'index.js');
			const script = `const g = require(${JSON.stringify(indexPath)}); console.log(JSON.stringify([g.lookup('1.0.0.7'), g.lookup('5.0.0.9'), g.lookup('2a00:1450:1::1'), g.lookup('9.9.9.9')]));`;
			const output = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, GEOIP_DATA_DIR: dataDir }, encoding: 'utf8' });
			const [sydney, paris, paris6, none] = JSON.parse(output);

			assert.equal(sydney.country, 'AU');
			assert.equal(sydney.region, 'NSW');
			assert.equal(sydney.city, 'Sydney, Test');
			assert.equal(sydney.timezone, 'Australia/Sydney');
			assert.deepEqual(sydney.ll, [-33.494, 143.2104]);
			assert.equal(sydney.area, 1000);
			assert.equal(sydney.isEu, false);

			assert.equal(paris.country, 'FR');
			assert.equal(paris.city, 'Paris');
			assert.equal(paris.metro, 0);
			assert.equal(paris.isEu, true);
			assert.deepEqual(paris6, paris);
			assert.equal(none, null);
		});
	});
});
