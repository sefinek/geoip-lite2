const t=require('assert'),o=+new Date,n=require('../lib/main.js'),r=+new Date;if(process.argv.length>2){console.dir(n.lookup(process.argv[2]));const t=+new Date;console.log('Startup: %dms, exec: %dms',r-o,t-r),process.exit(1)}const e=[];let a;const s=3e4,d=[];let h;const i=+new Date;for(let o=0;o<s;o++)a=o%2==0?Math.round(4278190080*Math.random()+16777215):'2001:'+Math.round(65535*Math.random()).toString(16)+':'+Math.round(65535*Math.random()).toString(16)+':'+Math.round(65535*Math.random()).toString(16)+':'+Math.round(65535*Math.random()).toString(16)+':'+Math.round(65535*Math.random()).toString(16)+':'+Math.round(65535*Math.random()).toString(16)+':'+Math.round(65535*Math.random()).toString(16),h=n.lookup(a),null!==h?(e.push([a,h]),t.ok(n.cmp(a,h.range[0])>=0,'Problem with '+n.pretty(a)+' < '+n.pretty(h.range[0])),t.ok(n.cmp(a,h.range[1])<=0,'Problem with '+n.pretty(a)+' > '+n.pretty(h.range[1]))):d.push(a);const l=+new Date;console.log('Found %d (%d/%d) ips in %dms (%s ip/s) (%sμs/ip)',s,e.length,d.length,l-i,(1e3*s/(l-i)).toFixed(3),(1e3*(l-i)/s).toFixed(0)),console.log('Took %d ms to startup',r-o);