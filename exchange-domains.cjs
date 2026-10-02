// Snapshot of v2fly/domain-list-community data/okx and data/binance.
// Keep these local so a missing remote rule set cannot prevent Momo startup.
const okx = [
  'okex.com', 'okx-dns.com', 'okx-dns1.com', 'okx-dns2.com',
  'okx.ac', 'okx.cab', 'okx.com', 'okx.com.cdn.cloudflare.net',
  'xlayer.tech', 'oklink.com',
];

const binance = [
  'binance.cc', 'binance.charity', 'binance.cloud', 'binance.co',
  'binance.com', 'binance.info', 'binance.me', 'binance.net',
  'binance.org', 'binance.us', 'binance.vision', 'binancecnt.com',
  'binancezh.be', 'binancezh.biz', 'binancezh.cc', 'binancezh.co',
  'binancezh.com', 'binancezh.info', 'binancezh.ink', 'binancezh.kim',
  'binancezh.link', 'binancezh.live', 'binancezh.mobi', 'binancezh.net',
  'binancezh.pro', 'binancezh.sh', 'binancezh.top', 'binanceapi.com',
  'binanceru.net', 'bmwweb.solutions', 'bnappweb.black',
  'bnbstatic.com', 'bnbchain.org', 'bntrace.com', 'bsappapi.cc',
  'bsappapi.com', 'bscdnweb.com', 'nftstatic.com', 'saasexch.cc',
  'saasexch.co', 'saasexch.com', 'saasexch.info', 'saasexch.io',
];

const binanceExact = [
  'zftksc.cdn-settings.appsflyersdk.com',
  'zftksc.launches.appsflyersdk.com',
];

module.exports = { okx, binance, binanceExact };
