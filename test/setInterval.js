const geoIp = require('../index.js');
const ip = '86.63.89.41';

// Function
const action = async () => {
	const data = geoIp.lookup(ip);
	console.log(data);
};

// Interval
setInterval(async () => {
	await action();
}, 100);

// Run
(async () => await action())();