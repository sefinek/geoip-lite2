const assert = require('assert');
const geoIp2 = require('../lib/geoip');

describe('GeoIP2', function() {
	describe('#testLookup()', function() {
		it('should return data about IPv4', function() {
			const ip = '1.1.1.1';
			const actual = geoIp2.lookup(ip);
			assert.ok(actual);
		});

		it('should return data about IPv6', function() {
			const ipv6 = '2606:4700:4700::64';
			const actual = geoIp2.lookup(ipv6);
			assert.ok(actual);
		});
	});

	describe('#testDataIP4()', function() {
		it('should match data for IPv4', function() {
			const ip = '72.229.28.185';
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual.range !== undefined, true);
			assert.strictEqual(actual.country, 'US');
			assert.strictEqual(actual.region, 'NY');
			assert.strictEqual(actual.eu, '0');
			assert.strictEqual(actual.timezone, 'America/New_York');
			assert.strictEqual(actual.city, 'New York');
			assert.ok(actual.ll);
			assert.strictEqual(actual.metro, 501);
			assert.strictEqual(actual.area, 5);
		});
	});

	describe('#testDataIP6()', function() {
		it('should match data for IPv6', function() {
			const ipv6 = '2001:1c04:400::1';
			const actual = geoIp2.lookup(ipv6);
			assert.strictEqual(actual.range !== undefined, true);
			assert.strictEqual(actual.country, 'NL');
			assert.strictEqual(actual.region, 'NH');
			assert.strictEqual(actual.eu, '1');
			assert.strictEqual(actual.timezone, 'Europe/Amsterdam');
			assert.strictEqual(actual.city, 'Zandvoort');
			assert.ok(actual.ll);
			assert.strictEqual(actual.metro, 0);
			assert.strictEqual(actual.area, 5);
		});
	});

	describe('#testUTF8()', function() {
		it('should return UTF8 city name', function() {
			const ip = '2.139.175.1';
			const expected = 'Madrid';
			const actual = geoIp2.lookup(ip);
			assert.ok(actual);
			assert.strictEqual(actual.city, expected);
		});
	});

	describe('#testMetro()', function() {
		it('should match metro data', function() {
			const actual = geoIp2.lookup('23.240.63.68');
			assert.strictEqual(actual.city, 'Riverside');
			assert.strictEqual(actual.metro, 803);
		});
	});

	describe('#testIPv4MappedIPv6()', function() {
		it('should match IPv4 mapped IPv6 data', function() {
			const actual = geoIp2.lookup('195.16.170.74');
			assert.strictEqual(actual.city, '');
			assert.strictEqual(actual.metro, 0);
		});
	});

	describe('#testSyncReload()', function() {
		it('should reload data synchronously', function() {
			const before4 = geoIp2.lookup('75.82.117.180');
			assert.notStrictEqual(before4, null);
			const before6 = geoIp2.lookup('::ffff:173.185.182.82');
			assert.notStrictEqual(before6, null);

			geoIp2.clear();

			const none4 = geoIp2.lookup('75.82.117.180');
			assert.strictEqual(none4, null);
			const none6 = geoIp2.lookup('::ffff:173.185.182.82');
			assert.strictEqual(none6, null);

			geoIp2.reloadDataSync();

			const after4 = geoIp2.lookup('75.82.117.180');
			assert.deepStrictEqual(before4, after4);
			const after6 = geoIp2.lookup('::ffff:173.185.182.82');
			assert.deepStrictEqual(before6, after6);
		});
	});

	describe('#testAsyncReload()', function() {
		it('should reload data asynchronously', function(done) {
			const before4 = geoIp2.lookup('75.82.117.180');
			assert.notStrictEqual(before4, null);
			const before6 = geoIp2.lookup('::ffff:173.185.182.82');
			assert.notStrictEqual(before6, null);

			geoIp2.clear();

			const none4 = geoIp2.lookup('75.82.117.180');
			assert.strictEqual(none4, null);
			const none6 = geoIp2.lookup('::ffff:173.185.182.82');
			assert.strictEqual(none6, null);

			geoIp2.reloadData(function() {
				const after4 = geoIp2.lookup('75.82.117.180');
				assert.deepStrictEqual(before4, after4);
				const after6 = geoIp2.lookup('::ffff:173.185.182.82');
				assert.deepStrictEqual(before6, after6);

				done();
			});
		});
	});

	describe('#testInvalidIP()', function() {
		it('should return null for an invalid IP address', function() {
			const ip = 'invalid_ip_address';
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual, null);
		});
	});

	describe('#testEmptyIP()', function() {
		it('should return null for an empty IP address', function() {
			const ip = '';
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual, null);
		});
	});

	describe('#testNullIP()', function() {
		it('should return null for a null IP address', function() {
			const ip = null;
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual, null);
		});
	});

	describe('#testUnknownIP()', function() {
		it('should return null for an unknown IP address', function() {
			const ip = '192.168.1.1'; // Private IP address
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual, null);
		});
	});

	describe('#testNoDataForIP()', function() {
		it('should return null for an IP address with no data', function() {
			const ip = '203.0.113.0'; // Example IP with no data
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual, null);
		});
	});

	describe('#testSpecialCharactersIP()', function() {
		it('should return null for an IP address with special characters', function() {
			const ip = '1.2.3.@'; // IP with special characters
			const actual = geoIp2.lookup(ip);
			assert.strictEqual(actual, null);
		});
	});
});
