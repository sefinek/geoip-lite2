const geoIp2 = require('../lib/geoip.js');

const ip = '2003:6:2184:e6d5:5991:6779:38be:654';
const data = geoIp2.lookup(ip);

console.log(data);