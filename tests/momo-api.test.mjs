import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/momo.js';

const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(
  ['MOMO_SOURCE_A', 'MOMO_SOURCE_B', 'MOMO_API_SECRET', 'MOMO_FEED_TOKEN', 'MOMO_MIN_A', 'MOMO_MIN_B']
    .map(name => [name, process.env[name]]),
);

test('Momo feed requests only the selected source with its required UA', async () => {
  Object.assign(process.env, {
    MOMO_SOURCE_A: 'https://example.test/a',
    MOMO_SOURCE_B: 'https://example.test/b',
    MOMO_API_SECRET: 'test-secret',
    MOMO_FEED_TOKEN: 'a'.repeat(24),
    MOMO_MIN_A: '1',
    MOMO_MIN_B: '1',
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ua: options.headers['User-Agent'] });
    return {
      ok: true,
      text: async () => url.endsWith('/a')
        ? 'proxies:\n  - name: A1\n    type: anytls\n    server: a.example.test\n    port: 443\n    password: test\n'
        : JSON.stringify({ outbounds: [
          { type: 'anytls', tag: 'B1', server: 'b.example.test', server_port: 443, password: 'test' },
        ] }),
    };
  };

  try {
    for (const [source, expectedCounts, expectedCalls] of [
      ['A', [1, 0], [{ url: 'https://example.test/a', ua: 'Clash.Meta' }]],
      ['B', [0, 1], [{ url: 'https://example.test/b', ua: 'sing-box' }]],
      ['AB', [1, 1], [
        { url: 'https://example.test/a', ua: 'Clash.Meta' },
        { url: 'https://example.test/b', ua: 'sing-box' },
      ]],
    ]) {
      calls.length = 0;
      const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
      await handler({ method: 'GET', url: `/api/momo?source=${source}&key=${'a'.repeat(24)}` }, response);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, expectedCalls);
      const tags = JSON.parse(response.body).outbounds.map(outbound => outbound.tag);
      assert.deepEqual(expectedCounts, [tags.filter(tag => tag?.startsWith('A ')).length,
        tags.filter(tag => tag?.startsWith('B ')).length]);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
