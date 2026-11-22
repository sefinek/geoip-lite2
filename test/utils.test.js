const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../scripts/utils.js');

describe('Utility Functions', () => {
	describe('#aton4', () => {
		it('should convert IPv4 string to number', () => {
			assert.equal(utils.aton4('0.0.0.0'), 0);
			assert.equal(utils.aton4('127.0.0.1'), 2130706433);
			assert.equal(utils.aton4('192.168.1.1'), 3232235777);
			assert.equal(utils.aton4('255.255.255.255'), 4294967295);
		});

		it('should handle edge cases', () => {
			assert.equal(utils.aton4('1.1.1.1'), 16843009);
			assert.equal(utils.aton4('8.8.8.8'), 134744072);
			assert.equal(utils.aton4('10.0.0.0'), 167772160);
		});
	});

	describe('#aton6', () => {
		it('should convert IPv6 string to array', () => {
			const result = utils.aton6('::1');
			assert.ok(result instanceof Array);
			assert.equal(result.length, 4);
			// ::1 should convert to an array of 4 numbers
			assert.equal(result[3], 1);
		});

		it('should handle full IPv6 addresses', () => {
			const result = utils.aton6('2001:0db8:0000:0000:0000:0000:0000:0001');
			assert.ok(result instanceof Array);
			assert.equal(result.length, 4);
		});

		it('should handle compressed IPv6 addresses', () => {
			const result = utils.aton6('2001:db8::1');
			assert.ok(result instanceof Array);
			assert.equal(result.length, 4);
		});

		it('should handle IPv6 with trailing colon', () => {
			const result = utils.aton6('fe80::');
			assert.ok(result instanceof Array);
			assert.equal(result.length, 4);
		});

		it('should return identical output for equivalent compressed and full IPv6 forms', () => {
			const compressed = utils.aton6('2607:f0d0:1002:51::4');
			const expanded = utils.aton6('2607:f0d0:1002:0051:0000:0000:0000:0004');
			assert.deepEqual(compressed, expanded);
		});

		it('should correctly expand omitted middle zero groups', () => {
			const actual = utils.aton6('2001:db8:1::2');
			const expected = utils.aton6('2001:0db8:0001:0000:0000:0000:0000:0002');
			assert.deepEqual(actual, expected);
		});
	});

	describe('#ipv4RangeFromCidr', () => {
		it('should convert IPv4 CIDR to start/end range', () => {
			const [start, end] = utils.ipv4RangeFromCidr('192.168.1.10/24');
			assert.equal(start, utils.aton4('192.168.1.0'));
			assert.equal(end, utils.aton4('192.168.1.255'));
		});

		it('should handle /0 full range', () => {
			const [start, end] = utils.ipv4RangeFromCidr('0.0.0.0/0');
			assert.equal(start, 0);
			assert.equal(end, 4294967295);
		});

		it('should throw for invalid IPv4 CIDR', () => {
			assert.throws(() => utils.ipv4RangeFromCidr('10.0.0/8'), TypeError);
			assert.throws(() => utils.ipv4RangeFromCidr('10.0.0.1/33'), TypeError);
		});
	});

	describe('#ipv6RangeFromCidr', () => {
		it('should convert IPv6 CIDR to start/end range', () => {
			const [start, end] = utils.ipv6RangeFromCidr('2001:db8::/126');
			assert.deepEqual(start, utils.aton6('2001:db8::'));
			assert.deepEqual(end, utils.aton6('2001:db8::3'));
		});

		it('should handle /128 as a single-address range', () => {
			const [start, end] = utils.ipv6RangeFromCidr('2001:db8::1/128');
			assert.deepEqual(start, utils.aton6('2001:db8::1'));
			assert.deepEqual(end, utils.aton6('2001:db8::1'));
		});

		it('should throw for invalid IPv6 CIDR', () => {
			assert.throws(() => utils.ipv6RangeFromCidr('2001:db8::/129'), TypeError);
			assert.throws(() => utils.ipv6RangeFromCidr('2001:::1/64'), TypeError);
		});
	});

	describe('#cmp6', () => {
		it('should compare IPv6 arrays correctly', () => {
			assert.equal(utils.cmp6([0, 0, 0, 0], [0, 0, 0, 1]), -1);
			assert.equal(utils.cmp6([0, 0, 0, 1], [0, 0, 0, 0]), 1);
			assert.equal(utils.cmp6([5, 10, 15, 20], [5, 10, 15, 20]), 0);
		});

		it('should compare first element priority', () => {
			assert.equal(utils.cmp6([1, 100, 999, 999], [2, 0, 0, 0]), -1);
			assert.equal(utils.cmp6([2, 0, 0, 0], [1, 100, 999, 999]), 1);
		});

		it('should handle equal first elements', () => {
			assert.equal(utils.cmp6([1, 2, 0, 0], [1, 3, 0, 0]), -1);
			assert.equal(utils.cmp6([1, 3, 0, 0], [1, 2, 0, 0]), 1);
		});

		it('should compare lower 64 bits when upper 64 bits are equal', () => {
			assert.equal(utils.cmp6([638054608, 268566609, 0, 4], [638054608, 268566609, 0, 5]), -1);
			assert.equal(utils.cmp6([638054608, 268566609, 4, 4], [638054608, 268566609, 0, 4]), 1);
		});
	});

	describe('#SharedGeoHelpers', () => {
		it('should read all 128 bits for IPv6 address', () => {
			const buffer = Buffer.alloc(48);
			buffer.writeUInt32BE(1, 0);
			buffer.writeUInt32BE(2, 4);
			buffer.writeUInt32BE(3, 8);
			buffer.writeUInt32BE(4, 12);

			const ip = utils.readIp6(buffer, 0, 48, 0);
			assert.deepEqual(ip, [1, 2, 3, 4]);
		});

		it('should create independent geo data objects', () => {
			const first = utils.createGeoData();
			const second = utils.createGeoData();

			first.country = 'PL';
			assert.equal(second.country, '');
			assert.notEqual(first, second);
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

			assert.equal(geoData.country, 'US');
			assert.equal(geoData.region, 'NY');
			assert.equal(geoData.metro, 501);
			assert.equal(geoData.isEu, false);
			assert.equal(geoData.timezone, 'America/New_York');
			assert.equal(geoData.city, 'New York');
			assert.deepEqual(geoData.ll, [40.7128, -74.006]);
			assert.equal(geoData.area, 20);
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

			assert.equal(geoData.country, '');
			assert.equal(geoData.city, '');
			assert.deepEqual(geoData.ll, [null, null]);
		});
	});
});

describe('Additional helpers', () => {
	it('cmp6At should compare an address against a buffer record', () => {
		const buffer = Buffer.alloc(32);
		[1, 2, 3, 4].forEach((v, i) => buffer.writeUInt32BE(v, 16 + (i * 4)));

		assert.equal(utils.cmp6At(buffer, 16, [1, 2, 3, 4]), 0);
		assert.equal(utils.cmp6At(buffer, 16, [1, 2, 3, 5]), -1);
		assert.equal(utils.cmp6At(buffer, 16, [0, 9, 9, 9]), 1);
	});

	it('readString should stop at the first null byte and respect the bounds', () => {
		const buffer = Buffer.from('PL\0abcdef\0\0', 'utf8');

		assert.equal(utils.readString(buffer, 0, 2), 'PL');
		assert.equal(utils.readString(buffer, 0, 8), 'PL');
		assert.equal(utils.readString(buffer, 3, 6), 'abc');
		assert.equal(utils.readString(buffer, 2, 3), '');
		assert.equal(utils.readString(Buffer.from('Łódź\0\0', 'utf8'), 0, 9), 'Łódź');
	});
});
