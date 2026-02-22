const geoIp = require('../index.js');

geoIp.startWatchingDataUpdate(err => {
	if (err) {
		console.error('[geoip-lite2] GeoIP reload failed:', err);
		return;
	}
	console.log('[geoip-lite2] Reloaded GeoIP database');
});

const ipv4 = '79.186.130.100';
console.log(ipv4, geoIp.lookup(ipv4));

const ipv6 = '2a01:11bf:4222:900a:99ae:285f:7432:8f8e';
console.log(ipv6, geoIp.lookup(ipv6));
