const geoIp2 = require('../lib/geoip.js');

const ip = '86.63.89.41';
const data = geoIp2.lookup(ip);

console.log(data);