const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const indexPath = require.resolve('../index.js');
const fsWatcherPath = require.resolve('../scripts/fsWatcher.js');

describe('Watcher integration', () => {
	afterEach(() => {
		mock.restoreAll();
		delete require.cache[indexPath];
		delete require.cache[fsWatcherPath];
	});

	it('should log detected file changes and trigger async reload', async () => {
		let watchCallback;
		const makeFsWatchFilter = mock.fn((_name, _directory, _files, _delay, callback) => {
			watchCallback = callback;
		});

		require.cache[fsWatcherPath] = {
			id: fsWatcherPath,
			filename: fsWatcherPath,
			loaded: true,
			exports: { makeFsWatchFilter, stopWatching: mock.fn() },
		};

		const log = mock.method(console, 'log', () => undefined);
		delete require.cache[indexPath];
		const geoIp = require('../index.js');

		const reloaded = new Promise((resolve, reject) => {
			geoIp.startWatchingDataUpdate(err => (err ? reject(err) : resolve()));
		});

		watchCallback({
			event: 'rename',
			file: 'geoip-city.dat',
			path: '/tmp/geoip-city.dat',
		});

		await reloaded;

		assert.equal(makeFsWatchFilter.mock.callCount(), 1);
		const [name, directory, files, delay, callback] = makeFsWatchFilter.mock.calls[0].arguments;
		assert.equal(name, 'dataWatcher');
		assert.equal(typeof directory, 'string');
		for (const file of ['geoip-city.dat', 'geoip-city6.dat', 'geoip-city-names.dat', 'geoip-country.dat', 'geoip-country6.dat']) {
			assert.ok(files.includes(file), `${file} is not watched`);
		}
		assert.equal(delay, 60 * 1000);
		assert.equal(typeof callback, 'function');
		assert.ok(log.mock.calls.some(c => c.arguments[0] === '[geoip-lite2] Detected change in "geoip-city.dat", reloading data...'));
	});
});
