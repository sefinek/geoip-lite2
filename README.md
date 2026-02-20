<div align="center">
    <a href="https://cdn.sefinek.net/images/npm/geoip-lite2/banner.jpg" target="_blank" title="Full screen">
        <img src="https://cdn.sefinek.net/images/npm/geoip-lite2/banner.png" alt="GeoIP-Lite v2.3 banner">
    </a>
    <br>    
    <p>
        A native <a href="https://nodejs.org" target="_blank" title="Open nodejs.org">Node.js</a> API for GeoLite data from MaxMind.<br>
        This library includes GeoLite data created by MaxMind, available from <a href="https://www.maxmind.com" target="_blank" title="Open www.maxmind.com">maxmind.com</a>.
    </p>
    <a href="https://www.npmjs.com/package/geoip-lite2" target="_blank" title="geoip-lite2 - npm" style="text-decoration:none">
        <img src="https://img.shields.io/npm/dt/geoip-lite2?maxAge=3600" alt="Number of downloads">
        <img src="https://img.shields.io/github/issues/sefinek/geoip-lite2" alt="Issues">
        <img src="https://img.shields.io/github/last-commit/sefinek/geoip-lite2" alt="Last commit">
        <img src="https://img.shields.io/github/commit-activity/w/sefinek/geoip-lite2" alt="Commit activity">
        <img src="https://img.shields.io/github/languages/code-size/sefinek/geoip-lite2" alt="Code size">
    </a>
</div>


# 🚀 Improved GeoIP Module by [Sefinek](https://sefinek.net)
A maintained and optimized fork of [geoip-lite](https://github.com/geoip-lite/node-geoip) originally created by [Philip Tellis](AUTHORS).
Fully native JavaScript implementation with synchronous, in-memory lookups for IPv4 and IPv6.
Includes automated test coverage using [Jest](https://www.npmjs.com/package/jest).

> [!WARNING]  
> Remember to regularly update the MaxMind database! You will need a token for this.

> [!NOTE]  
> This requires a large amount of RAM. It is known to fail on a Digital Ocean or AWS micro instance.
> This behavior is intentional, as the library prioritizes performance by keeping all data in memory.

> [!NOTE]  
> Please note that IPv6 geolocation data may be less complete depending on the version of the GeoLite database.


## 🛠️ Installation
### 1. Get the library
```cmd
npm install geoip-lite2
```

### 2. Update the data files (recommended)
Run `cd node_modules/geoip-lite2 && npm run updatedb license_key=YOUR_LICENSE_KEY` to update the data files. Replace `YOUR_LICENSE_KEY` with your license key obtained from [maxmind.com](https://support.maxmind.com/hc/en-us/articles/4407111582235-Generate-a-License-Key).

## 📝 Short example
### Script
```js
const geoIp = require('geoip-lite2');

const ip = '146.19.109.255';
console.log(geoIp.lookup(ip));
```

### Output
```json
{
  "range": [ 2450746624, 2450746879 ],
  "country": "PL",
  "region": "14",
  "eu": "1",
  "timezone": "Europe/Warsaw",
  "city": "Warsaw",
  "ll": [ 52.2296, 21.0067 ],
  "metro": 0,
  "area": 20
}
```


## 🌐 Live Demo API
You can see this module in action using my [official API](https://api.sefinek.net).
- Specific IP: https://api.sefinek.net/api/v2/geoip/109.207.159.255 (should not be used in production)
- Client's IP: https://api.sefinek.net/api/v2/geoip/me
- Documentation: https://api.sefinek.net/docs/v2


## 📚 Library API
GeoIP-Lite2 is completely synchronous. It does not use callbacks. All blocking file I/O is performed at startup, so all runtime calls are executed in-memory and are fast.
Startup may take up to 200 ms while reading and indexing data files into memory.

### Looking up an IP address
If you have an IP address in dotted IPv4 notation, colon IPv6 notation, or a 32-bit unsigned integer (treated as an IPv4 address),
pass it to the `lookup` method. Remember to remove any `[` and `]` around an IPv6 address before passing it to this method.

```js
const geo = geoIp.lookup(ip);
```

If the IP address was found, the `lookup` method returns an object with the following structure:

```js
{
   range: [ <low bound of IP block>, <high bound of IP block> ],
   country: 'CC',                 // 2 letter ISO-3166-1 country code
   region: 'RR',                  // Up to 3 alphanumeric characters as ISO 3166-2 code
                                  // For US states this is the 2 letter state
                                  // For the United Kingdom this could be ENG as a country like "England"
                                  // FIPS 10-4 subcountry code
   eu: '0',                       // 1 if the country is a member state of the European Union, 0 otherwise.
   timezone: 'Country/Zone',      // Timezone from IANA Time Zone Database
   city: 'City name',             // Full city name
   ll: [<latitude>, <longitude>], // Latitude and longitude of the city
   metro: <metro code>,           // Metro code
   area: <accuracy_radius>        // Approximate accuracy radius (km)
}
```

If the IP address was not found, `lookup` returns `null`.

### Pretty printing an IP address
If you have a 32-bit unsigned integer or a number returned as part of the `range` array,
you can use the `pretty` method to get a human-readable format.

```js
console.log('IP is %s', geoIp.pretty(ip));
```

The method returns a string if the input format is recognized, otherwise it returns the input itself.


## 🔄 Built-in updater
This package contains an update script that downloads files from MaxMind and handles CSV conversion.
A npm script alias has been configured to simplify this process. Internet access is required and MaxMind download limits apply.

You will need, at minimum, a free license key obtained from [maxmind.com](https://support.maxmind.com/hc/en-us/articles/4407111582235-Generate-a-License-Key) to run the update script.

The package stores checksums of MaxMind data and by default downloads them only if they have changed.

### Ways to update data
```shell
npm run updatedb license_key=YOUR_LICENSE_KEY
npm run updatedb-force license_key=YOUR_LICENSE_KEY
```

You can also run:
```shell
node ./node_modules/geoip-lite2/tools/updatedb.js license_key=YOUR_LICENSE_KEY
```

### Ways to reload data in your app when update finished
If you have a server running `geoip-lite2`, and you want to reload its geo data, after you finished update, without a restart.

#### Programmatically
You can do it programmatically, calling after scheduled data updates

```js
// Synchronously
geoIp.reloadDataSync();

// Asynchronously
geoIp.reloadData(() => {
    console.log('Done');
});
```

#### Automatic Start and stop watching for data updates
You can enable the data watcher to automatically refresh in-memory geo data when a file changes in the data directory.

```js
geoIp.startWatchingDataUpdate();
```

This tool can be used with `npm run updatedb` to periodically update geo data on a running server.

#### Environment variables
The following environment variables can be set.

```bash
# Override the default node_modules/geoip-lite/data dir
GEOTMPDIR=/some/path

# Override the default node_modules/geoip-lite/tmp dir
GEODATADIR=/some/path
```


## ⚠️ Caveats
This package includes the GeoLite database from MaxMind. It is not the most accurate database available,
however it is the best free option. You can use the commercial GeoIP database from MaxMind
by purchasing a license and converting the `.csv` files to a format supported by GeoIP-Lite2.

The library may occasionally take up to 5 seconds to load into memory.
This largely depends on disk load. It can take as little as 200 ms on a lightly loaded disk. This is a one-time cost.

### Memory usage
The library uses approximately 180–230 MB of RAM per process, depending on the database version and environment.

```js
require('geoip-lite2');
console.log(process.memoryUsage());

/**
 * Output:
 * {
 * rss: 234938368,
 * heapTotal: 7376896,
 * heapUsed: 4486592,
 * external: 189088547,
 * arrayBuffers: 187514427
 * }
**/
```


## 🔖 References
- [Documentation from MaxMind](https://www.maxmind.com/app/iso3166)
- [ISO 3166 (1 & 2) codes](https://en.wikipedia.org/wiki/ISO_3166)
- [FIPS region codes](https://en.wikipedia.org/wiki/List_of_FIPS_region_codes)


## 👥 Copyright
`GeoIP-Lite` © 2011-2018 **Philip Tellis** <philip@bluesmoon.info>


## 🔐 License
There are two licenses for the code and data. See the [LICENSE](LICENSE) file for details.