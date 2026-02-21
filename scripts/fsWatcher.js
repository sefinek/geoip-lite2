const { access, constants, watch } = require('node:fs');
const { join } = require('node:path');
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
	const watchState = { watcher: null, cdId: null };
	const timeoutCallback = () => {
		watchState.cdId = null;
		callback();
	};
	const onWatchEvent = (_event, changedFile) => {
		if (!changedFile) return;

		const filePath = join(directory, changedFile);
		if (!filename || filename === changedFile) {
			access(filePath, constants.F_OK, err => {
				if (err) {
					if (err.code !== 'ENOENT') console.error(err);
					return;
				}
				if (watchState.cdId !== null) {
					clearTimeout(watchState.cdId);
					watchState.cdId = null;
				}
				watchState.cdId = setTimeout(timeoutCallback, cdDelay);
			});
		}
	};
	if (typeof cdDelay === 'function') {
		callback = cdDelay;
		cdDelay = filename;
		filename = null;
	}

	if (FSWatcher[name]) {
		stopWatching(name);
	}

	watchState.watcher = watch(directory, onWatchEvent);
	FSWatcher[name] = watchState;
};

module.exports = { makeFsWatchFilter, stopWatching };

