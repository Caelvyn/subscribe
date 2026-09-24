const YAML = require('yaml');
const crypto = require('node:crypto');
const net = require('node:net');
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
  else if (proxy.type === 'hysteria2') tls.server_name = proxy.server;
  if (proxy['client-fingerprint']) {
    tls.utls = { enabled: true, fingerprint: proxy['client-fingerprint'] };
  }
  const outbound = {
    type: proxy.type,
    tag: uniqueTag('A', proxy.name, proxy),
    server: need(proxy.server, 'A server'),
    password: need(proxy.password, 'A password'),
    tls,
  };
  if (proxy.type !== 'hysteria2' || !proxy.ports) {
    outbound.server_port = Number(need(proxy.port, 'A port'));
  }
  if (proxy.type === 'anytls' && proxy.tfo === true) outbound.tcp_fast_open = true;
  if (proxy.type === 'hysteria2' && proxy.ports) {
    outbound.server_ports = [String(proxy.ports).replace(/^(\d+)-(\d+)$/, '$1:$2')];
  }
  return outbound;
}

function bootstrapServer(dns) {
  for (const entry of dns?.nameserver || []) {
    if (typeof entry !== 'string') continue;
    if (net.isIP(entry)) return entry;
    try {
      const host = new URL(entry).hostname;
      if (net.isIP(host)) return host;
    } catch { /* Ignore unsupported nameserver syntax. */ }
  }
  throw new Error('A DNS bootstrap server missing');
}

function policyForHost(policies, host) {
  return Object.entries(policies)
    .filter(([pattern]) => {
      const suffix = pattern.replace(/^(\+\.|\*\.)/, '').toLowerCase();
      return host.toLowerCase() === suffix || host.toLowerCase().endsWith(`.${suffix}`);
    })
    .sort(([a], [b]) => b.length - a.length)[0]?.[1];
}

function buildA(clashText, wanInterface) {
  const clash = YAML.parse(clashText);
  if (!Array.isArray(clash?.proxies) ||
      !clash?.dns?.['nameserver-policy'] ||
      !Array.isArray(clash?.dns?.nameserver)) {
    throw new Error('A subscription format changed');
  }
  const bootstrapTag = 'A-DNS-bootstrap';
  const dnsServers = [{ type: 'udp', tag: bootstrapTag, server: bootstrapServer(clash.dns) }];
  const dohTags = new Map();
  const nodes = clash.proxies.map(proxy => {
    const node = convertA(proxy);
    if (net.isIP(node.server)) return node;
    const policy = policyForHost(clash.dns['nameserver-policy'], node.server);
    const entry = Array.isArray(policy) ? policy[0] : policy;
    if (typeof entry !== 'string') throw new Error('A node resolver policy missing');
    const url = new URL(entry);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Unsupported A node resolver');
    }
    const options = new URLSearchParams(url.hash.slice(1));
    if ([...options.keys()].some(key => key !== 'skip-cert-verify')) {
      throw new Error('Unsupported A node resolver option');
    }
    const resolverId = `${url.origin}${url.pathname}${url.search}${url.hash}`;
    if (!dohTags.has(resolverId)) {
      const tag = `A-DNS-${dohTags.size + 1}`;
      dohTags.set(resolverId, tag);
      dnsServers.push({
        type: 'https', tag, server: url.hostname,
        server_port: Number(url.port || 443),
        path: url.pathname + url.search,
        domain_resolver: bootstrapTag,
        bind_interface: wanInterface,
        tls: { enabled: true, server_name: url.hostname,
          insecure: options.get('skip-cert-verify') === 'true' },
      });
    }
    node.domain_resolver = dohTags.get(resolverId);
    return node;
  });
  return { nodes, dnsServers };
}

function addPhoneMode(profile, phone) {
  if (!phone || Object.values(phone).every(value => value === undefined || value === '')) return;
  const { mac, ip, server, port, username, password } = phone;
  if (![mac, ip, server, port, username, password].every(value => value !== undefined && value !== '')) {
    throw new Error('Incomplete phone residential proxy settings');
  }
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) throw new Error('Invalid phone MAC');
  if (net.isIP(ip) !== 4) throw new Error('Invalid phone IPv4 address');
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Invalid residential proxy port');
  }
  const phoneMatches = [
    { source_mac_address: [mac.toLowerCase()] },
    { source_ip_cidr: [`${ip}/32`] },
  ];
  profile.outbounds.push({
    type: 'socks', tag: 'PHONE-RESIDENTIAL', server, server_port: Number(port),
    version: '5', username, password, network: 'tcp', domain_resolver: 'dns-cn',
  });
  profile.dns.servers.push({
    type: 'https', tag: 'dns-phone-residential', server: '1.1.1.1',
    detour: 'PHONE-RESIDENTIAL',
  });
  profile.dns.rules.splice(1, 0,
    ...phoneMatches.map(match => ({ ...match, clash_mode: 'Global', action: 'route', server: 'dns-phone-residential', strategy: 'prefer_ipv4' })),
    ...phoneMatches.map(match => ({ ...match, clash_mode: 'Direct', action: 'route', server: 'dns-cn' })),
  );
  // The DNS hijack and private-LAN rules stay first. Public traffic is scoped by
  // this Wi-Fi MAC, so changing Clash mode does not change other LAN clients.
  profile.route.rules.splice(5, 0,
    ...phoneMatches.map(match => ({ ...match, clash_mode: 'Global', network: 'udp', action: 'reject' })),
    ...phoneMatches.map(match => ({ ...match, clash_mode: 'Global', action: 'route', outbound: 'PHONE-RESIDENTIAL' })),
    ...phoneMatches.map(match => ({ ...match, clash_mode: 'Direct', action: 'route', outbound: 'DIRECT' })),
  );
}

function buildProfile(aText, bText, apiSecret, minimumA = 61, minimumB = 118, source = 'AB', wanInterface = 'pppoe-wan', phone) {
  if (!['A', 'B', 'AB'].includes(source)) throw new Error('Unknown source');
  let aNodes = [];
  let aDnsServers = [];
  let bNodes = [];
  if (source !== 'B') {
    const a = buildA(aText, wanInterface);
    aNodes = a.nodes;
    aDnsServers = a.dnsServers;
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
  if (source === 'A') profile.dns.strategy = 'prefer_ipv4';
  profile.dns.servers.push(...aDnsServers);
  profile.outbounds[0].outbounds = nodeTags;
  profile.outbounds[0].default = nodeTags[0];
  profile.outbounds.push(...aNodes, ...bNodes);
  profile.experimental.clash_api.secret = need(apiSecret, 'API secret');
  addPhoneMode(profile, phone);
  return profile;
}

module.exports = { buildProfile };
