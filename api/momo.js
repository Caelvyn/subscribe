import crypto from 'node:crypto';
import profileBuilder from '../build-profile.cjs';

const { buildProfile } = profileBuilder;

function tokenMatches(provided, expected) {
  if (!provided || !expected || expected.length < 24) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function fetchSubscription(url, userAgent) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Source request failed');
  const body = await response.text();
  if (body.length > 4_000_000) throw new Error('Source too large');
  return body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('{"error":"Method not allowed"}');
  }
  const params = new URL(req.url, 'https://local.invalid').searchParams;
  const key = params.get('key');
  if (!tokenMatches(key, process.env.MOMO_FEED_TOKEN)) {
    res.statusCode = 403;
    return res.end('{"error":"Forbidden"}');
  }
  const source = (params.get('source') || 'AB').toUpperCase();
  if (!['A', 'B', 'AB'].includes(source)) {
    res.statusCode = 400;
    return res.end('{"error":"Unknown source"}');
  }
  const { MOMO_SOURCE_A, MOMO_SOURCE_B, MOMO_API_SECRET } = process.env;
  if ((source !== 'B' && !MOMO_SOURCE_A) ||
      (source !== 'A' && !MOMO_SOURCE_B) || !MOMO_API_SECRET) {
    res.statusCode = 503;
    return res.end('{"error":"Feed is not configured"}');
  }
  try {
    const [aText, bText] = await Promise.all([
      source === 'B' ? '' : fetchSubscription(MOMO_SOURCE_A, 'Clash.Meta'),
      source === 'A' ? '' : fetchSubscription(MOMO_SOURCE_B, 'sing-box'),
    ]);
    const profile = buildProfile(
      aText,
      bText,
      MOMO_API_SECRET,
      Number(process.env.MOMO_MIN_A || 61),
      Number(process.env.MOMO_MIN_B || 118),
      source,
      process.env.MOMO_WAN_INTERFACE || 'pppoe-wan',
      {
        mac: process.env.MOMO_PHONE_24G_MAC,
        server: process.env.MOMO_RESIDENTIAL_SERVER,
        port: process.env.MOMO_RESIDENTIAL_PORT,
        username: process.env.MOMO_RESIDENTIAL_USERNAME,
        password: process.env.MOMO_RESIDENTIAL_PASSWORD,
      },
    );
    res.statusCode = 200;
    return res.end(JSON.stringify(profile));
  } catch {
    res.statusCode = 502;
    return res.end('{"error":"Unable to build a complete configuration"}');
  }
}
