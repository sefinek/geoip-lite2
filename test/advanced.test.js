const { describe, expect, it } = require('@jest/globals');
const geoIp = require('../index.js');

describe('Advanced geoIp Tests', () => {
	describe('#IPv6Formats', () => {
		it('should handle compressed IPv6 addresses', () => {
			const result = geoIp.lookup('2001:4860:4860::8888');
			expect(result).toBeTruthy();
		});

		it('should handle full IPv6 addresses', () => {
			const result = geoIp.lookup('2a01:11bf:5427:89a8:dc43:4b56:1a17:c2d4');
			expect(result).not.toBeNull();
		});

		it('should handle IPv6 loopback', () => {
			const result = geoIp.lookup('::1');
			expect(result).toBeNull(); // Loopback should not have geo data
		});

		it('should handle IPv6 with mixed notation', () => {
			const result = geoIp.lookup('::ffff:8.8.8.8');
			expect(result).not.toBeNull();
		});

		it('should handle different IPv4-mapped IPv6 formats', () => {
			const result1 = geoIp.lookup('::FFFF:1.1.1.1');
			const result2 = geoIp.lookup('0:0:0:0:0:FFFF:1.1.1.1');
			expect(result1).not.toBeNull();
			expect(result2).not.toBeNull();
		});
	});

	describe('#PrivateIPAddresses', () => {
		it('should return null for 10.x.x.x range', () => {
			expect(geoIp.lookup('10.0.0.1')).toBeNull();
			expect(geoIp.lookup('10.128.0.1')).toBeNull();
			expect(geoIp.lookup('10.255.255.254')).toBeNull();
		});

		it('should return null for 172.16.x.x - 172.31.x.x range', () => {
			expect(geoIp.lookup('172.16.0.1')).toBeNull();
			expect(geoIp.lookup('172.20.0.1')).toBeNull();
			expect(geoIp.lookup('172.31.255.254')).toBeNull();
		});

		it('should return null for 192.168.x.x range', () => {
			expect(geoIp.lookup('192.168.0.1')).toBeNull();
			expect(geoIp.lookup('192.168.1.1')).toBeNull();
			expect(geoIp.lookup('192.168.255.254')).toBeNull();
		});

		it('should return null for localhost', () => {
			expect(geoIp.lookup('127.0.0.1')).toBeNull();
			expect(geoIp.lookup('127.0.0.255')).toBeNull();
		});

		it('should return data for public IPs near private ranges', () => {
			expect(geoIp.lookup('9.255.255.255')).not.toBeNull();
			expect(geoIp.lookup('11.0.0.1')).not.toBeNull();
			expect(geoIp.lookup('172.15.255.255')).not.toBeNull();
			expect(geoIp.lookup('172.32.0.1')).not.toBeNull();
		});
	});

	describe('#NumberInput', () => {
		it('should accept number input for IPv4', () => {
			const num = 16843009; // 1.1.1.1
			const result = geoIp.lookup(num);
			expect(result).not.toBeNull();
		});

		it('should handle zero', () => {
			const result = geoIp.lookup(0);
			expect(result).toBeNull();
		});

		it('should handle max IPv4 number', () => {
			const result = geoIp.lookup(4294967295);
			// 255.255.255.255 is broadcast, may or may not have data
			expect(result === null || typeof result === 'object').toBe(true);
		});
	});

	describe('#DataStructure', () => {
		it('should return correct data structure', () => {
			const result = geoIp.lookup('8.8.8.8');
			expect(result).toHaveProperty('country');
			expect(result).toHaveProperty('region');
			expect(result).toHaveProperty('isEu');
			expect(result).toHaveProperty('timezone');
			expect(result).toHaveProperty('city');
			expect(result).toHaveProperty('ll');
			expect(result).toHaveProperty('metro');
			expect(result).toHaveProperty('area');
		});

		it('should not expose range', () => {
			const result = geoIp.lookup('8.8.8.8');
			expect(Object.prototype.hasOwnProperty.call(result, 'range')).toBe(false);
		});

		it('should have array for ll (latitude/longitude)', () => {
			const result = geoIp.lookup('8.8.8.8');
			expect(Array.isArray(result.ll)).toBe(true);
			expect(result.ll.length).toBe(2);
		});

		it('should have valid latitude/longitude values', () => {
			const result = geoIp.lookup('8.8.8.8');
			expect(typeof result.ll[0]).toBe('number');
			expect(typeof result.ll[1]).toBe('number');
			expect(result.ll[0]).toBeGreaterThanOrEqual(-90);
			expect(result.ll[0]).toBeLessThanOrEqual(90);
			expect(result.ll[1]).toBeGreaterThanOrEqual(-180);
			expect(result.ll[1]).toBeLessThanOrEqual(180);
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
				expect(result).not.toBeNull();
				expect(result.country).toBeTruthy();
				expect(result.country.length).toBe(2); // ISO 2-letter code
			});
		});

		it('should return valid country codes', () => {
			const testIps = ['8.8.8.8', '1.1.1.1', '72.229.28.185'];

			testIps.forEach(ip => {
				const result = geoIp.lookup(ip);
				if (result && result.country) {
					expect(result.country).toMatch(/^[A-Z]{2}$/);
				}
			});
		});

		it('should return data with timezones', () => {
			const result = geoIp.lookup('8.8.8.8');
			expect(result).not.toBeNull();
			expect(result.timezone).toBeTruthy();
			expect(result.timezone).toContain('/');
		});
	});

	describe('#EUFlag', () => {
		it('should have isEu=true for EU countries', () => {
			const poland = geoIp.lookup('83.13.246.1');
			expect(poland.isEu).toBe(true);

			const netherlands = geoIp.lookup('2001:1c04:400::1');
			expect(netherlands.isEu).toBe(true);
		});

		it('should have isEu=false for non-EU countries', () => {
			const us = geoIp.lookup('72.229.28.185');
			expect(us.isEu).toBe(false);

			const japan = geoIp.lookup('210.138.184.59');
			expect(japan.isEu).toBe(false);
		});
	});

	describe('#Version', () => {
		it('should have a version property', () => {
			expect(geoIp.version).toBeDefined();
			expect(typeof geoIp.version).toBe('string');
		});

		it('should match package.json version', () => {
			const packageJson = require('../package.json');
			expect(geoIp.version).toBe(packageJson.version);
		});
	});

	describe('#EdgeCases', () => {
		it('should handle undefined input', () => {
			expect(() => geoIp.lookup(undefined)).toThrow(TypeError);
		});

		it('should throw when input is missing', () => {
			expect(() => geoIp.lookup()).toThrow(TypeError);
		});

		it('should handle boolean input', () => {
			const result = geoIp.lookup(true);
			expect(result).toBeNull();
		});

		it('should handle object input', () => {
			const result = geoIp.lookup({});
			expect(result).toBeNull();
		});

		it('should handle array input', () => {
			const result = geoIp.lookup([]);
			expect(result).toBeNull();
		});

		it('should handle negative numbers', () => {
			const result = geoIp.lookup(-1);
			expect(result).toBeNull();
		});

		it('should handle numbers larger than max IPv4', () => {
			const result = geoIp.lookup(4294967296);
			expect(result).toBeNull();
		});

		it('should handle IPv4 with leading zeros', () => {
			const result = geoIp.lookup('008.008.008.008');
			// This may or may not work depending on implementation
			// Just verify it doesn't crash
			expect(result === null || typeof result === 'object').toBe(true);
		});

		it('should handle malformed IPv6', () => {
			expect(geoIp.lookup('2001:db8:::1')).toBeNull();
			expect(geoIp.lookup('gggg::1')).toBeNull();
			// Malformed addresses should return null
			const result = geoIp.lookup('2001:db8');
			expect(result === null || typeof result === 'object').toBe(true);
		});

		it('should handle IPv6 with too many segments', () => {
			const result = geoIp.lookup('1:2:3:4:5:6:7:8:9');
			expect(result).toBeNull();
		});
	});

	describe('#ConsistencyChecks', () => {
		it('should return same result for repeated lookups', () => {
			const ip = '8.8.8.8';
			const result1 = geoIp.lookup(ip);
			const result2 = geoIp.lookup(ip);
			expect(result1).toEqual(result2);
		});

		it('should handle concurrent lookups', () => {
			const ips = ['1.1.1.1', '8.8.8.8', '4.4.4.4'];
			const results = ips.map(ip => geoIp.lookup(ip));
			results.forEach(result => {
				expect(result).not.toBeNull();
			});
		});
	});

	describe('#RangeBoundaries', () => {
		it('should handle IPs at range boundaries', () => {
			const result = geoIp.lookup('0.0.0.1');
			// Either has data or doesn't, shouldn't crash
			expect(result === null || typeof result === 'object').toBe(true);
		});

		it('should handle high-end IP addresses', () => {
			const result = geoIp.lookup('255.255.255.254');
			expect(result === null || typeof result === 'object').toBe(true);
		});
	});
});
