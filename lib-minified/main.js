const{open:e,fstat:r,read:t,close:n,openSync:i,fstatSync:a,readSync:o,closeSync:l}=require('fs'),{join:u,resolve:c}=require('path'),{isIP:f}=require('net'),s=require('async'),{aton4:d,aton6:y,cmp6:B,ntoa4:p,ntoa6:S,cmp:g}=require('./utils.js'),I=require('./fsWatcher.js'),{version:E}=require('../package.json'),m='dataWatcher',z=c(__dirname,global.geoDataDir||process.env.GEODATADIR||'../geoip-data/'),N={city:u(z,'geoip-city.dat'),city6:u(z,'geoip-city6.dat'),cityNames:u(z,'geoip-city-names.dat'),country:u(z,'geoip-country.dat'),country6:u(z,'geoip-country6.dat')},P=[[d('10.0.0.0'),d('10.255.255.255')],[d('172.16.0.0'),d('172.31.255.255')],[d('192.168.0.0'),d('192.168.255.255')]],h={firstIP:null,lastIP:null,lastLine:0,locationBuffer:null,locationRecordSize:88,mainBuffer:null,recordSize:24},F={firstIP:null,lastIP:null,lastLine:0,mainBuffer:null,recordSize:48};let O=JSON.parse(JSON.stringify(h)),L=JSON.parse(JSON.stringify(F));const U=e=>{let r,t,n=0,i=O.lastLine,a=O.lastIP,o=O.firstIP;const l=O.mainBuffer,u=O.locationBuffer,c=P,f=O.recordSize,s=O.locationRecordSize,d={range:[null,null],country:'',region:'',eu:'',timezone:'',city:'',ll:[null,null],metro:null,area:null};if(e>O.lastIP||e<O.firstIP)return null;for(let r=0;r<c.length;r++)if(e>=c[r][0]&&e<=c[r][1])return null;for(;;){if(r=Math.round((i-n)/2)+n,a=l.readUInt32BE(r*f),o=l.readUInt32BE(r*f+4),a<=e&&o>=e)return d.range=[a,o],10===f?d.country=l.toString('utf8',r*f+8,r*f+10):(t=l.readUInt32BE(r*f+8),-1>>>0>t&&(d.country=u.toString('utf8',t*s,t*s+2).replace(/\u0000.*/,''),d.region=u.toString('utf8',t*s+2,t*s+5).replace(/\u0000.*/,''),d.metro=u.readInt32BE(t*s+5),d.ll[0]=l.readInt32BE(r*f+12)/1e4,d.ll[1]=l.readInt32BE(r*f+16)/1e4,d.area=l.readUInt32BE(r*f+20),d.eu=u.toString('utf8',t*s+9,t*s+10).replace(/\u0000.*/,''),d.timezone=u.toString('utf8',t*s+10,t*s+42).replace(/\u0000.*/,''),d.city=u.toString('utf8',t*s+42,t*s+s).replace(/\u0000.*/,''))),d;if(n===i)return null;n===i-1?r===n?n=i:i=n:a>e?i=r:o<e&&(n=r)}},D=['0:0:0:0:0:FFFF:','::FFFF:'];function J(u){let c,f;const d=JSON.parse(JSON.stringify(h));if('function'==typeof arguments[0])s.series([i=>{s.series([r=>{e(N.cityNames,'r',((e,t)=>{c=t,r(e)}))},e=>{r(c,((r,t)=>{f=t.size,d.locationBuffer=Buffer.alloc(f),e(r)}))},e=>{t(c,d.locationBuffer,0,f,0,e)},e=>{n(c,e)},r=>{e(N.city,'r',((e,t)=>{c=t,r(e)}))},e=>{r(c,((r,t)=>{f=t.size,e(r)}))}],(t=>{if(t){if('ENOENT'!==t.code&&'EBADF'!==t.code)throw t;e(N.country,'r',((e,t)=>{e?i(e):(c=t,r(c,((e,r)=>{f=r.size,d.recordSize=10,i()})))}))}else i()}))},()=>{d.mainBuffer=Buffer.alloc(f),s.series([e=>{t(c,d.mainBuffer,0,f,0,e)},e=>{n(c,e)}],(e=>{e||(d.lastLine=f/d.recordSize-1,d.lastIP=d.mainBuffer.readUInt32BE(d.lastLine*d.recordSize+4),d.firstIP=d.mainBuffer.readUInt32BE(0),O=d),u(e)}))}]);else{try{if(c=i(N.cityNames,'r'),f=a(c).size,0===f)throw{code:'EMPTY_FILE'};O.locationBuffer=Buffer.alloc(f),o(c,O.locationBuffer,0,f,0),l(c),c=i(N.city,'r'),f=a(c).size}catch(e){if('ENOENT'!==e.code&&'EBADF'!==e.code&&'EMPTY_FILE'!==e.code)throw e;c=i(N.country,'r'),f=a(c).size,O.recordSize=10}O.mainBuffer=Buffer.alloc(f),o(c,O.mainBuffer,0,f,0),l(c),O.lastLine=f/O.recordSize-1,O.lastIP=O.mainBuffer.readUInt32BE(O.lastLine*O.recordSize+4),O.firstIP=O.mainBuffer.readUInt32BE(0)}}function T(u){let c,f;const d=JSON.parse(JSON.stringify(F));if('function'==typeof arguments[0])s.series([t=>{s.series([r=>{e(N.city6,'r',((e,t)=>{c=t,r(e)}))},e=>{r(c,((r,t)=>{f=t.size,e(r)}))}],(n=>{if(n){if('ENOENT'!==n.code&&'EBADF'!==n.code)throw n;e(N.country6,'r',((e,n)=>{e?t(e):(c=n,r(c,((e,r)=>{f=r.size,d.recordSize=34,t()})))}))}else t()}))},()=>{d.mainBuffer=Buffer.alloc(f),s.series([e=>{t(c,d.mainBuffer,0,f,0,e)},e=>{n(c,e)}],(e=>{e||(d.lastLine=f/d.recordSize-1,L=d),u(e)}))}]);else{try{if(c=i(N.city6,'r'),f=a(c).size,0===f)throw{code:'EMPTY_FILE'}}catch(e){if('ENOENT'!==e.code&&'EBADF'!==e.code&&'EMPTY_FILE'!==e.code)throw e;c=i(N.country6,'r'),f=a(c).size,L.recordSize=34}L.mainBuffer=Buffer.alloc(f),o(c,L.mainBuffer,0,f,0),l(c),L.lastLine=f/L.recordSize-1}}module.exports={cmp:g,lookup:e=>{if(!e)return null;if('number'==typeof e)return U(e);if(4===f(e))return U(d(e));if(6===f(e)){const r=(e=>{const r=e.toUpperCase();for(let e=0;e<D.length;e++){const t=D[e];if(0===r.indexOf(t))return r.substring(t.length)}return null})(e);return r?U(d(r)):(e=>{const r=L.mainBuffer,t=L.recordSize,n=O.locationBuffer,i=O.locationRecordSize,a={range:[null,null],country:'',region:'',city:'',ll:[0,0],metro:null,area:null,eu:'',timezone:''},o=(e,n)=>{const i=[];for(let a=0;a<2;a++)i.push(r.readUInt32BE(e*t+16*n+4*a));return i};L.lastIP=o(L.lastLine,1),L.firstIP=o(0,0);let l,u,c=0,f=L.lastLine,s=L.lastIP,d=L.firstIP;if(B(e,L.lastIP)>0||B(e,L.firstIP)<0)return null;for(;;){if(l=Math.round((f-c)/2)+c,s=o(l,0),d=o(l,1),B(s,e)<=0&&B(d,e)>=0)return 34===t?a.country=r.toString('utf8',l*t+32,l*t+34).replace(/\u0000.*/,''):(u=r.readUInt32BE(l*t+32),-1>>>0>u&&(a.country=n.toString('utf8',u*i,u*i+2).replace(/\u0000.*/,''),a.region=n.toString('utf8',u*i+2,u*i+5).replace(/\u0000.*/,''),a.metro=n.readInt32BE(u*i+5),a.ll[0]=r.readInt32BE(l*t+36)/1e4,a.ll[1]=r.readInt32BE(l*t+40)/1e4,a.area=r.readUInt32BE(l*t+44),a.eu=n.toString('utf8',u*i+9,u*i+10).replace(/\u0000.*/,''),a.timezone=n.toString('utf8',u*i+10,u*i+42).replace(/\u0000.*/,''),a.city=n.toString('utf8',u*i+42,u*i+i).replace(/\u0000.*/,''))),a;if(c===f)return null;c===f-1?l===c?c=f:f=c:B(s,e)>0?f=l:B(d,e)<0&&(c=l)}})(y(e))}return null},pretty:e=>'string'==typeof e?e:'number'==typeof e?p(e):Array.isArray(e)?S(e):e,startWatchingDataUpdate:e=>{I.makeFsWatchFilter(m,z,6e4,(async()=>{await s.series([e=>{J(e)},e=>{T(e)}],e)}))},stopWatchingDataUpdate:()=>I.stopWatching(m),clear:()=>{O=JSON.parse(JSON.stringify(h)),L=JSON.parse(JSON.stringify(F))},reloadDataSync:()=>{J(),T()},reloadData:async e=>{await s.series([e=>{J(e)},e=>{T(e)}],e)},version:E},J(),T();