const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const geoIp = require('../index.js');

describe('GeoIP2', () => {
	describe('#testLookup', () => {
		it('should return data about IPv4', () => {
			const ip = '1.1.1.1';
			const actual = geoIp.lookup(ip);
			assert.ok(actual);
		});

		it('should return data about IPv6', () => {
			const actual = geoIp.lookup('2606:4700:4700::64');
			assert.ok(actual);
		});
	});

	describe('#testDataIP4', () => {
		it('should match data for IPv4 - PL', () => {
			const actual = geoIp.lookup('83.13.246.1');
			assert.equal(actual.country, 'PL');
			assert.equal(actual.region, '14');
			assert.equal(actual.isEu, true);
			assert.equal(actual.timezone, 'Europe/Warsaw');
			assert.equal(actual.city, 'Ząbki');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 0);
			assert.equal(actual.area, 10);
		});

		it('should match data for IPv4 - US', () => {
			const actual = geoIp.lookup('72.229.28.185');
			assert.equal(actual.country, 'US');
			assert.equal(actual.region, 'NY');
			assert.equal(actual.isEu, false);
			assert.equal(actual.timezone, 'America/New_York');
			assert.equal(actual.city, 'New York');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 501);
			assert.equal(actual.area, 5);
		});

		it('should match data for IPv4 - JP', () => {
			const actual = geoIp.lookup('210.138.184.59');
			assert.equal(actual.country, 'JP');
			assert.equal(actual.region, '');
			assert.equal(actual.isEu, false);
			assert.equal(actual.timezone, 'Asia/Tokyo');
			assert.equal(actual.city, '');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 0);
			assert.equal(actual.area, 500);
		});

		it('should match data for IPv4 - RU', () => {
			const actual = geoIp.lookup('109.108.63.255');
			assert.equal(actual.country, 'RU');
			assert.equal(actual.region, 'IVA');
			assert.equal(actual.isEu, false);
			assert.equal(actual.timezone, 'Europe/Moscow');
			assert.equal(actual.city, 'Kineshma');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 0);
			assert.equal(actual.area, 20);
		});
	});

	describe('#testDataIP6', () => {
		it('should match data for IPv6 - PL', () => {
			const actual = geoIp.lookup('2a01:118f:30a:3900:c954:e6ef:8067:d4e8');
			assert.equal(actual.country, 'PL');
			assert.equal(actual.region, '06');
			assert.equal(actual.isEu, true);
			assert.equal(actual.timezone, 'Europe/Warsaw');
			assert.equal(actual.city, 'Łaziska');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 0);
			assert.equal(actual.area, 50);
		});

		it('should match data for IPv6 - NL ', () => {
			const actual = geoIp.lookup('2001:1c04:400::1');
			assert.equal(actual.country, 'NL');
			assert.equal(actual.region, 'NH');
			assert.equal(actual.isEu, true);
			assert.equal(actual.timezone, 'Europe/Amsterdam');
			assert.equal(actual.city, 'Zandvoort');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 0);
			assert.equal(actual.area, 5);
		});

		it('should match data for IPv6 - JP', () => {
			const actual = geoIp.lookup('2400:8500:1302:814:a163:44:173:238f');
			assert.equal(actual.country, 'JP');
			assert.equal(actual.region, '');
			assert.equal(actual.isEu, false);
			assert.equal(actual.timezone, 'Asia/Tokyo');
			assert.equal(actual.city, '');
			assert.ok(actual.ll);
			assert.equal(actual.metro, 0);
			assert.equal(actual.area, 500);
		});
	});

	describe('#testUTF8', () => {
		it('should return UTF8 city name', () => {
			const actual = geoIp.lookup('2.139.175.1');
			assert.equal(actual.country, 'ES');
			assert.equal(actual.city, 'Madrid');
			assert.equal(actual.timezone, 'Europe/Madrid');
		});

		it('should match data for IPv4 - PL', () => {
			const actual = geoIp.lookup('86.63.89.41');
			assert.equal(actual.country, 'PL');
			assert.equal(actual.timezone, 'Europe/Warsaw');
			assert.equal(actual.city, 'Piła');
		});
	});

	describe('#testMetro', () => {
		it('should match metro data', () => {
			const actual = geoIp.lookup('23.240.63.68');
			assert.equal(actual.metro, 803);
		});
	});

	describe('#testIPv4MappedIPv6', () => {
		it('should match IPv4 mapped IPv6 data', () => {
			const actual = geoIp.lookup('195.16.170.74');
			assert.equal(actual.metro, 0);
		});
	});

	describe('#testSyncReload', () => {
		it('should reload data synchronously', () => {
			const before4 = geoIp.lookup('75.82.117.180');
			assert.notEqual(before4, null);
			const before6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.notEqual(before6, null);

			geoIp.clear();

			const none4 = geoIp.lookup('75.82.117.180');
			assert.equal(none4, null);
			const none6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.equal(none6, null);

			geoIp.reloadDataSync();

			const after4 = geoIp.lookup('75.82.117.180');
			assert.deepEqual(before4, after4);
			const after6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.deepEqual(before6, after6);
		});

		it('should return null for 0.0.0.0 after clear()', () => {
			geoIp.clear();
			assert.equal(geoIp.lookup('0.0.0.0'), null);
			geoIp.reloadDataSync();
		});

		it('should return null for native IPv6 after clear()', () => {
			geoIp.clear();
			assert.equal(geoIp.lookup('2001:4860:4860::8888'), null);
			assert.equal(geoIp.lookup('::1'), null);
			geoIp.reloadDataSync();
		});
	});

	describe('#testAsyncReload', () => {
		it('should reload data asynchronously', async () => {
			const before4 = geoIp.lookup('75.82.117.180');
			assert.notEqual(before4, null);
			const before6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.notEqual(before6, null);

			geoIp.clear();

			const none4 = geoIp.lookup('75.82.117.180');
			assert.equal(none4, null);
			const none6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.equal(none6, null);

			await new Promise((resolve, reject) => {
				const result = geoIp.reloadData(() => {
					try {
						const after4 = geoIp.lookup('75.82.117.180');
						assert.deepEqual(before4, after4);
						const after6 = geoIp.lookup('::ffff:173.185.182.82');
						assert.deepEqual(before6, after6);
						resolve();
					} catch (err) {
						reject(err);
					}
				});

				assert.equal(result, undefined);
			});
		});

		it('should reload data and resolve a promise when callback is omitted', async () => {
			const before4 = geoIp.lookup('75.82.117.180');
			assert.notEqual(before4, null);
			const before6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.notEqual(before6, null);

			geoIp.clear();

			assert.equal(geoIp.lookup('75.82.117.180'), null);
			assert.equal(geoIp.lookup('::ffff:173.185.182.82'), null);

			const result = geoIp.reloadData();
			assert.notEqual(result, undefined);
			assert.equal(typeof result.then, 'function');

			await result;

			const after4 = geoIp.lookup('75.82.117.180');
			assert.deepEqual(before4, after4);
			const after6 = geoIp.lookup('::ffff:173.185.182.82');
			assert.deepEqual(before6, after6);
		});
	});

	describe('#testWatcherLifecycle', () => {
		it('should not throw when stopping watcher before it starts', () => {
			assert.doesNotThrow(() => geoIp.stopWatchingDataUpdate());
		});
	});

	describe('#testInvalidIP', () => {
		it('should return null for an invalid IP address', () => {
			const ip = 'invalid_ip_address';
			const actual = geoIp.lookup(ip);
			assert.equal(actual, null);
		});
	});

	describe('#testEmptyIP', () => {
		it('should return null for an empty IP address', () => {
			const actual = geoIp.lookup('');
			assert.equal(actual, null);
		});
	});

	describe('#testNullIP', () => {
		it('should throw for a null IP address', () => {
			assert.throws(() => geoIp.lookup(null), TypeError);
		});
	});

	describe('#testUnknownIP', () => {
		it('should return null for an unknown IP address', () => {
			const ip = '192.168.0.1'; // Private IP address
			const actual = geoIp.lookup(ip);
			assert.equal(actual, null);
		});
	});

	describe('#testNoDataForIP', () => {
		it('should return null for an IP address with no data', () => {
			const ip = '203.0.113.0'; // Example IP with no data
			const actual = geoIp.lookup(ip);
			assert.equal(actual, null);
		});
	});

	describe('#testSpecialCharactersIP', () => {
		it('should return null for an IP address with special characters', () => {
			const ip = '20.24.@.&'; // IP with special characters
			const actual = geoIp.lookup(ip);
			assert.equal(actual, null);
		});
	});
});
