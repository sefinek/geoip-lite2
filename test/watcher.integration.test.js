const { afterEach, describe, expect, it, jest: jestGlobals } = require('@jest/globals');

describe('Watcher integration', () => {
	afterEach(() => {
		jestGlobals.restoreAllMocks();
		jestGlobals.resetModules();
	});

	it('should log detected file changes and trigger async reload', done => {
		let watchCallback;
		const makeFsWatchFilter = jestGlobals.fn((_name, _directory, _files, _delay, callback) => {
			watchCallback = callback;
		});

		jestGlobals.doMock('../scripts/fsWatcher.js', () => ({
			makeFsWatchFilter,
			stopWatching: jestGlobals.fn(),
		}));

		const logSpy = jestGlobals.spyOn(console, 'log').mockImplementation(() => undefined);
		const geoIp = require('../index.js');

		geoIp.startWatchingDataUpdate(err => {
			try {
				expect(err).toBeFalsy();
				expect(makeFsWatchFilter).toHaveBeenCalledWith(
					'dataWatcher',
					expect.any(String),
					expect.arrayContaining([
						'geoip-city.dat',
						'geoip-city6.dat',
						'geoip-city-names.dat',
						'geoip-country.dat',
						'geoip-country6.dat',
					]),
					60 * 1000,
					expect.any(Function)
				);
				expect(logSpy).toHaveBeenCalledWith('[geoip-lite2] Detected change in "geoip-city.dat". Reloading data...');
				done();
			} catch (assertErr) {
				done(assertErr);
			}
		});

		watchCallback({
			event: 'rename',
			file: 'geoip-city.dat',
			path: '/tmp/geoip-city.dat',
		});
	});
});
