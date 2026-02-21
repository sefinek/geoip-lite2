const { describe, expect, it } = require('@jest/globals');
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
		expect(value).toBeLessThan(limit);
	} else {
		expect(value).toBeGreaterThanOrEqual(0);
	}
};

describe('Performance Tests', () => {
	describe('#LookupSpeed', () => {
		it('should perform stable IPv4 lookups', () => {
			const iterations = 1000;
			const result = geoIp.lookup('8.8.8.8');
			expect(result).not.toBeNull();

			const stats = benchmark(iterations, () => {
				expect(geoIp.lookup('8.8.8.8')).toEqual(result);
			});

			expectPerfUnder(stats.perOpMs, 1);
		});

		it('should perform stable IPv6 lookups', () => {
			const iterations = 1000;
			const result = geoIp.lookup('2001:4860:4860::8888');
			expect(result).not.toBeNull();

			const stats = benchmark(iterations, () => {
				expect(geoIp.lookup('2001:4860:4860::8888')).toEqual(result);
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
				expect(result === null || typeof result === 'object').toBe(true);
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
				expect(result === null || typeof result === 'object').toBe(true);
			}
		});

		it('should handle repeated null results', () => {
			const iterations = 5000;

			for (let i = 0; i < iterations; i++) {
				expect(geoIp.lookup('192.168.1.' + (i % 255))).toBeNull();
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

			expect(results.length).toBe(255);
			const countries = results.filter(r => r !== null).map(r => r.country);
			const uniqueCountries = [...new Set(countries)];
			expect(uniqueCountries.length).toBeGreaterThan(0);
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

			expect(successCount).toBe(iterations);
		});

		it('should handle invalid inputs consistently', () => {
			const throwInputs = [null, undefined];
			const nullInputs = ['', 'invalid', {}, [], true, false, -1];

			for (let i = 0; i < 1000; i++) {
				for (const input of throwInputs) {
					expect(() => geoIp.lookup(input)).toThrow(TypeError);
				}
				for (const input of nullInputs) {
					expect(geoIp.lookup(input)).toBeNull();
				}
			}
		});
	});
});
