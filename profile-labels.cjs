// UI names are applied after building the routing graph. Keep the same map for
// one-time migration of the dashboard's saved selections when names change.
const labels = {
  PROXY: '01 普通代理',
  'PROXY-RESIDENTIAL': '02 普通代理 · 住宅国家',
  'PROXY-RESIDENTIAL-RELAY': '03 普通代理 · 住宅中转',
  'PHONE-SELECT-6T': '04 一加 6T · 上网模式',
  'PHONE-RESIDENTIAL-6T': '05 一加 6T · 住宅国家',
  'PHONE-SELECT-OPPO': '06 OPPO A96 · 上网模式',
  'PHONE-RESIDENTIAL-OPPO': '07 OPPO A96 · 住宅国家',
  'RESIDENTIAL-RELAY': '08 两台手机 · 共用住宅中转',
  'AI-SERVICES': '09 ChatGPT 等 AI 服务',
  'PHONE-NORMAL': '正常分流（国内直连·国外代理）',
  'PHONE-RESIDENTIAL': '手机住宅出口',
  DIRECT: '直连',
};
for (const [tag, city] of Object.entries({
  'RES-DE-Berlin': '德国 · 柏林', 'RES-GB-London': '英国 · 伦敦',
  'RES-US-NewYork': '美国 · 纽约', 'RES-JP-Tokyo': '日本 · 东京',
  'RES-PH-Manila': '菲律宾 · 马尼拉',
})) {
  labels[tag] = `${city}（手机住宅）`;
  labels[`PROXY-${tag}`] = `${city}（普通住宅）`;
}
const selectorOrder = Object.keys(labels).slice(0, 9);
const labelFor = tag => labels[tag] || tag;

function formatProfile(profile) {
  const referenceKeys = new Set(['tag', 'outbound', 'outbounds', 'detour', 'default', 'final', 'download_detour']);
  const rename = (value, key) => {
    if (typeof value === 'string') return referenceKeys.has(key) ? labelFor(value) : value;
    if (Array.isArray(value)) return value.map(item => rename(item, key));
    if (value && typeof value === 'object') {
      for (const child of Object.keys(value)) value[child] = rename(value[child], child);
    }
    return value;
  };
  rename(profile);
  const order = selectorOrder.map(labelFor);
  const rank = outbound => {
    const index = order.indexOf(outbound.tag);
    return index >= 0 ? index : outbound.type === 'selector' ? 9 : 10;
  };
  profile.outbounds.sort((a, b) => rank(a) - rank(b));
  // Put special choices before the long airport list, keeping the default node.
  const ordinary = profile.outbounds.find(outbound => outbound.tag === labelFor('PROXY'));
  if (ordinary) ordinary.outbounds.sort((a, b) =>
    (a === labelFor('DIRECT') ? 0 : a === labelFor('PROXY-RESIDENTIAL') ? 1 : 2) -
    (b === labelFor('DIRECT') ? 0 : b === labelFor('PROXY-RESIDENTIAL') ? 1 : 2));
  return profile;
}

module.exports = { labels, labelFor, formatProfile };
