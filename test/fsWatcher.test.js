const { afterEach, beforeEach, describe, expect, it, jest: jestGlobals } = require('@jest/globals');
const { join } = require('node:path');

describe('fsWatcher', () => {
	beforeEach(() => {
		jestGlobals.resetModules();
		jestGlobals.useFakeTimers();
	});

	afterEach(() => {
		jestGlobals.useRealTimers();
		jestGlobals.restoreAllMocks();
	});

	it('should debounce watch events and emit the latest change details', () => {
		let onWatchEvent;
		const watcher = {
			close: jestGlobals.fn(),
			on: jestGlobals.fn().mockReturnThis(),
		};
		const watch = jestGlobals.fn((_directory, callback) => {
			onWatchEvent = callback;
			return watcher;
		});

		jestGlobals.doMock('node:fs', () => ({ watch }));
		const fsWatcher = require('../scripts/fsWatcher.js');
		const callback = jestGlobals.fn();

		fsWatcher.makeFsWatchFilter('debounceWatcher', '/data', 200, callback);

		onWatchEvent('rename', 'geoip-city.dat');
		onWatchEvent('change', 'geoip-country.dat');

		jestGlobals.advanceTimersByTime(199);
		expect(callback).not.toHaveBeenCalled();

		jestGlobals.advanceTimersByTime(1);
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith({
			event: 'change',
			file: 'geoip-country.dat',
			path: join('/data', 'geoip-country.dat'),
		});
	});

	it('should filter events to requested files', () => {
		let onWatchEvent;
		const watcher = {
			close: jestGlobals.fn(),
			on: jestGlobals.fn().mockReturnThis(),
		};
		const watch = jestGlobals.fn((_directory, callback) => {
			onWatchEvent = callback;
			return watcher;
		});

		jestGlobals.doMock('node:fs', () => ({ watch }));
		const fsWatcher = require('../scripts/fsWatcher.js');
		const callback = jestGlobals.fn();

		fsWatcher.makeFsWatchFilter('fileFilterWatcher', '/data', ['geoip-city.dat'], 100, callback);

		onWatchEvent('rename', 'geoip-country.dat');
		jestGlobals.advanceTimersByTime(100);
		expect(callback).not.toHaveBeenCalled();

		onWatchEvent('rename', 'geoip-city.dat');
		jestGlobals.advanceTimersByTime(100);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it('should close previous watcher when re-registering the same watcher name', () => {
		let firstHandler;
		let secondHandler;
		const firstWatcher = {
			close: jestGlobals.fn(),
			on: jestGlobals.fn().mockReturnThis(),
		};
		const secondWatcher = {
			close: jestGlobals.fn(),
			on: jestGlobals.fn().mockReturnThis(),
		};
		let call = 0;
		const watch = jestGlobals.fn((_directory, callback) => {
			call++;
			if (call === 1) {
				firstHandler = callback;
				return firstWatcher;
			}
			secondHandler = callback;
			return secondWatcher;
		});

		jestGlobals.doMock('node:fs', () => ({ watch }));
		const fsWatcher = require('../scripts/fsWatcher.js');
		const callback = jestGlobals.fn();

		fsWatcher.makeFsWatchFilter('sameNameWatcher', '/data', 100, callback);
		fsWatcher.makeFsWatchFilter('sameNameWatcher', '/data', 100, callback);

		expect(firstWatcher.close).toHaveBeenCalledTimes(1);
		expect(secondWatcher.close).not.toHaveBeenCalled();
		expect(typeof firstHandler).toBe('function');
		expect(typeof secondHandler).toBe('function');
	});
});
