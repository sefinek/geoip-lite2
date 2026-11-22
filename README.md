<div align="center">
    <img src="https://cdn.sefinek.net/images/npm/geoip-lite2/banner.png" alt="geoip-lite2 banner">
    <br>
    <p>
        A <a href="https://nodejs.org" target="_blank" title="Open nodejs.org">Node.js</a> library for IP address geolocation using MaxMind's GeoLite data.<br>
        This library includes GeoLite data created by MaxMind, available from <a href="https://www.maxmind.com" target="_blank" title="Open www.maxmind.com">maxmind.com</a>.
    </p>
    <a href="https://www.npmjs.com/package/geoip-lite2" target="_blank"><img src="https://img.shields.io/npm/dt/geoip-lite2?maxAge=3600" alt="Number of downloads"></a>
    <a href="https://github.com/sefinek/geoip-lite2/issues" target="_blank"><img src="https://img.shields.io/github/issues/sefinek/geoip-lite2" alt="Issues"></a>
    <a href="https://github.com/sefinek/geoip-lite2/commits/main" target="_blank"><img src="https://img.shields.io/github/last-commit/sefinek/geoip-lite2" alt="Last commit"></a>
    <a href="https://github.com/sefinek/geoip-lite2/commits/main" target="_blank"><img src="https://img.shields.io/github/commit-activity/w/sefinek/geoip-lite2" alt="Commit activity"></a>
    <a href="https://github.com/sefinek/geoip-lite2" target="_blank"><img src="https://img.shields.io/github/languages/code-size/sefinek/geoip-lite2" alt="Code size"></a>
</div>


# 🚀 GeoIP-Lite2 - Fast IP Address Geolocation
An actively maintained and optimized fork of [geoip-lite](https://github.com/geoip-lite/node-geoip). See the [list of authors](AUTHORS).
Written entirely in JavaScript, with synchronous, in-memory lookups for IPv4 and IPv6 addresses.

> [!WARNING]
> Remember to update the MaxMind database regularly! You will need a license key for this.

### Limitations
The library loads geolocation data into memory. In a local measurement, the Node.js process used approximately 233 MB of RAM (`rss`) after loading the library with the repository's data files.
This is an example measurement, not a fixed memory limit. The availability of information about IPv4 and IPv6 addresses depends on the contents of the database in use.


## 🛠️ Installation
### 1. Get the library
```cmd
npm install geoip-lite2
```

### 2. Update the data files (required)
Run the update script with your MaxMind license key (obtainable for free from [maxmind.com](https://support.maxmind.com/hc/en-us/articles/4407111582235-Generate-a-License-Key)):
```shell
cd node_modules/geoip-lite2 && npm run updatedb license_key=YOUR_LICENSE_KEY
```

Or set the key via an environment variable and run from your project root:
```shell
MAXMIND_KEY=YOUR_LICENSE_KEY node node_modules/geoip-lite2/tools/updatedb.js
```

## 📝 Short Example
```js
const geoIp = require('geoip-lite2');

const ip = '79.186.130.100';
console.log(geoIp.lookup(ip));
```

### Output
```json
{
  "country": "PL",
  "region": "22",
  "isEu": true,
  "timezone": "Europe/Warsaw",
  "city": "Gdynia",
  "ll": [ 54.5295, 18.4488 ],
  "metro": 0,
  "area": 200
}
```


## 🌐 Live Demo API
You can see this module in action using my [official API](https://api.sefinek.net).
- Specific IP: https://api.sefinek.net/api/v2/geoip/109.207.159.255 (not for production use)
- Client's IP: https://api.sefinek.net/api/v2/geoip/me
- Documentation: https://api.sefinek.net/docs/v2


## 📚 Library API
GeoIP-Lite2 performs lookups synchronously in memory (`lookup`). It also provides async data reload methods (`reloadData`) and file watcher callbacks (`startWatchingDataUpdate`).
All blocking file I/O is performed at startup, so all runtime lookups are fast. Startup may take up to 200 ms while reading and indexing data files into memory.

### Looking up an IP address
If you have an IP address in dotted IPv4 notation, colon IPv6 notation, or a 32-bit unsigned integer (treated as an IPv4 address), pass it to the `lookup` method.

```js
const geo = geoIp.lookup(ip);
```

If `ip` is `undefined` or `null`, `lookup` throws a `TypeError`. For any other invalid input (empty string, non-IP string, non-finite or noninteger number), it returns `null`.

If the IP address was found, the `lookup` method returns an object with the following structure:

```js
{
   country: 'CC',                 // 2-letter ISO 3166-1 country code
   region: 'RR',                  // Up to 3-character ISO 3166-2 subdivision code
                                  // (e.g. 'NY' for New York, 'ENG' for England)
   isEu: true,                    // true if the country is an EU member state
   timezone: 'Country/Zone',      // IANA Time Zone Database identifier
   city: 'City name',             // Full city name
   ll: [<latitude>, <longitude>], // Latitude and longitude of the city, or [null, null]
   metro: <metro code>,           // Nielsen metro code (0 if unavailable)
   area: <accuracy_radius>        // Approximate accuracy radius in km
}
```

If the IP address was not found, `lookup` returns `null`.

## 🔄 Built-in Updater
This package contains an update script that downloads files from MaxMind and handles CSV conversion.
A npm script alias has been configured to simplify this process. Internet access is required and MaxMind download limits apply.

You will need, at minimum, a free license key obtained from [maxmind.com](https://support.maxmind.com/hc/en-us/articles/4407111582235-Generate-a-License-Key) to run the update script.

The package stores checksums of MaxMind data and by default downloads them only if they have changed.

### Updating data
```shell
# Standard update (skips if data unchanged)
npm run updatedb license_key=YOUR_LICENSE_KEY

# Force update regardless of checksum
npm run updatedb-force license_key=YOUR_LICENSE_KEY
```

### Reloading data at runtime
If you have a server running `geoip-lite2` and you want to reload its geo data after an update without a restart:

#### Programmatically
```js
// Synchronously
geoIp.reloadDataSync();

// Asynchronously (callback)
geoIp.reloadData(() => {
    console.log('[geoip-lite2] Done');
});

// Asynchronously (Promise)
await geoIp.reloadData();
```

#### Automatic file watching
You can enable the built-in file watcher to automatically refresh in-memory geo data whenever a file changes in the data directory:

```js
geoIp.startWatchingDataUpdate();

// Optional: receive errors from background reloads
geoIp.startWatchingDataUpdate(err => {
    if (err) console.error('[geoip-lite2] GeoIP reload failed:', err);
});

// Stop watching
geoIp.stopWatchingDataUpdate();
```

#### Environment variables
The following environment variables are supported:

```bash
# MaxMind license key (alternative to the license_key= argument)
MAXMIND_KEY=your_license_key

# Override the default data directory (default: node_modules/geoip-lite2/data)
GEOIP_DATA_DIR=/some/path

# Override the default temporary directory used during updates
GEOIP_TMP_DIR=/some/path
```

Alternatively, you can set the data directory programmatically before requiring the module:

```js
globalThis['geoDataDir'] = '/some/path';
const geoIp = require('geoip-lite2');
```

### Clearing in-memory data

`clear()` releases all in-memory GeoIP buffers. Subsequent lookups return `null` until data is reloaded.

```js
geoIp.clear();
// all lookups return null now

geoIp.reloadDataSync();
// data restored
```


## ⚠️ Caveats
This package includes the GeoLite database from MaxMind. It is not the most accurate database available, however it is the best free option.
You can use the commercial GeoIP database from MaxMind by purchasing a license and converting the `.csv` files to a format supported by GeoIP-Lite2.

The library may occasionally take up to 5 seconds to load into memory.
This largely depends on disk load. It can take as little as 200 ms on a lightly loaded disk. This is a one-time cost.

### Memory usage
A local measurement after loading the library with the repository's data files reported approximately 233 MB of process memory (`rss`). Actual usage depends on the database version and environment.

```js
require('geoip-lite2');
console.log(process.memoryUsage());

/**
 * Output:
 * {
 *   rss: 233492480,
 *   heapTotal: 6688768,
 *   heapUsed: 4811448,
 *   external: 198632582,
 *   arrayBuffers: 196483831
 * }
 */
```


## Development
Automated tests use the built-in Node.js test runner:

```shell
npm test
```


## 🔖 References
- [Documentation from MaxMind](https://www.maxmind.com/app/iso3166)
- [ISO 3166 (1 & 2) codes](https://en.wikipedia.org/wiki/ISO_3166)
- [FIPS region codes](https://en.wikipedia.org/wiki/List_of_FIPS_region_codes)


## 👥 Copyright
`GeoIP-Lite2` © 2023–present **Sefinek** <contact@sefinek.net>  
`GeoIP-Lite` © 2011–2018 **Philip Tellis** <philip@bluesmoon.info>


## 🔐 License
There are two licenses for the code and data. See the [LICENSE](LICENSE) file for details.
