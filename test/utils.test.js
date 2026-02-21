const { describe, expect, it } = require('@jest/globals');
const utils = require('../scripts/utils.js');

describe('Utility Functions', () => {
	describe('#aton4', () => {
		it('should convert IPv4 string to number', () => {
			expect(utils.aton4('0.0.0.0')).toBe(0);
			expect(utils.aton4('127.0.0.1')).toBe(2130706433);
			expect(utils.aton4('192.168.1.1')).toBe(3232235777);
			expect(utils.aton4('255.255.255.255')).toBe(4294967295);
		});

		it('should handle edge cases', () => {
			expect(utils.aton4('1.1.1.1')).toBe(16843009);
			expect(utils.aton4('8.8.8.8')).toBe(134744072);
			expect(utils.aton4('10.0.0.0')).toBe(167772160);
		});
	});

	describe('#ntoa4', () => {
		it('should convert number to IPv4 string', () => {
			expect(utils.ntoa4(0)).toBe('0.0.0.0');
			expect(utils.ntoa4(2130706433)).toBe('127.0.0.1');
			expect(utils.ntoa4(3232235777)).toBe('192.168.1.1');
			expect(utils.ntoa4(4294967295)).toBe('255.255.255.255');
		});

		it('should handle edge cases', () => {
			expect(utils.ntoa4(16843009)).toBe('1.1.1.1');
			expect(utils.ntoa4(134744072)).toBe('8.8.8.8');
			expect(utils.ntoa4(167772160)).toBe('10.0.0.0');
		});

		it('should round-trip with aton4', () => {
			const ips = ['1.2.3.4', '192.168.0.1', '10.20.30.40', '172.16.0.1'];
			ips.forEach(ip => {
				expect(utils.ntoa4(utils.aton4(ip))).toBe(ip);
			});
		});
	});

	describe('#aton6', () => {
		it('should convert IPv6 string to array', () => {
			const result = utils.aton6('::1');
			expect(result).toBeInstanceOf(Array);
			expect(result.length).toBe(4);
			// ::1 should convert to an array of 4 numbers
			expect(result[3]).toBe(1);
		});

		it('should handle full IPv6 addresses', () => {
			const result = utils.aton6('2001:0db8:0000:0000:0000:0000:0000:0001');
			expect(result).toBeInstanceOf(Array);
			expect(result.length).toBe(4);
		});

		it('should handle compressed IPv6 addresses', () => {
			const result = utils.aton6('2001:db8::1');
			expect(result).toBeInstanceOf(Array);
			expect(result.length).toBe(4);
		});

		it('should handle IPv6 with trailing colon', () => {
			const result = utils.aton6('fe80::');
			expect(result).toBeInstanceOf(Array);
			expect(result.length).toBe(4);
		});

		it('should return identical output for equivalent compressed and full IPv6 forms', () => {
			const compressed = utils.aton6('2607:f0d0:1002:51::4');
			const expanded = utils.aton6('2607:f0d0:1002:0051:0000:0000:0000:0004');
			expect(compressed).toEqual(expanded);
		});

		it('should correctly expand omitted middle zero groups', () => {
			const actual = utils.aton6('2001:db8:1::2');
			const expected = utils.aton6('2001:0db8:0001:0000:0000:0000:0000:0002');
			expect(actual).toEqual(expected);
		});
	});

	describe('#ntoa6', () => {
		it('should convert array to IPv6 string', () => {
			const result = utils.ntoa6([0, 0, 0, 1]);
			expect(result).toContain('::');
			expect(result.startsWith('[')).toBe(true);
			expect(result.endsWith(']')).toBe(true);
		});

		it('should handle non-zero values', () => {
			const result = utils.ntoa6([0x20010db8, 0, 0, 1]);
			expect(result).toContain('2001:db8');
		});
	});

	describe('#cmp', () => {
		it('should compare numbers correctly', () => {
			expect(utils.cmp(1, 2)).toBe(-1);
			expect(utils.cmp(2, 1)).toBe(1);
			expect(utils.cmp(5, 5)).toBe(0);
		});

		it('should handle large numbers', () => {
			expect(utils.cmp(4294967295, 4294967294)).toBe(1);
			expect(utils.cmp(0, 4294967295)).toBe(-1);
		});

		it('should delegate to cmp6 for arrays', () => {
			const result = utils.cmp([0, 0, 0, 1], [0, 0, 0, 2]);
			expect(result).toBe(-1);
		});

		it('should return null for invalid types', () => {
			expect(utils.cmp('string', 5)).toBeNull();
			expect(utils.cmp({}, [])).toBeNull();
		});
	});

	describe('#cmp6', () => {
		it('should compare IPv6 arrays correctly', () => {
			expect(utils.cmp6([0, 0, 0, 0], [0, 0, 0, 1])).toBe(-1);
			expect(utils.cmp6([0, 0, 0, 1], [0, 0, 0, 0])).toBe(1);
			expect(utils.cmp6([5, 10, 15, 20], [5, 10, 15, 20])).toBe(0);
		});

		it('should compare first element priority', () => {
			expect(utils.cmp6([1, 100, 999, 999], [2, 0, 0, 0])).toBe(-1);
			expect(utils.cmp6([2, 0, 0, 0], [1, 100, 999, 999])).toBe(1);
		});

		it('should handle equal first elements', () => {
			expect(utils.cmp6([1, 2, 0, 0], [1, 3, 0, 0])).toBe(-1);
			expect(utils.cmp6([1, 3, 0, 0], [1, 2, 0, 0])).toBe(1);
		});

		it('should compare lower 64 bits when upper 64 bits are equal', () => {
			expect(utils.cmp6([638054608, 268566609, 0, 4], [638054608, 268566609, 0, 5])).toBe(-1);
			expect(utils.cmp6([638054608, 268566609, 4, 4], [638054608, 268566609, 0, 4])).toBe(1);
		});
	});

	describe('#SharedGeoHelpers', () => {
		it('should remove null terminator suffix', () => {
			expect(utils.removeNullTerminator('abc\0def')).toBe('abc');
			expect(utils.removeNullTerminator('abc')).toBe('abc');
		});

		it('should read all 128 bits for IPv6 address', () => {
			const buffer = Buffer.alloc(48);
			buffer.writeUInt32BE(1, 0);
			buffer.writeUInt32BE(2, 4);
			buffer.writeUInt32BE(3, 8);
			buffer.writeUInt32BE(4, 12);

			const ip = utils.readIp6(buffer, 0, 48, 0);
			expect(ip).toEqual([1, 2, 3, 4]);
		});

		it('should create independent geo data objects', () => {
			const first = utils.createGeoData();
			const second = utils.createGeoData();

			first.country = 'PL';
			expect(second.country).toBe('');
			expect(first).not.toBe(second);
		});

		it('should populate geo data from location buffers', () => {
			const geoData = utils.createGeoData();
			const locationBuffer = Buffer.alloc(88);
			const coordBuffer = Buffer.alloc(24);

			locationBuffer.write('US', 0);
			locationBuffer.write('NY', 2);
			locationBuffer.writeInt32BE(501, 5);
			locationBuffer.write('0', 9);
			locationBuffer.write('America/New_York', 10);
			locationBuffer.write('New York', 42);

			coordBuffer.writeInt32BE(407128, 12);
			coordBuffer.writeInt32BE(-740060, 16);
			coordBuffer.writeUInt32BE(20, 20);

			utils.populateGeoDataFromLocation({
				geoData,
				locationBuffer,
				locationRecordSize: 88,
				locationId: 0,
				coordBuffer,
				latitudeOffset: 12,
				longitudeOffset: 16,
				areaOffset: 20,
			});

			expect(geoData.country).toBe('US');
			expect(geoData.region).toBe('NY');
			expect(geoData.metro).toBe(501);
			expect(geoData.eu).toBe('0');
			expect(geoData.timezone).toBe('America/New_York');
			expect(geoData.city).toBe('New York');
			expect(geoData.ll).toEqual([40.7128, -74.006]);
			expect(geoData.area).toBe(20);
		});

		it('should skip fill when locationId has no location marker', () => {
			const geoData = utils.createGeoData();
			utils.populateGeoDataFromLocation({
				geoData,
				locationBuffer: Buffer.alloc(88),
				locationRecordSize: 88,
				locationId: -1 >>> 0,
				coordBuffer: Buffer.alloc(24),
				latitudeOffset: 12,
				longitudeOffset: 16,
				areaOffset: 20,
			});

			expect(geoData.country).toBe('');
			expect(geoData.city).toBe('');
			expect(geoData.ll).toEqual([null, null]);
		});
	});
});
