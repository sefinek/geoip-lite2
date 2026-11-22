const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');

const fsWatcherPath = require.resolve('../scripts/fsWatcher.js');

const makeWatcher = () => {
	const watcher = { close: mock.fn() };
	watcher.on = mock.fn(() => watcher);
	return watcher;
};

describe('fsWatcher', () => {
	beforeEach(() => {
		delete require.cache[fsWatcherPath];
		mock.timers.enable({ apis: ['setTimeout'] });
	});

	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
		delete require.cache[fsWatcherPath];
	});

	it('should debounce watch events and emit the latest change details', () => {
		let onWatchEvent;
		mock.method(fs, 'watch', (_directory, callback) => {
			onWatchEvent = callback;
			return makeWatcher();
		});

		const fsWatcher = require('../scripts/fsWatcher.js');
		const callback = mock.fn();

		fsWatcher.makeFsWatchFilter('debounceWatcher', '/data', 200, callback);

		onWatchEvent('rename', 'geoip-city.dat');
		onWatchEvent('change', 'geoip-country.dat');

		mock.timers.tick(199);
		assert.equal(callback.mock.callCount(), 0);

		mock.timers.tick(1);
		assert.equal(callback.mock.callCount(), 1);
		assert.deepEqual(callback.mock.calls[0].arguments, [{
			event: 'change',
			file: 'geoip-country.dat',
			path: join('/data', 'geoip-country.dat'),
		}]);
	});

	it('should filter events to requested files', () => {
		let onWatchEvent;
		mock.method(fs, 'watch', (_directory, callback) => {
			onWatchEvent = callback;
			return makeWatcher();
		});

		const fsWatcher = require('../scripts/fsWatcher.js');
		const callback = mock.fn();

		fsWatcher.makeFsWatchFilter('fileFilterWatcher', '/data', ['geoip-city.dat'], 100, callback);

		onWatchEvent('rename', 'geoip-country.dat');
		mock.timers.tick(100);
		assert.equal(callback.mock.callCount(), 0);

		onWatchEvent('rename', 'geoip-city.dat');
		mock.timers.tick(100);
		assert.equal(callback.mock.callCount(), 1);
	});

	it('should close previous watcher when re-registering the same watcher name', () => {
		const handlers = [];
		const watchers = [makeWatcher(), makeWatcher()];
		mock.method(fs, 'watch', (_directory, callback) => {
			handlers.push(callback);
			return watchers[handlers.length - 1];
		});

		const fsWatcher = require('../scripts/fsWatcher.js');
		const callback = mock.fn();

		fsWatcher.makeFsWatchFilter('sameNameWatcher', '/data', 100, callback);
		fsWatcher.makeFsWatchFilter('sameNameWatcher', '/data', 100, callback);

		assert.equal(watchers[0].close.mock.callCount(), 1);
		assert.equal(watchers[1].close.mock.callCount(), 0);
		assert.equal(typeof handlers[0], 'function');
		assert.equal(typeof handlers[1], 'function');
	});
});
