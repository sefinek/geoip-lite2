const geoIp = require('../index.js');

const ip = 34525252;
const addr = geoIp.pretty(ip);

console.log(`Module version: ${geoIp.version}\nIP: ${34525252}\nPretty: ${addr}`);