const { access, constants, watch } = require('node:fs');
const { join } = require('node:path');
const FSWatcher = {};

/**
 * Takes an FSWatcher object and closes it.
 * @param {string} name - The name of the watcher to close.
 */
const stopWatching = name => FSWatcher[name].close();

/**
 * Takes a directory/file and watch for change. Upon change, call the callback.
 *
 * @param {String} name - name of this watcher
 * @param {String} directory - path to the directory to watch
 * @param {String} [filename] - (optional) specific filename to watch for, watches for all files in the directory if unspecified
 * @param {Number} cdDelay - delay to wait before triggering the callback
 * @param {Function} callback - function() - called when changes are detected
 */
const makeFsWatchFilter = (name, directory, filename, cdDelay, callback) => {
	let cdId = null;

	// Delete the cdId and callback the outer function
	function timeoutCallback() {
		cdId = null;
		callback();
	}

	// This function is called when there is a change in the data directory
	// It sets a timer to wait for the change to be completed
	function onWatchEvent(event, changedFile) {
		// Check to make sure changedFile is not null
		if (!changedFile) return;

		const filePath = join(directory, changedFile);
		if (!filename || filename === changedFile) {
			access(filePath, constants.F_OK, err => {
				if (err) return console.error(err);

				// At this point, a new file system activity has been detected,
				// We have to wait for file transfer to be finished before moving on.

				// If a cdId already exists, we delete it
				if (cdId !== null) {
					clearTimeout(cdId);
					cdId = null;
				}

				// Once the cdDelay has passed, the timeoutCallback function will be called
				cdId = setTimeout(timeoutCallback, cdDelay);
			});
		}
	}

	// Manage the case where filename is missing (because it's optional)
	if (typeof cdDelay === 'function') {
		callback = cdDelay;
		cdDelay = filename;
		filename = null;
	}

	if (FSWatcher[name]) {
		stopWatching(name);
	}

	FSWatcher[name] = watch(directory, onWatchEvent);
};

module.exports = { makeFsWatchFilter, stopWatching };