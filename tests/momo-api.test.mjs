import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/momo.js';

const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(
  ['MOMO_SOURCE_A', 'MOMO_SOURCE_B', 'MOMO_API_SECRET', 'MOMO_FEED_TOKEN', 'MOMO_MIN_A', 'MOMO_MIN_B', 'MOMO_WAN_INTERFACE']
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
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
