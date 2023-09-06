🗺️ GeoIP-Lite2 v2.1.0 - Now even faster!
==========
A native Node.js API for the GeoLite data from MaxMind.

This product includes GeoLite data created by MaxMind, available from: https://www.maxmind.com

🚀 Improved GeoIP Module by [Sefinek](https://sefinek.net)
------------
This module is an improved and updated edition of [geoip-lite](https://github.com/geoip-lite/node-geoip), thoughtfully designed to meet the latest programming standards.

All components have undergone meticulous updates to ensure peak performance and functionality.
Notably, it is now powered by the most up-to-date MaxMind database, offering significantly enhanced accuracy and reliability. This translates to approximately 40% more precise geolocation data for any IP address, compared to the previous version which relied on a database from 2019.

Now this module operates even faster because its files have been minified!

Furthermore, the testing process has been improved by adopting the testing library Mocha.
This change enhances testing and contributes to the overall reliability of the module.

> I am not the creator of this npm module! All copyright rights belong to its original [Creators](AUTHORS).

✨ Demonstration
------------
You can see this module in action on my official API. Generally speaking, the API interface is public, and you can safely use it in your projects. Happy coding!

> Endpoint : https://api.sefinek.net/api/v2/geoip/{ip}  
> Example  : https://api.sefinek.net/api/v2/geoip/109.207.159.255

📑 Introduction
------------
MaxMind provides a set of data files for IP to Geo mapping along with opensource libraries to parse and lookup these data files.
One would typically write a wrapper around their C API to get access to this data in other languages (like JavaScript).

GeoIP-Lite instead attempts to be a fully native JavaScript library. A converter script converts the CSV files from MaxMind into
an internal binary format (note that this is different from the binary data format provided by MaxMind). The geo-ip module uses this
binary file to lookup IP addresses and return the country, region and city that it maps to.

Both IPv4 and IPv6 addresses are supported, however since the GeoLite IPv6 database does not currently contain any city or region
information, city, region and postal code lookups are only supported for IPv4.

> **Warning**
> You MUST update the data files after installation. The MaxMind license does not allow us to distribute the latest version of the data files with this package. Follow the instructions under update the datafiles for details.


📚 Philosophy
----------
I was really aiming for a fast JavaScript native implementation for geomapping of IPs.
My prime motivator was the fact that it was really hard to get libgeoip built for Mac OSX without using the library from MacPorts.


🕵️‍♂️ Why GeoIP-Lite?
-------------
GeoIP-Lite is a fully JavaScript implementation of the MaxMind GeoIP API. It is not as fully featured as bindings that use `libgeoip`.
By reducing scope, this package is about 40% faster at doing lookups. On average, an IP to Location lookup should take 20 microseconds on
a Macbook Pro. IPv4 addresses take about 6 microseconds, while IPv6 addresses take about 30 microseconds.


📝 Synopsis
--------
### Script
```javascript
const geoIp2 = require('geoip-lite2');

const ip = '207.97.227.239';
const geo = geoIp2.lookup(ip);

console.log(geo);
```

### Output
```json
{
  "range": [ 3479298048, 3479300095 ],
  "country": "US",
  "region": "TX",
  "eu": "0",
  "timezone": "America/Chicago",
  "city": "San Antonio",
  "ll": [ 29.4969, -98.4032 ],
  "metro": 641,
  "area": 1000
}
```


🛠️ Installation
------------
### 1. Get the library
```cmd
npm install geoip-lite2
```

### 2. Update the datafiles (optional)
Run `cd node_modules/geoip-lite2 && npm run updatedb license_key=YOUR_LICENSE_KEY` to update the data files. (Replace `YOUR_LICENSE_KEY` with your license key obtained from [maxmind.com](https://support.maxmind.com/hc/en-us/articles/4407111582235-Generate-a-License-Key))

You can create maxmind account [here](https://www.maxmind.com/en/geolite2/signup).

**NOTE** that this requires a lot of RAM. It is known to fail on a Digital Ocean or AWS micro instance.
There are no plans to change this. GeoIP-Lite2 stores all data in RAM in order to be fast.


🧩 API
---
GeoIp-Lite2 is completely synchronous. There are no callbacks involved.
All blocking file IO is done at startup time, so all runtime calls are executed in-memory and are fast.
Startup may take up to 200ms while it reads into memory and indexes data files.

### Looking up an IP address
If you have an IP address in dotted quad notation, IPv6 colon notation, or a 32-bit unsigned integer (treated
as an IPv4 address), pass it to the `lookup` method. Note that you should remove any `[` and `]` around an
IPv6 address before passing it to this method.

```javascript
const geo = geoIp2.lookup(ip);
```

If the IP address was found, the `lookup` method returns an object with the following structure:

```javascript
{
   range: [ <low bound of IP block>, <high bound of IP block> ],
   country: 'XX',                 // 2 letter ISO-3166-1 country code
   region: 'RR',                  // Up to 3 alphanumeric variable length characters as ISO 3166-2 code
                                  // For US states this is the 2 letter state
                                  // For the United Kingdom this could be ENG as a country like “England
                                  // FIPS 10-4 subcountry code
   eu: '0',                       // 1 if the country is a member state of the European Union, 0 otherwise.
   timezone: 'Country/Zone',      // Timezone from IANA Time Zone Database
   city: "City Name",             // This is the full city name
   ll: [<latitude>, <longitude>], // The latitude and longitude of the city
   metro: <metro code>,           // Metro code
   area: <accuracy_radius>        // The approximate accuracy radius (km), around the latitude and longitude
}
```

The actual values for the `range` array depend on whether the IP is IPv4 or IPv6 and should be
considered internal to `geoip-lite2`. To get a human-readable format, pass them to `geoip.pretty()`

If the IP address was not found, the `lookup` returns `null`

### Pretty printing an IP address
If you have a 32-bit unsigned integer, or a number returned as part of the `range` array from the `lookup` method,
the `pretty` method can be used to turn it into a human-readable string.

```javascript
console.log('The IP is %s', geoip.pretty(ip));
```

This method returns a string if the input was in a format that `geoip-lite2` can recognise, else it returns the
input itself.


🔄 Built-in Updater
----------------
This package contains an update script that can pull the files from MaxMind and handle the conversion from CSV.
A npm script alias has been setup to make this process easy. Please keep in mind this requires internet and MaxMind
rate limits that amount of downloads on their servers.

You will need, at minimum, a free license key obtained from [maxmind.com](https://support.maxmind.com/hc/en-us/articles/4407111582235-Generate-a-License-Key) to run the update script.

Package stores checksums of MaxMind data and by default only downloads them if checksums have changed.

### Ways to update data
```shell
# Update data if new data is available
npm run updatedb license_key=YOUR_LICENSE_KEY

# Force update data even if checksums have not changed
npm run updatedb-force license_key=YOUR_LICENSE_KEY
```

You can also run it by doing:
```bash
node ./node_modules/geoip-lite2/scripts/updatedb.js license_key=YOUR_LICENSE_KEY
```

### Ways to reload data in your app when update finished
If you have a server running `geoip-lite2`, and you want to reload its geo data, after you finished update, without a restart.

#### Programmatically
You can do it programmatically, calling after scheduled data updates

```javascript
// Synchronously
geoip.reloadDataSync();

// Asynchronously
geoip.reloadData(() => {
    console.log('Done');
});
```

#### Automatic Start and stop watching for data updates
You can enable the data watcher to automatically refresh in-memory geo data when a file changes in the data directory.

```javascript
geoip.startWatchingDataUpdate();
```

This tool can be used with `npm run updatedb` to periodically update geo data on a running server.


⚠️ Caveats
-------
This package includes the GeoLite database from MaxMind. This database is not the most accurate database available,
however it is the best available for free. You can use the commercial GeoIP database from MaxMind with better
accuracy by buying a license from MaxMind, and then using the conversion utility to convert it to a format that
GeoIP-Lite understands. You will need to use the `.csv` files from MaxMind for conversion.

Also note that on occasion, the library may take up to 5 seconds to load into memory. This is largely dependent on
how busy your disk is at that time. It can take as little as 200ms on a lightly loaded disk. This is a one time
cost though, and you make it up at run time with very fast lookups.

### Memory usage
Quick test on memory consumption shows that library uses around 100Mb per process.

```javascript
const geoip2 = require('geoip-lite2');
console.log(process.memoryUsage());

/**
 * Output:
 * {
 *     rss: 126365696,
 *     heapTotal: 7753728,
 *     heapUsed: 5844880,
 *     external: 164098897,
 *     arrayBuffers: 163675390
 * }
**/
```


🔀 Alternatives
----------
If your use-case requires doing less than 100 queries through the lifetime of your application or if you need really fast latency on start-up, you might want to look into [fast-geoip](https://github.com/onramper/fast-geoip) a package with a compatible API that is optimized for serverless environments and provides faster boot times and lower memory consumption at the expense of longer lookup times.


🔖 References
----------
  - <a href="http://www.maxmind.com/app/iso3166">Documentation from MaxMind</a>
  - <a href="http://en.wikipedia.org/wiki/ISO_3166">ISO 3166 (1 & 2) codes</a>
  - <a href="http://en.wikipedia.org/wiki/List_of_FIPS_region_codes">FIPS region codes</a>


©️ Copyright
---------
`GeoIP-Lite` is Copyright 2011-2018 Philip Tellis <philip@bluesmoon.info>  
`GeoIP-Lite2` is Copyright 2023 Sefinek <contact@sefinek.net> (https://sefinek.net)


🔐 License
-------
There are two licenses for the code and data. See the [LICENSE](LICENSE) file for details.
