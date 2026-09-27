import crypto from 'node:crypto';
import profileBuilder from '../build-profile.cjs';
import profileLabels from '../profile-labels.cjs';
import profileVariants from '../profile-variants.cjs';

const { buildProfile } = profileBuilder;

function tokenMatches(provided, expected) {
  if (!provided || !expected || expected.length < 24) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function fetchSubscription(url, userAgent, source) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Object.assign(new Error('Source request failed'), {
    feedSource: source, upstreamStatus: response.status,
  });
  const body = await response.text();
  if (body.length > 4_000_000) throw new Error('Source too large');
  if (/^\s*(?:<!doctype\s+html|<html)/i.test(body)) {
    const signals = ['cloudflare', 'cf-chl', 'challenge-platform', 'captcha', 'javascript',
      'just a moment', 'access denied', 'not found', '404', 'login', 'expired',
      '验证', '登录', '过期', '失效'].filter(marker => body.toLowerCase().includes(marker));
    throw Object.assign(new Error('Source returned HTML'), {
      htmlInfo: { source, redirected: response.redirected === true, signals,
        changedHost: Boolean(response.url) && new URL(response.url).host !== new URL(url).host },
    });
  }
  return body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!['GET', 'POST'].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
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
  const variant = params.get('variant') || 'full';
  if (!['full', 'simple'].includes(variant)) {
    res.statusCode = 400;
    return res.end('{"error":"Unknown variant"}');
  }
  // The router can fetch A itself when the upstream redirects cloud requests.
  // Only authenticated raw-text A uploads are accepted; callers cannot supply
  // URLs, credentials, routing rules, or environment overrides.
  const uploaded = req.method === 'POST';
  if (uploaded && (source !== 'A' ||
      !/^text\/plain(?:\s*;|$)/i.test(req.headers?.['content-type'] || '') ||
      typeof req.body !== 'string' || !req.body.trim())) {
    res.statusCode = 400;
    return res.end('{"error":"Expected an A subscription as text/plain"}');
  }
  if (uploaded && Buffer.byteLength(req.body, 'utf8') > 4_000_000) {
    res.statusCode = 413;
    return res.end('{"error":"Source too large"}');
  }
  const { MOMO_SOURCE_A, MOMO_SOURCE_B, MOMO_API_SECRET } = process.env;
  if ((!uploaded && source !== 'B' && !MOMO_SOURCE_A) ||
      (source !== 'A' && !MOMO_SOURCE_B) || !MOMO_API_SECRET) {
    res.statusCode = 503;
    return res.end('{"error":"Feed is not configured"}');
  }
  let stage = 'fetch';
  let aFormat;
  try {
    const [aText, bText] = await Promise.all([
      uploaded ? req.body : source === 'B' ? '' : fetchSubscription(MOMO_SOURCE_A, 'Clash.Meta', 'A'),
      source === 'A' ? '' : fetchSubscription(MOMO_SOURCE_B, 'sing-box', 'B'),
    ]);
    if (aText) {
      aFormat = /^\s*(?:<!doctype\s+html|<html)/i.test(aText) ? 'html' :
        /^\s*[{[]/.test(aText) ? 'json-like' :
        /^proxies\s*:/m.test(aText) ? 'clash-yaml' : 'other';
    }
    stage = 'build';
    const phone = process.env.MOMO_PHONE_MODE_ENABLED === '1' ? {
      mac: process.env.MOMO_PHONE_24G_MAC,
      ip: process.env.MOMO_PHONE_24G_IP,
      server: process.env.MOMO_RESIDENTIAL_SERVER,
      port: process.env.MOMO_RESIDENTIAL_PORT,
      username: process.env.MOMO_RESIDENTIAL_USERNAME,
      password: process.env.MOMO_RESIDENTIAL_PASSWORD,
    } : undefined;
    if (phone && process.env.MOMO_INDEPENDENT_PHONE_MODES === '1') {
      phone.independent = true;
      phone.devices = [{ id: '6T', mac: phone.mac, ip: phone.ip }];
      const oppoMac = process.env.MOMO_OPPO_MAC;
      const oppoIp = process.env.MOMO_OPPO_IP;
      if (oppoMac || oppoIp) phone.devices.push({ id: 'OPPO', mac: oppoMac, ip: oppoIp });
      if (process.env.MOMO_EXTRA_PHONES_JSON) {
        const extra = JSON.parse(process.env.MOMO_EXTRA_PHONES_JSON);
        if (!Array.isArray(extra)) throw new Error('Invalid extra phone list');
        phone.devices.push(...extra);
      }
    }
    const profile = buildProfile(
      aText,
      bText,
      MOMO_API_SECRET,
      Number(process.env.MOMO_MIN_A || 61),
      Number(process.env.MOMO_MIN_B || 118),
      source,
      process.env.MOMO_WAN_INTERFACE || 'pppoe-wan',
      phone,
    );
    res.statusCode = 200;
    return res.end(JSON.stringify(profileLabels.formatProfile(
      profileVariants.applyVariant(profile, variant, source), variant)));
  } catch (error) {
    // Never log raw errors: upstream parser messages can contain credentials.
    const safeReasons = new Set([
      'Source request failed', 'Source too large', 'Source returned HTML', 'A subscription format changed',
      'B subscription format changed', 'A DNS bootstrap server missing',
      'A node resolver policy missing', 'Unsupported A node resolver',
      'Unsupported A node resolver option', 'Node count dropped', 'Duplicate node tags',
      'Missing A server', 'Missing A password', 'Missing A port', 'Missing API secret',
    ]);
    const reason = safeReasons.has(error?.message) ? error.message :
      error?.name === 'TimeoutError' ? 'Source timeout' :
      error?.message?.startsWith('Unsupported A protocol:') ? 'Unsupported A protocol' :
      stage === 'fetch' ? 'Source transport error' : 'Configuration validation error';
    const errorType = ['Error', 'TypeError', 'SyntaxError', 'YAMLParseError', 'TimeoutError']
      .includes(error?.name) ? error.name : 'Other';
    const errorCode = ['ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE', 'MULTIPLE_DOCS', 'DUPLICATE_KEY',
      'BAD_INDENT', 'UNEXPECTED_TOKEN', 'MISSING_CHAR'].includes(error?.code) ? error.code : undefined;
    console.error(JSON.stringify({ event: 'momo_feed_failed', source, stage, reason, errorType, errorCode, aFormat,
      ...(Number.isInteger(error?.linePos?.[0]?.line) ? { parseLine: error.linePos[0].line } : {}),
      ...(Number.isInteger(error?.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
      ...(error?.htmlInfo ? { htmlInfo: error.htmlInfo } : {}),
      ...(error?.nodeCounts ? { nodeCounts: error.nodeCounts } : {}),
    }));
    res.statusCode = 502;
    return res.end('{"error":"Unable to build a complete configuration"}');
  }
}
