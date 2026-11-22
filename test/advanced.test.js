const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const geoIp = require('../index.js');

describe('Advanced geoIp Tests', () => {
	describe('#IPv6Formats', () => {
		it('should handle compressed IPv6 addresses', () => {
			const result = geoIp.lookup('2001:4860:4860::8888');
			assert.ok(result);
		});

		it('should handle full IPv6 addresses', () => {
			const result = geoIp.lookup('2a01:11bf:5427:89a8:dc43:4b56:1a17:c2d4');
			assert.notEqual(result, null);
		});

		it('should handle IPv6 loopback', () => {
			const result = geoIp.lookup('::1');
			assert.equal(result, null); // Loopback should not have geo data
		});

		it('should handle IPv6 with mixed notation', () => {
			const result = geoIp.lookup('::ffff:8.8.8.8');
			assert.notEqual(result, null);
		});

		it('should handle different IPv4-mapped IPv6 formats', () => {
			const result1 = geoIp.lookup('::FFFF:1.1.1.1');
			const result2 = geoIp.lookup('0:0:0:0:0:FFFF:1.1.1.1');
			assert.notEqual(result1, null);
			assert.notEqual(result2, null);
		});

		it('should resolve hexadecimal IPv4-mapped IPv6 like the dotted form', () => {
			assert.deepEqual(geoIp.lookup('::ffff:808:808'), geoIp.lookup('::ffff:8.8.8.8'));
			assert.deepEqual(geoIp.lookup('0:0:0:0:0:ffff:101:101'), geoIp.lookup('1.1.1.1'));
		});
	});

	describe('#PrivateIPAddresses', () => {
		it('should return null for 10.x.x.x range', () => {
			assert.equal(geoIp.lookup('10.0.0.1'), null);
			assert.equal(geoIp.lookup('10.128.0.1'), null);
			assert.equal(geoIp.lookup('10.255.255.254'), null);
		});

		it('should return null for 172.16.x.x - 172.31.x.x range', () => {
			assert.equal(geoIp.lookup('172.16.0.1'), null);
			assert.equal(geoIp.lookup('172.20.0.1'), null);
			assert.equal(geoIp.lookup('172.31.255.254'), null);
		});

		it('should return null for 192.168.x.x range', () => {
			assert.equal(geoIp.lookup('192.168.0.1'), null);
			assert.equal(geoIp.lookup('192.168.1.1'), null);
			assert.equal(geoIp.lookup('192.168.255.254'), null);
		});

		it('should return null for localhost', () => {
			assert.equal(geoIp.lookup('127.0.0.1'), null);
			assert.equal(geoIp.lookup('127.0.0.255'), null);
		});

		it('should return data for public IPs near private ranges', () => {
			assert.notEqual(geoIp.lookup('9.255.255.255'), null);
			assert.notEqual(geoIp.lookup('11.0.0.1'), null);
			assert.notEqual(geoIp.lookup('172.15.255.255'), null);
			assert.notEqual(geoIp.lookup('172.32.0.1'), null);
		});
	});

	describe('#NumberInput', () => {
		it('should accept number input for IPv4', () => {
			const num = 16843009; // 1.1.1.1
			const result = geoIp.lookup(num);
			assert.notEqual(result, null);
		});

		it('should handle zero', () => {
			const result = geoIp.lookup(0);
			assert.equal(result, null);
		});

		it('should handle max IPv4 number', () => {
			const result = geoIp.lookup(4294967295);
			// 255.255.255.255 is broadcast, may or may not have data
			assert.equal(result === null || typeof result === 'object', true);
		});
	});

	describe('#DataStructure', () => {
		it('should return correct data structure', () => {
			const result = geoIp.lookup('8.8.8.8');
			assert.ok('country' in result);
			assert.ok('region' in result);
			assert.ok('isEu' in result);
			assert.ok('timezone' in result);
			assert.ok('city' in result);
			assert.ok('ll' in result);
			assert.ok('metro' in result);
			assert.ok('area' in result);
		});

		it('should not expose range', () => {
			const result = geoIp.lookup('8.8.8.8');
			assert.equal(Object.prototype.hasOwnProperty.call(result, 'range'), false);
		});

		it('should have array for ll (latitude/longitude)', () => {
			const result = geoIp.lookup('8.8.8.8');
			assert.equal(Array.isArray(result.ll), true);
			assert.equal(result.ll.length, 2);
		});

		it('should have valid latitude/longitude values', () => {
			const result = geoIp.lookup('8.8.8.8');
			assert.equal(typeof result.ll[0], 'number');
			assert.equal(typeof result.ll[1], 'number');
			assert.ok(result.ll[0] >= -90);
			assert.ok(result.ll[0] <= 90);
			assert.ok(result.ll[1] >= -180);
			assert.ok(result.ll[1] <= 180);
		});
	});

	describe('#MoreCountries', () => {
		it('should return data for various public IPs', () => {
			// Test multiple public IPs have geo data
			const ips = [
				'5.1.83.0', // Europe
				'5.39.0.0', // Europe
				'5.62.0.0', // Europe
				'1.0.1.0', // Asia
				'1.128.0.0', // Asia/Pacific
				'177.0.0.0', // South America
				'14.96.0.0', // Asia
				'24.48.0.0', // North America
			];

			ips.forEach(ip => {
				const result = geoIp.lookup(ip);
				assert.notEqual(result, null);
				assert.ok(result.country);
				assert.equal(result.country.length, 2); // ISO 2-letter code
			});
		});

		it('should return valid country codes', () => {
			const testIps = ['8.8.8.8', '1.1.1.1', '72.229.28.185'];

			testIps.forEach(ip => {
				const result = geoIp.lookup(ip);
				if (result && result.country) {
					assert.match(result.country, /^[A-Z]{2}$/);
				}
			});
		});

		it('should return data with timezones', () => {
			const result = geoIp.lookup('8.8.8.8');
			assert.notEqual(result, null);
			assert.ok(result.timezone);
			assert.ok(result.timezone.includes('/'));
		});
	});

	describe('#EUFlag', () => {
		it('should have isEu=true for EU countries', () => {
			const poland = geoIp.lookup('83.13.246.1');
			assert.equal(poland.isEu, true);

			const netherlands = geoIp.lookup('2001:1c04:400::1');
			assert.equal(netherlands.isEu, true);
		});

		it('should have isEu=false for non-EU countries', () => {
			const us = geoIp.lookup('72.229.28.185');
			assert.equal(us.isEu, false);

			const japan = geoIp.lookup('210.138.184.59');
			assert.equal(japan.isEu, false);
		});
	});

	describe('#Version', () => {
		it('should have a version property', () => {
			assert.notEqual(geoIp.version, undefined);
			assert.equal(typeof geoIp.version, 'string');
		});

		it('should match package.json version', () => {
			const packageJson = require('../package.json');
			assert.equal(geoIp.version, packageJson.version);
		});
	});

	describe('#EdgeCases', () => {
		it('should handle undefined input', () => {
			assert.throws(() => geoIp.lookup(undefined), TypeError);
		});

		it('should throw when input is missing', () => {
			assert.throws(() => geoIp.lookup(), TypeError);
		});

		it('should handle boolean input', () => {
			const result = geoIp.lookup(true);
			assert.equal(result, null);
		});

		it('should handle object input', () => {
			const result = geoIp.lookup({});
			assert.equal(result, null);
		});

		it('should handle array input', () => {
			const result = geoIp.lookup([]);
			assert.equal(result, null);
		});

		it('should handle negative numbers', () => {
			const result = geoIp.lookup(-1);
			assert.equal(result, null);
		});

		it('should return null for NaN input', () => {
			assert.equal(geoIp.lookup(NaN), null);
		});

		it('should return null for float input', () => {
			assert.equal(geoIp.lookup(1.5), null);
		});

		it('should return null for Infinity input', () => {
			assert.equal(geoIp.lookup(Infinity), null);
			assert.equal(geoIp.lookup(-Infinity), null);
		});

		it('should handle numbers larger than max IPv4', () => {
			const result = geoIp.lookup(4294967296);
			assert.equal(result, null);
		});

		it('should handle IPv4 with leading zeros', () => {
			const result = geoIp.lookup('008.008.008.008');
			// This may or may not work depending on implementation
			// Just verify it doesn't crash
			assert.equal(result === null || typeof result === 'object', true);
		});

		it('should handle malformed IPv6', () => {
			assert.equal(geoIp.lookup('2001:db8:::1'), null);
			assert.equal(geoIp.lookup('gggg::1'), null);
			// Malformed addresses should return null
			const result = geoIp.lookup('2001:db8');
			assert.equal(result === null || typeof result === 'object', true);
		});

		it('should handle IPv6 with too many segments', () => {
			const result = geoIp.lookup('1:2:3:4:5:6:7:8:9');
			assert.equal(result, null);
		});
	});

	describe('#ConsistencyChecks', () => {
		it('should return same result for repeated lookups', () => {
			const ip = '8.8.8.8';
			const result1 = geoIp.lookup(ip);
			const result2 = geoIp.lookup(ip);
			assert.deepEqual(result1, result2);
		});

		it('should handle concurrent lookups', () => {
			const ips = ['1.1.1.1', '8.8.8.8', '4.4.4.4'];
			const results = ips.map(ip => geoIp.lookup(ip));
			results.forEach(result => {
				assert.notEqual(result, null);
			});
		});
	});

	describe('#RangeBoundaries', () => {
		it('should handle IPs at range boundaries', () => {
			const result = geoIp.lookup('0.0.0.1');
			// Either has data or doesn't, shouldn't crash
			assert.equal(result === null || typeof result === 'object', true);
		});

		it('should handle high-end IP addresses', () => {
			const result = geoIp.lookup('255.255.255.254');
			assert.equal(result === null || typeof result === 'object', true);
		});
	});
});
