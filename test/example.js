const geoIp = require('../index.js');

const ipv4 = '79.186.130.100';
const geo1 = geoIp.lookup(ipv4);
console.log(ipv4, geo1);

const ipv6 = '2a01:11bf:4222:900a:99ae:285f:7432:8f8e';
const geo2 = geoIp.lookup(ipv6);
console.log(ipv6, geo2);