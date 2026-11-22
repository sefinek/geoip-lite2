const path = require('node:path');

const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.js'));

const IPV4_COUNT = 200000;
const IPV6_COUNT = 100000;
const ROUNDS = 7;
const RELOAD_ROUNDS = 3;

let seed = 20260101;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);

const ntoa4 = n => `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
const ntoa6 = words => words.flatMap(w => [(w >>> 16).toString(16), (w & 0xFFFF).toString(16)]).join(':');

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const formatMb = bytes => (bytes / 1024 / 1024).toFixed(1);
const formatOps = (count, ms) => Math.round(count / (ms / 1000)).toLocaleString('en-US');

const measureLookups = (geoIp, inputs) => {
	const times = [];
	let hits = 0;

	for (let round = 0; round < ROUNDS; round++) {
		hits = 0;
		const start = nowMs();
		for (let i = 0; i < inputs.length; i++) {
			if (geoIp.lookup(inputs[i]) !== null) hits++;
		}
		times.push(nowMs() - start);
	}

	return { ms: median(times), hits };
};

const measureReload = async (label, fn) => {
	const times = [];
	for (let round = 0; round < RELOAD_ROUNDS; round++) {
		const start = nowMs();
		await fn();
		times.push(nowMs() - start);
	}

	return { label, ms: median(times) };
};

const main = async () => {
	const rssBefore = process.memoryUsage().rss;
	const loadStart = nowMs();
	const geoIp = require(target);
	const loadMs = nowMs() - loadStart;
	const rssAfter = process.memoryUsage().rss;

	const ipv4Numbers = Array.from({ length: IPV4_COUNT }, random);
	const ipv4Strings = ipv4Numbers.map(ntoa4);
	const ipv6Strings = Array.from({ length: IPV6_COUNT }, () => ntoa6([(0x20000000 | (random() & 0x1FFFFFFF)) >>> 0, random(), random(), random()]));
	const ipv6Clustered = Array.from({ length: IPV6_COUNT }, () => ntoa6([(0x20010000 | (random() & 0xFFFF)) >>> 0, random(), 0, random()]));
	const mapped = ipv4Strings.slice(0, IPV4_COUNT / 2).map(ip => `::ffff:${ip}`);
	const repeated = Array.from({ length: IPV4_COUNT }, (_, i) => ['8.8.8.8', '1.1.1.1', '208.67.222.222', '9.9.9.9'][i & 3]);

	for (const set of [ipv4Strings, ipv6Strings, ipv4Numbers]) measureLookups(geoIp, set.slice(0, 5000));

	const scenarios = [
		['IPv4 string (random)', ipv4Strings],
		['IPv4 number (random)', ipv4Numbers],
		['IPv4 string (repeated)', repeated],
		['IPv6 string (random 2000::/3)', ipv6Strings],
		['IPv6 string (2001::/16)', ipv6Clustered],
		['IPv4-mapped IPv6', mapped],
	];

	const results = scenarios.map(([label, inputs]) => ({ label, count: inputs.length, ...measureLookups(geoIp, inputs) }));

	const reloads = [await measureReload('reloadDataSync()', () => geoIp.reloadDataSync()), await measureReload('reloadData()', () => geoIp.reloadData())];

	console.log(`Target:   ${target}`);
	console.log(`Node.js:  ${process.version}`);
	console.log(`Version:  ${geoIp.version}`);
	console.log(`Load:     ${loadMs.toFixed(0)} ms, RSS +${formatMb(rssAfter - rssBefore)} MB`);
	console.log(`Rounds:   ${ROUNDS} (median)`);
	console.log('');

	const labelWidth = Math.max(...results.map(r => r.label.length), ...reloads.map(r => r.label.length));
	for (const r of results) {
		console.log(`${r.label.padEnd(labelWidth)}  ${formatOps(r.count, r.ms).padStart(12)} ops/s  ${(r.ms / r.count * 1000).toFixed(3).padStart(7)} us/op  hits ${((r.hits / r.count) * 100).toFixed(1)}%`);
	}

	console.log('');
	for (const r of reloads) console.log(`${r.label.padEnd(labelWidth)}  ${r.ms.toFixed(0).padStart(6)} ms`);
};

main().catch(err => {
	console.error(err);
	process.exitCode = 1;
});
