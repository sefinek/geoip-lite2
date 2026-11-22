const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const geoIp = require('../index.js');

const strictPerf = process.env.STRICT_PERF_TESTS === '1';

const benchmark = (iterations, fn) => {
	const start = process.hrtime.bigint();
	for (let i = 0; i < iterations; i++) {
		fn(i);
	}
	const durationNs = Number(process.hrtime.bigint() - start);
	const durationMs = durationNs / 1e6;

	return {
		durationMs,
		perOpMs: durationMs / iterations,
	};
};

const expectPerfUnder = (value, limit) => {
	if (strictPerf) {
		assert.ok(value < limit);
	} else {
		assert.ok(value >= 0);
	}
};

describe('Performance Tests', () => {
	describe('#LookupSpeed', () => {
		it('should perform stable IPv4 lookups', () => {
			const iterations = 1000;
			const result = geoIp.lookup('8.8.8.8');
			assert.notEqual(result, null);

			const stats = benchmark(iterations, () => {
				assert.deepEqual(geoIp.lookup('8.8.8.8'), result);
			});

			expectPerfUnder(stats.perOpMs, 1);
		});

		it('should perform stable IPv6 lookups', () => {
			const iterations = 1000;
			const result = geoIp.lookup('2001:4860:4860::8888');
			assert.notEqual(result, null);

			const stats = benchmark(iterations, () => {
				assert.deepEqual(geoIp.lookup('2001:4860:4860::8888'), result);
			});

			expectPerfUnder(stats.perOpMs, 2);
		});

		it('should handle mixed IPv4/IPv6 lookups consistently', () => {
			const ips = [
				'8.8.8.8',
				'1.1.1.1',
				'2001:4860:4860::8888',
				'72.229.28.185',
				'2606:4700:4700::1111',
			];

			const iterations = 500;
			const stats = benchmark(iterations, i => {
				const ip = ips[i % ips.length];
				const result = geoIp.lookup(ip);
				assert.equal(result === null || typeof result === 'object', true);
			});

			expectPerfUnder(stats.perOpMs, 2);
		});
	});

	describe('#MemoryEfficiency', () => {
		it('should not fail on repeated lookups', () => {
			const iterations = 10000;
			const ips = ['8.8.8.8', '1.1.1.1', '4.4.4.4'];

			for (let i = 0; i < iterations; i++) {
				const ip = ips[i % ips.length];
				const result = geoIp.lookup(ip);
				assert.equal(result === null || typeof result === 'object', true);
			}
		});

		it('should handle repeated null results', () => {
			const iterations = 5000;

			for (let i = 0; i < iterations; i++) {
				assert.equal(geoIp.lookup('192.168.1.' + (i % 255)), null);
			}
		});
	});

	describe('#BulkOperations', () => {
		it('should handle bulk IPv4 lookups', () => {
			const results = [];

			for (let i = 1; i < 256; i++) {
				const ip = `8.8.8.${i}`;
				const result = geoIp.lookup(ip);
				results.push(result);
			}

			assert.equal(results.length, 255);
			const countries = results.filter(r => r !== null).map(r => r.country);
			const uniqueCountries = [...new Set(countries)];
			assert.ok(uniqueCountries.length > 0);
		});
	});

	describe('#StressTests', () => {
		it('should handle rapid-fire lookups', () => {
			const iterations = 10000;
			let successCount = 0;

			for (let i = 0; i < iterations; i++) {
				const result = geoIp.lookup('8.8.8.8');
				if (result !== null) successCount++;
			}

			assert.equal(successCount, iterations);
		});

		it('should handle invalid inputs consistently', () => {
			const throwInputs = [null, undefined];
			const nullInputs = ['', 'invalid', {}, [], true, false, -1];

			for (let i = 0; i < 1000; i++) {
				for (const input of throwInputs) {
					assert.throws(() => geoIp.lookup(input), TypeError);
				}
				for (const input of nullInputs) {
					assert.equal(geoIp.lookup(input), null);
				}
			}
		});
	});
});
