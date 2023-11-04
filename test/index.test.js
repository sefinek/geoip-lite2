const e=require('../lib/main.js');describe('GeoIP2',(()=>{describe('#testLookup()',(()=>{it('should return data about IPv4',(()=>{const t=e.lookup('1.1.1.1');expect(t).toBeTruthy()})),it('should return data about IPv6',(()=>{const t=e.lookup('2606:4700:4700::64');expect(t).toBeTruthy()}))})),describe('#testDataIP4()',(()=>{it('should match data for IPv4 - US',(()=>{const t=e.lookup('72.229.28.185');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('US'),expect(t.region).toBe('NY'),expect(t.eu).toBe('0'),expect(t.timezone).toBe('America/New_York'),expect(t.city).toBe('New York'),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(501),expect(t.area).toBe(5)})),it('should match data for IPv4 - JP',(()=>{const t=e.lookup('210.138.184.59');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('JP'),expect(t.region).toBe('13'),expect(t.eu).toBe('0'),expect(t.timezone).toBe('Asia/Tokyo'),expect(t.city).toBe(''),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(0),expect(t.area).toBe(200)})),it('should match data for IPv4 - PL',(()=>{const t=e.lookup('104.113.255.255');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('PL'),expect(t.region).toBe('14'),expect(t.eu).toBe('1'),expect(t.timezone).toBe('Europe/Warsaw'),expect(t.city).toBe('Warsaw'),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(0),expect(t.area).toBe(20)})),it('should match data for IPv4 - RU',(()=>{const t=e.lookup('109.108.63.255');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('RU'),expect(t.region).toBe('IVA'),expect(t.eu).toBe('0'),expect(t.timezone).toBe('Europe/Moscow'),expect(t.city).toBe('Kineshma'),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(0),expect(t.area).toBe(200)}))})),describe('#testDataIP6()',(()=>{it('should match data for IPv6',(()=>{const t=e.lookup('2001:1c04:400::1');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('NL'),expect(t.region).toBe('NH'),expect(t.eu).toBe('1'),expect(t.timezone).toBe('Europe/Amsterdam'),expect(t.city).toBe('Zandvoort'),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(0),expect(t.area).toBe(5)})),it('should match data for IPv4 - JP',(()=>{const t=e.lookup('2400:8500:1302:814:a163:44:173:238f');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('JP'),expect(t.region).toBe(''),expect(t.eu).toBe('0'),expect(t.timezone).toBe('Asia/Tokyo'),expect(t.city).toBe(''),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(0),expect(t.area).toBe(500)})),it('should match data for IPv4 - JP',(()=>{const t=e.lookup('1.79.255.115');expect(void 0!==t.range).toBe(!0),expect(t.country).toBe('JP'),expect(t.region).toBe(''),expect(t.eu).toBe('0'),expect(t.timezone).toBe('Asia/Tokyo'),expect(t.city).toBe(''),expect(t.ll).toBeTruthy(),expect(t.metro).toBe(0),expect(t.area).toBe(500)}))})),describe('#testUTF8()',(()=>{it('should return UTF8 city name',(()=>{const t=e.lookup('2.139.175.1');expect(t).toBeTruthy(),expect(t.city).toBe('Barbera Del Valles')}))})),describe('#testMetro()',(()=>{it('should match metro data',(()=>{const t=e.lookup('23.240.63.68');expect(t.metro).toBe(803)}))})),describe('#testIPv4MappedIPv6()',(()=>{it('should match IPv4 mapped IPv6 data',(()=>{const t=e.lookup('195.16.170.74');expect(t.metro).toBe(0)}))})),describe('#testSyncReload()',(()=>{it('should reload data synchronously',(()=>{const t=e.lookup('75.82.117.180');expect(t).not.toBeNull();const o=e.lookup('::ffff:173.185.182.82');expect(o).not.toBeNull(),e.clear();const c=e.lookup('75.82.117.180');expect(c).toBeNull();const l=e.lookup('::ffff:173.185.182.82');expect(l).toBeNull(),e.reloadDataSync();const p=e.lookup('75.82.117.180');expect(t).toEqual(p);const r=e.lookup('::ffff:173.185.182.82');expect(o).toEqual(r)}))})),describe('#testAsyncReload()',(()=>{it('should reload data asynchronously',(t=>{const o=e.lookup('75.82.117.180');expect(o).not.toBeNull();const c=e.lookup('::ffff:173.185.182.82');expect(c).not.toBeNull(),e.clear();const l=e.lookup('75.82.117.180');expect(l).toBeNull();const p=e.lookup('::ffff:173.185.182.82');expect(p).toBeNull(),e.reloadData((()=>{const l=e.lookup('75.82.117.180');expect(o).toEqual(l);const p=e.lookup('::ffff:173.185.182.82');expect(c).toEqual(p),t()}))}))})),describe('#testInvalidIP()',(()=>{it('should return null for an invalid IP address',(()=>{const t=e.lookup('invalid_ip_address');expect(t).toBeNull()}))})),describe('#testEmptyIP()',(()=>{it('should return null for an empty IP address',(()=>{const t=e.lookup('');expect(t).toBeNull()}))})),describe('#testNullIP()',(()=>{it('should return null for a null IP address',(()=>{const t=e.lookup(null);expect(t).toBeNull()}))})),describe('#testUnknownIP()',(()=>{it('should return null for an unknown IP address',(()=>{const t=e.lookup('192.168.1.1');expect(t).toBeNull()}))})),describe('#testNoDataForIP()',(()=>{it('should return null for an IP address with no data',(()=>{const t=e.lookup('203.0.113.0');expect(t).toBeNull()}))})),describe('#testSpecialCharactersIP()',(()=>{it('should return null for an IP address with special characters',(()=>{const t=e.lookup('1.2.3.@');expect(t).toBeNull()}))}))}));