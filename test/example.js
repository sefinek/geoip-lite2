const geoIp = require('../index.js');

const ipv4 = geoIp.lookup('79.186.130.100');
console.log(ipv4);

const ipv6 = geoIp.lookup('2a01:11bf:4222:900a:99ae:285f:7432:8f8e');
console.log(ipv6);