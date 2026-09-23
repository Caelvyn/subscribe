const YAML = require('yaml');
const crypto = require('node:crypto');
const template = require('./profile-template.json');

function need(value, label) {
  if (value === undefined || value === null || value === '') throw new Error(`Missing ${label}`);
  return value;
}

function uniqueTag(prefix, name, node) {
  const identity = [node.type, node.server, node.server_port ?? node.port, node.password, name];
  const id = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 10);
  return `${prefix} ${String(name || 'node').trim()} [${id}]`;
}

function convertA(proxy) {
  if (!['anytls', 'hysteria2'].includes(proxy.type)) {
    throw new Error(`Unsupported A protocol: ${proxy.type}`);
  }
  const tls = { enabled: true, insecure: proxy['skip-cert-verify'] === true };
  if (proxy.sni) tls.server_name = proxy.sni;
  if (proxy['client-fingerprint']) {
    tls.utls = { enabled: true, fingerprint: proxy['client-fingerprint'] };
  }
  const outbound = {
    type: proxy.type,
    tag: uniqueTag('A', proxy.name, proxy),
    server: need(proxy.server, 'A server'),
    server_port: Number(need(proxy.port, 'A port')),
    password: need(proxy.password, 'A password'),
    tls,
  };
  if (proxy.type === 'anytls' && proxy.tfo === true) outbound.tcp_fast_open = true;
  if (proxy.type === 'hysteria2' && proxy.ports) {
    outbound.server_ports = [String(proxy.ports).replace(/^(\d+)-(\d+)$/, '$1:$2')];
  }
  return outbound;
}

function buildProfile(aText, bText, apiSecret, minimumA = 61, minimumB = 118, source = 'AB') {
  if (!['A', 'B', 'AB'].includes(source)) throw new Error('Unknown source');
  let aNodes = [];
  let bNodes = [];
  if (source !== 'B') {
    const sourceA = YAML.parse(aText);
    if (!Array.isArray(sourceA?.proxies)) throw new Error('A subscription format changed');
    aNodes = sourceA.proxies.map(convertA);
  }
  if (source !== 'A') {
    const sourceB = JSON.parse(bText);
    if (!Array.isArray(sourceB?.outbounds)) throw new Error('B subscription format changed');
    bNodes = sourceB.outbounds
      .filter(outbound => ['anytls', 'hysteria2', 'tuic'].includes(outbound.type))
      .map(outbound => ({ ...outbound, tag: uniqueTag('B', outbound.tag, outbound) }));
  }
  if ((source !== 'B' && aNodes.length < minimumA) ||
      (source !== 'A' && bNodes.length < minimumB)) {
    throw new Error('Node count dropped');
  }
  const nodeTags = [...aNodes, ...bNodes].map(outbound => outbound.tag);
  if (new Set(nodeTags).size !== nodeTags.length) throw new Error('Duplicate node tags');

  const profile = structuredClone(template);
  profile.outbounds[0].outbounds = nodeTags;
  profile.outbounds[0].default = nodeTags[0];
  profile.outbounds.push(...aNodes, ...bNodes);
  profile.experimental.clash_api.secret = need(apiSecret, 'API secret');
  return profile;
}

module.exports = { buildProfile };
