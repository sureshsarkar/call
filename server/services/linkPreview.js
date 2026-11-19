const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const cheerio = require('cheerio');

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const cache = new Map(); // url -> { at, data }
const TTL = 60 * 60 * 1000;

/** True for loopback / private / link-local / unspecified addresses (SSRF guard). */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true;
}

// DNS lookup that refuses private addresses — validated at connect time, so DNS rebinding cannot bypass it.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('Blocked address'));
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

function fetchHtml(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch { return reject(new Error('Invalid URL')); }
    if (!['http:', 'https:'].includes(url.protocol)) return reject(new Error('Unsupported protocol'));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) return reject(new Error('Blocked address'));

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; PulseLinkPreview/1.0)',
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'identity',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error('Too many redirects'));
          return resolve(fetchHtml(new URL(res.headers.location, url).href, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        if (!/text\/html|application\/xhtml/i.test(res.headers['content-type'] || '')) {
          res.resume();
          return reject(new Error('Not an HTML page'));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          chunks.push(c);
          if (size > MAX_BYTES) { res.destroy(); resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.href }); }
        });
        res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.href }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end();
  });
}

const abs = (value, base) => {
  if (!value) return undefined;
  try {
    const u = new URL(value, base);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch { return undefined; }
};
const clip = (s, n) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, n) : undefined);

async function getLinkPreview(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  let data = { url };
  try {
    const { html, finalUrl } = await fetchHtml(url);
    const $ = cheerio.load(html);
    const meta = (...names) => {
      for (const n of names) {
        const v = $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content');
        if (v) return v;
      }
      return undefined;
    };
    data = {
      url,
      title: clip(meta('og:title', 'twitter:title') || $('title').first().text(), 200),
      description: clip(meta('og:description', 'twitter:description', 'description'), 300),
      image: abs(meta('og:image', 'og:image:url', 'twitter:image'), finalUrl),
      siteName: clip(meta('og:site_name') || new URL(finalUrl).hostname.replace(/^www\./, ''), 80),
    };
  } catch {
    data = { url, siteName: new URL(url).hostname.replace(/^www\./, '') };
  }
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(url, { at: Date.now(), data });
  return data;
}

module.exports = { getLinkPreview, isPrivateIp };
