const geoIp = require('../index.js');
const utils = require('../utils.js');

const ip = 34525252;
const addr = utils.ntoa4(ip);

console.log(`Library: v${geoIp.version}\nIP: ${34525252}\nAddress: ${addr}`);
