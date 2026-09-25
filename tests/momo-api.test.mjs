import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/momo.js';
import profileBuilder from '../build-profile.cjs';

const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(
  ['MOMO_SOURCE_A', 'MOMO_SOURCE_B', 'MOMO_API_SECRET', 'MOMO_FEED_TOKEN', 'MOMO_MIN_A', 'MOMO_MIN_B', 'MOMO_WAN_INTERFACE',
    'MOMO_PHONE_MODE_ENABLED', 'MOMO_PHONE_24G_MAC', 'MOMO_PHONE_24G_IP', 'MOMO_RESIDENTIAL_SERVER', 'MOMO_RESIDENTIAL_PORT',
    'MOMO_RESIDENTIAL_USERNAME', 'MOMO_RESIDENTIAL_PASSWORD', 'MOMO_INDEPENDENT_PHONE_MODES',
    'MOMO_OPPO_MAC', 'MOMO_OPPO_IP', 'MOMO_EXTRA_PHONES_JSON']
    .map(name => [name, process.env[name]]),
);

test('Momo feed requests only the selected source with its required UA', async () => {
  Object.assign(process.env, {
    MOMO_SOURCE_A: 'https://example.test/a',
    MOMO_SOURCE_B: 'https://example.test/b',
    MOMO_API_SECRET: 'test-secret',
    MOMO_FEED_TOKEN: 'a'.repeat(24),
    MOMO_MIN_A: '2',
    MOMO_MIN_B: '1',
    MOMO_WAN_INTERFACE: 'pppoe-wan',
    MOMO_PHONE_MODE_ENABLED: '0',
    MOMO_PHONE_24G_MAC: '02:00:00:00:00:24',
    MOMO_PHONE_24G_IP: '192.168.1.231',
    MOMO_RESIDENTIAL_SERVER: 'proxy.example.test',
    MOMO_RESIDENTIAL_PORT: '7777',
    MOMO_RESIDENTIAL_USERNAME: 'test-user',
    MOMO_RESIDENTIAL_PASSWORD: 'test-password',
    MOMO_INDEPENDENT_PHONE_MODES: '0',
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ua: options.headers['User-Agent'] });
    return {
      ok: true,
      text: async () => url.endsWith('/a') && options.headers['User-Agent'] === 'Clash.Meta'
        ? 'dns:\n  nameserver:\n    - https://192.0.2.53/dns-query\n  nameserver-policy:\n    "+.example.test":\n      - https://resolver.example.test:2096/query#skip-cert-verify=true\nproxies:\n  - name: A1\n    type: anytls\n    server: a.example.test\n    port: 443\n    password: test\n    sni: a.example.test\n  - name: A2\n    type: hysteria2\n    server: h.example.test\n    port: 4000\n    ports: 4000-4010\n    password: test2\n'
        : JSON.stringify({ outbounds: [
          { type: 'anytls', tag: 'B1', server: 'b.example.test', server_port: 443, password: 'test' },
        ] }),
    };
  };

  try {
    for (const [source, expectedCounts, expectedCalls] of [
      ['A', [2, 0], [{ url: 'https://example.test/a', ua: 'Clash.Meta' }]],
      ['B', [0, 1], [{ url: 'https://example.test/b', ua: 'sing-box' }]],
      ['AB', [2, 1], [
        { url: 'https://example.test/a', ua: 'Clash.Meta' },
        { url: 'https://example.test/b', ua: 'sing-box' },
      ]],
    ]) {
      calls.length = 0;
      const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
      await handler({ method: 'GET', url: `/api/momo?source=${source}&key=${'a'.repeat(24)}` }, response);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, expectedCalls);
      const profile = JSON.parse(response.body);
      const tags = profile.outbounds.map(outbound => outbound.tag);
      assert.ok(!tags.includes('PHONE-RESIDENTIAL'));
      assert.deepEqual(expectedCounts, [tags.filter(tag => tag?.startsWith('A ')).length,
        tags.filter(tag => tag?.startsWith('B ')).length]);
      assert.equal(profile.dns.strategy, source === 'A' ? 'prefer_ipv4' : 'ipv4_only');
      if (source !== 'B') {
        const node = profile.outbounds.find(outbound => outbound.tag?.startsWith('A '));
        const resolver = profile.dns.servers.find(server => server.tag === node.domain_resolver);
        assert.equal(resolver.type, 'https');
        assert.equal(resolver.server_port, 2096);
        assert.equal(resolver.server, 'resolver.example.test');
        assert.equal(resolver.bind_interface, 'pppoe-wan');
        assert.equal(resolver.tls.insecure, true);
        assert.equal(profile.dns.servers.find(server => server.tag === resolver.domain_resolver).type, 'udp');
        assert.equal(node.tls.server_name, 'a.example.test');
        const hy2 = profile.outbounds.find(outbound => outbound.type === 'hysteria2');
        assert.equal(hy2.domain_resolver, node.domain_resolver);
        assert.deepEqual(hy2.server_ports, ['4000:4010']);
        assert.equal(hy2.server_port, undefined);
        assert.equal(hy2.tls.server_name, 'h.example.test');
      }
    }
    process.env.MOMO_PHONE_MODE_ENABLED = '1';
    const enabledResponse = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await handler({ method: 'GET', url: `/api/momo?source=B&key=${'a'.repeat(24)}` }, enabledResponse);
    assert.equal(enabledResponse.statusCode, 200);
    assert.ok(JSON.parse(enabledResponse.body).outbounds.some(outbound => outbound.tag === 'PHONE-RESIDENTIAL'));
    process.env.MOMO_INDEPENDENT_PHONE_MODES = '1';
    process.env.MOMO_OPPO_MAC = '02:00:00:00:00:25';
    process.env.MOMO_OPPO_IP = '192.168.1.232';
    const independentResponse = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await handler({ method: 'GET', url: `/api/momo?source=B&key=${'a'.repeat(24)}` }, independentResponse);
    assert.equal(independentResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(independentResponse.body).outbounds
      .filter(outbound => outbound.tag?.startsWith('PHONE-SELECT-')).map(outbound => outbound.tag),
    ['PHONE-SELECT-6T', 'PHONE-SELECT-OPPO']);
    process.env.MOMO_EXTRA_PHONES_JSON = JSON.stringify([
      { id: 'OTHER', mac: '02:00:00:00:00:26', ip: '192.168.1.233' },
    ]);
    const extraResponse = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await handler({ method: 'GET', url: `/api/momo?source=B&key=${'a'.repeat(24)}` }, extraResponse);
    assert.equal(extraResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(extraResponse.body).outbounds
      .filter(outbound => outbound.tag?.startsWith('PHONE-SELECT-')).map(outbound => outbound.tag),
    ['PHONE-SELECT-6T', 'PHONE-SELECT-OPPO', 'PHONE-SELECT-OTHER']);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('phone modes scope residential and direct routing to the 2.4G MAC', () => {
  const profile = profileBuilder.buildProfile('', JSON.stringify({ outbounds: [
    { type: 'anytls', tag: 'B1', server: 'b.example.test', server_port: 443, password: 'test' },
  ] }), 'api-secret', 0, 1, 'B', 'pppoe-wan', {
    mac: '02:00:00:00:00:24', ip: '192.168.1.231', server: 'proxy.example.test', port: '7777',
    username: 'test-user', password: 'test-password',
  });
  assert.deepEqual(profile.outbounds.find(outbound => outbound.tag === 'PHONE-RESIDENTIAL'), {
    type: 'socks', tag: 'PHONE-RESIDENTIAL', server: 'proxy.example.test',
    server_port: 7777, version: '5', username: 'test-user', password: 'test-password',
    network: 'tcp', domain_resolver: 'dns-cn',
  });
  const phoneRules = profile.route.rules.filter(rule => rule.source_mac_address);
  assert.deepEqual(phoneRules.map(rule => [rule.clash_mode, rule.network, rule.action, rule.outbound]), [
    ['Global', 'udp', 'reject', undefined],
    ['Global', undefined, 'route', 'PHONE-RESIDENTIAL'],
    ['Direct', undefined, 'route', 'DIRECT'],
  ]);
  assert.ok(phoneRules.every(rule => rule.source_mac_address[0] === '02:00:00:00:00:24'));
  const phoneIpRules = profile.route.rules.filter(rule => rule.source_ip_cidr?.includes('192.168.1.231/32'));
  assert.deepEqual(phoneIpRules.map(rule => [rule.clash_mode, rule.network, rule.action, rule.outbound]), [
    ['Global', 'udp', 'reject', undefined],
    ['Global', undefined, 'route', 'PHONE-RESIDENTIAL'],
    ['Direct', undefined, 'route', 'DIRECT'],
  ]);
  assert.ok(profile.route.rules.indexOf(phoneRules[0]) <
    profile.route.rules.findIndex(rule => rule.rule_set === 'ads'));
  const phoneDnsRules = profile.dns.rules.filter(rule => rule.source_mac_address);
  assert.deepEqual(phoneDnsRules.map(rule => [rule.clash_mode, rule.server]), [
    ['Global', 'dns-phone-residential'], ['Direct', 'dns-cn'],
  ]);
  assert.equal(phoneDnsRules[0].strategy, 'prefer_ipv4');
  assert.deepEqual(profile.dns.rules.filter(rule => rule.source_ip_cidr?.includes('192.168.1.231/32'))
    .map(rule => [rule.clash_mode, rule.server]), [
      ['Global', 'dns-phone-residential'], ['Direct', 'dns-cn'],
    ]);
  assert.equal(profile.dns.servers.find(server => server.tag === 'dns-phone-residential').detour,
    'PHONE-RESIDENTIAL');
});

test('independent phone selectors retain normal split and isolate both devices', () => {
  const profile = profileBuilder.buildProfile('', JSON.stringify({ outbounds: [
    { type: 'anytls', tag: 'B1', server: 'b.example.test', server_port: 443, password: 'test' },
  ] }), 'api-secret', 0, 1, 'B', 'pppoe-wan', {
    independent: true, server: 'proxy.example.test', port: '7777',
    username: 'test-user', password: 'test-password',
    devices: [
      { id: '6T', mac: '02:00:00:00:00:24', ip: '192.168.1.231' },
      { id: 'OPPO', mac: '02:00:00:00:00:25', ip: '192.168.1.232' },
    ],
  });
  const selectors = profile.outbounds.filter(outbound => outbound.tag?.startsWith('PHONE-SELECT-'));
  assert.deepEqual(selectors.map(outbound => outbound.tag), ['PHONE-SELECT-6T', 'PHONE-SELECT-OPPO']);
  assert.ok(selectors.every(outbound => outbound.default === 'PHONE-NORMAL' &&
    outbound.interrupt_exist_connections === true &&
    JSON.stringify(outbound.outbounds) === JSON.stringify(['PHONE-NORMAL', 'PHONE-RESIDENTIAL', 'DIRECT'])));
  assert.deepEqual(profile.inbounds.find(inbound => inbound.tag === 'phone-normal-in'),
    { type: 'socks', tag: 'phone-normal-in', listen: '127.0.0.1', listen_port: 10556 });
  assert.deepEqual(profile.outbounds.find(outbound => outbound.tag === 'PHONE-NORMAL'),
    { type: 'socks', tag: 'PHONE-NORMAL', server: '127.0.0.1', server_port: 10556, version: '5' });
  const phoneRoutes = profile.route.rules.filter(rule => rule.outbound?.startsWith('PHONE-SELECT-'));
  assert.deepEqual(phoneRoutes.map(rule => rule.outbound),
    ['PHONE-SELECT-6T', 'PHONE-SELECT-6T', 'PHONE-SELECT-OPPO', 'PHONE-SELECT-OPPO']);
  assert.ok(profile.route.rules.indexOf(phoneRoutes[0]) <
    profile.route.rules.findIndex(rule => rule.rule_set === 'ads'));
  assert.equal(profile.route.final, 'PROXY');
  const oppoDns = profile.dns.rules.filter(rule => rule.server?.startsWith('dns-phone-OPPO-'));
  assert.deepEqual(oppoDns.map(rule => rule.server),
    ['dns-phone-OPPO-cn', 'dns-phone-OPPO-global', 'dns-phone-OPPO-cn', 'dns-phone-OPPO-global']);
  assert.ok(oppoDns.every(rule => rule.source_mac_address?.[0] === '02:00:00:00:00:25' ||
    rule.source_ip_cidr?.[0] === '192.168.1.232/32'));
  assert.equal(profile.dns.servers.find(server => server.tag === 'dns-phone-OPPO-global').detour,
    'PHONE-SELECT-OPPO');
});
