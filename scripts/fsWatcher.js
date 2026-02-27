const { watch } = require('node:fs');
const { basename, join } = require('node:path');
const FSWatcher = {};

const stopWatching = name => {
	const watchState = FSWatcher[name];
	if (!watchState) return;

	if (watchState.cdId !== null) {
		clearTimeout(watchState.cdId);
		watchState.cdId = null;
	}

	watchState.watcher.close();
	delete FSWatcher[name];
};

const makeFsWatchFilter = (name, directory, filename, cdDelay, callback) => {
	if (typeof filename === 'function') {
		callback = filename;
		cdDelay = 0;
		filename = null;
	} else if (typeof cdDelay === 'function') {
		callback = cdDelay;
		cdDelay = filename;
		filename = null;
	}

	const watchState = { watcher: null, cdId: null, lastChange: null };
	const cooldown = typeof cdDelay === 'number' ? cdDelay : 0;
	const watchFiles = Array.isArray(filename)
		? new Set(filename)
		: (typeof filename === 'string' ? new Set([filename]) : null);
	const timeoutCallback = () => {
		watchState.cdId = null;
		callback(watchState.lastChange);
	};
	const onWatchEvent = (event, changedFile) => {
		const changedFileName = Buffer.isBuffer(changedFile)
			? changedFile.toString()
			: (typeof changedFile === 'string' ? changedFile : null);
		const normalizedFileName = changedFileName ? basename(changedFileName) : null;
		if (watchFiles && normalizedFileName && !watchFiles.has(normalizedFileName)) return;

		watchState.lastChange = {
			event,
			file: normalizedFileName,
			path: normalizedFileName ? join(directory, normalizedFileName) : directory,
		};

		if (watchState.cdId !== null) {
			clearTimeout(watchState.cdId);
			watchState.cdId = null;
		}
		watchState.cdId = setTimeout(timeoutCallback, cooldown);
	};

	if (FSWatcher[name]) stopWatching(name);

	watchState.watcher = watch(directory, onWatchEvent);
	watchState.watcher.on('error', err => {
		if (err && err.code !== 'ENOENT') console.error('[geoip-lite2] Data watcher error:', err);
	});
	FSWatcher[name] = watchState;
};

module.exports = { makeFsWatchFilter, stopWatching };

