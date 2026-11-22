import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import geoIp, { lookup, reloadDataSync, reloadData, startWatchingDataUpdate, stopWatchingDataUpdate, clear, version } from '../index.js';

describe('ESM named imports', () => {
	it('should expose every documented export', () => {
		for (const fn of [lookup, reloadDataSync, reloadData, startWatchingDataUpdate, stopWatchingDataUpdate, clear]) {
			assert.equal(typeof fn, 'function');
		}

		assert.equal(typeof version, 'string');
	});

	it('should match the default export', () => {
		assert.equal(lookup, geoIp.lookup);
		assert.equal(reloadData, geoIp.reloadData);
		assert.ok(lookup('8.8.8.8'));
	});
});
