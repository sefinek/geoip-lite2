// ============================================================================
// Utility Functions for IP Address Conversion and Comparison
// ============================================================================

const utils = module.exports = {};

// ============================================================================
// IPv4 Conversion Functions
// ============================================================================

utils.aton4 = a => {
	const parts = a.split('.');
	return ((parseInt(parts[0], 10) << 24) >>> 0) + ((parseInt(parts[1], 10) << 16) >>> 0) + ((parseInt(parts[2], 10) << 8) >>> 0) + (parseInt(parts[3], 10) >>> 0);
};

utils.ntoa4 = n => {
	return ((n >>> 24) & 0xff) + '.' + ((n >>> 16) & 0xff) + '.' + ((n >>> 8) & 0xff) + '.' + (n & 0xff);
};

// ============================================================================
// IPv6 Conversion Functions
// ============================================================================

utils.aton6 = a => {
	a = a.replace(/"/g, '');

	let parts;
	const omitStart = a.indexOf('::');
	if (omitStart >= 0) {
		const left = a.slice(0, omitStart);
		const right = a.slice(omitStart + 2);
		const leftParts = left ? left.split(':') : [];
		const rightParts = right ? right.split(':') : [];
		const omitted = 8 - leftParts.length - rightParts.length;

		parts = leftParts.concat(new Array(Math.max(omitted, 0)).fill('0'), rightParts);
	} else {
		parts = a.split(':');
	}

	for (let i = 0; i < 8; i++) {
		parts[i] = parseInt(parts[i] || '0', 16);
	}

	const r = [];
	for (let i = 0; i < 4; i++) {
		r.push(((parts[2 * i] << 16) + parts[(2 * i) + 1]) >>> 0);
	}

	return r;
};

utils.ntoa6 = n => {
	let a = '[';

	for (let i = 0; i < n.length; i++) {
		a += (n[i] >>> 16).toString(16) + ':';
		a += (n[i] & 0xffff).toString(16) + ':';
	}

	a = a.replace(/:$/, ']').replace(/:0+/g, ':').replace(/::+/, '::');
	return a;
};

// ============================================================================
// Comparison Functions
// ============================================================================

utils.cmp = (a, b) => {
	if (typeof a === 'number' && typeof b === 'number') return (a < b ? -1 : (a > b ? 1 : 0));
	if (a instanceof Array && b instanceof Array) return utils.cmp6(a, b);

	return null;
};

utils.cmp6 = (a, b) => {
	for (let ii = 0; ii < 4; ii++) {
		const av = a[ii] ?? 0;
		const bv = b[ii] ?? 0;
		if (av < bv) return -1;
		if (av > bv) return 1;
	}

	return 0;
};
