const geoIp2 = require('../lib/geoip.js');

const ip = '158.255.88.0';
const data = geoIp2.lookup(ip);

console.log(data);