const geoIp2 = require('../lib/main.js');

const ip = '86.63.89.41';

const action = async () => {
	const data = geoIp2.lookup(ip);
	console.log(data);
};


setInterval(async () => {
	await action();
}, 2000);

(async () => {
	await action();
})();
