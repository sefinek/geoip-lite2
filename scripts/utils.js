const aton4 = a => {
	const parts = a.split('.');
	return ((Number.parseInt(parts[0], 10) << 24) >>> 0) + ((Number.parseInt(parts[1], 10) << 16) >>> 0) + ((Number.parseInt(parts[2], 10) << 8) >>> 0) + (Number.parseInt(parts[3], 10) >>> 0);
};

const ntoa4 = n => ((n >>> 24) & 0xff) + '.' + ((n >>> 16) & 0xff) + '.' + ((n >>> 8) & 0xff) + '.' + (n & 0xff);

const aton6 = a => {
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
		parts[i] = Number.parseInt(parts[i] || '0', 16);
	}

	return [
		((parts[0] << 16) + parts[1]) >>> 0,
		((parts[2] << 16) + parts[3]) >>> 0,
		((parts[4] << 16) + parts[5]) >>> 0,
		((parts[6] << 16) + parts[7]) >>> 0,
	];
};

const ipv4ToUint32Strict = ip => {
	const octets = ip.split('.');
	if (octets.length !== 4) throw new TypeError(`Invalid IPv4 address: ${ip}`);

	for (let i = 0; i < octets.length; i++) {
		const octet = Number.parseInt(octets[i], 10);
		if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
			throw new TypeError(`Invalid IPv4 address: ${ip}`);
		}
	}

	return aton4(ip);
};

const ipv4RangeFromCidr = cidr => {
	const [ip, prefixText] = cidr.split('/');
	const prefix = Number.parseInt(prefixText, 10);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new TypeError(`Invalid IPv4 CIDR: ${cidr}`);

	const address = ipv4ToUint32Strict(ip);
	const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
	const start = (address & mask) >>> 0;
	const hostMask = (~mask) >>> 0;
	const end = (start | hostMask) >>> 0;

	return [start, end];
};

const normalizeIpv6WithEmbeddedIpv4 = ip => {
	if (!ip.includes('.')) return ip;

	const lastColon = ip.lastIndexOf(':');
	if (lastColon === -1) throw new TypeError(`Invalid IPv6 address: ${ip}`);

	const ipv4Part = ip.slice(lastColon + 1);
	const ipv4Int = ipv4ToUint32Strict(ipv4Part);
	const high = ((ipv4Int >>> 16) & 0xFFFF).toString(16);
	const low = (ipv4Int & 0xFFFF).toString(16);

	return `${ip.slice(0, lastColon)}:${high}:${low}`;
};

const ipv6ToBigInt = ip => {
	const normalized = normalizeIpv6WithEmbeddedIpv4(ip).toLowerCase();
	const hasCompression = normalized.includes('::');
	if (hasCompression && normalized.indexOf('::') !== normalized.lastIndexOf('::')) throw new TypeError(`Invalid IPv6 address: ${ip}`);

	let groups;
	if (hasCompression) {
		const [leftRaw, rightRaw] = normalized.split('::');
		const left = leftRaw ? leftRaw.split(':') : [];
		const right = rightRaw ? rightRaw.split(':') : [];
		const omitted = 8 - left.length - right.length;
		if (omitted < 0) throw new TypeError(`Invalid IPv6 address: ${ip}`);
		groups = [...left, ...new Array(omitted).fill('0'), ...right];
	} else {
		groups = normalized.split(':');
	}

	if (groups.length !== 8) throw new TypeError(`Invalid IPv6 address: ${ip}`);

	let value = 0n;
	for (let i = 0; i < groups.length; i++) {
		const group = groups[i] || '0';
		const groupValue = Number.parseInt(group, 16);
		if (!Number.isInteger(groupValue) || groupValue < 0 || groupValue > 0xFFFF) throw new TypeError(`Invalid IPv6 address: ${ip}`);

		value = (value << 16n) + BigInt(groupValue);
	}

	return value;
};

const bigIntToIpv6Uint32Array = value => {
	return [
		Number((value >> 96n) & 0xFFFFFFFFn),
		Number((value >> 64n) & 0xFFFFFFFFn),
		Number((value >> 32n) & 0xFFFFFFFFn),
		Number(value & 0xFFFFFFFFn),
	];
};

const ipv6RangeFromCidr = cidr => {
	const [ip, prefixText] = cidr.split('/');
	const prefix = Number.parseInt(prefixText, 10);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) throw new TypeError(`Invalid IPv6 CIDR: ${cidr}`);

	const address = ipv6ToBigInt(ip);
	const hostBits = 128n - BigInt(prefix);
	const networkMask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << hostBits;
	const start = address & networkMask;
	const end = start | (hostBits === 0n ? 0n : ((1n << hostBits) - 1n));

	return [
		bigIntToIpv6Uint32Array(start),
		bigIntToIpv6Uint32Array(end),
	];
};

const ntoa6 = n => {
	let a = '[';

	for (let i = 0; i < n.length; i++) {
		a += (n[i] >>> 16).toString(16) + ':';
		a += (n[i] & 0xffff).toString(16) + ':';
	}

	a = a.replace(/:$/, ']').replace(/:0+/g, ':').replace(/::+/, '::');
	return a;
};

const cmp6 = (a, b) => {
	for (let ii = 0; ii < 4; ii++) {
		const av = a[ii] ?? 0;
		const bv = b[ii] ?? 0;
		if (av < bv) return -1;
		if (av > bv) return 1;
	}

	return 0;
};

const cmp = (a, b) => {
	if (typeof a === 'number' && typeof b === 'number') return (a < b ? -1 : (a > b ? 1 : 0));
	if (Array.isArray(a) && Array.isArray(b)) return cmp6(a, b);

	return null;
};

const NO_LOCATION_INFO = -1 >>> 0;

const removeNullTerminator = str => {
	const nullIndex = str.indexOf('\0');
	return nullIndex === -1 ? str : str.substring(0, nullIndex);
};

const readIp6 = (buffer, line, recordSize, ipIndex) => {
	const base = (line * recordSize) + (ipIndex * 16);
	return [
		buffer.readUInt32BE(base),
		buffer.readUInt32BE(base + 4),
		buffer.readUInt32BE(base + 8),
		buffer.readUInt32BE(base + 12),
	];
};

const createGeoData = () => ({
	country: '',
	region: '',
	isEu: false,
	timezone: '',
	city: '',
	ll: [null, null],
	metro: null,
	area: null,
});

const populateGeoDataFromLocation = ({
	geoData,
	locationBuffer,
	locationRecordSize,
	locationId,
	coordBuffer,
	latitudeOffset,
	longitudeOffset,
	areaOffset,
}) => {
	if (locationId >= NO_LOCATION_INFO) return;

	const locOffset = locationId * locationRecordSize;
	geoData.country = removeNullTerminator(locationBuffer.toString('utf8', locOffset, locOffset + 2));
	geoData.region = removeNullTerminator(locationBuffer.toString('utf8', locOffset + 2, locOffset + 5));
	geoData.metro = locationBuffer.readInt32BE(locOffset + 5);
	geoData.ll[0] = coordBuffer.readInt32BE(latitudeOffset) / 10000;
	geoData.ll[1] = coordBuffer.readInt32BE(longitudeOffset) / 10000;
	geoData.area = coordBuffer.readUInt32BE(areaOffset);
	geoData.isEu = removeNullTerminator(locationBuffer.toString('utf8', locOffset + 9, locOffset + 10)) === '1';
	geoData.timezone = removeNullTerminator(locationBuffer.toString('utf8', locOffset + 10, locOffset + 42));
	geoData.city = removeNullTerminator(locationBuffer.toString('utf8', locOffset + 42, locOffset + locationRecordSize));
};

module.exports = {
	aton4,
	ntoa4,
	aton6,
	ipv4RangeFromCidr,
	ipv6RangeFromCidr,
	ntoa6,
	cmp,
	cmp6,
	removeNullTerminator,
	readIp6,
	createGeoData,
	populateGeoDataFromLocation,
};

