function applyVariant(profile, variant = 'full', source = 'AB') {
  if (!['full', 'simple'].includes(variant)) throw new Error('Unknown variant');
  const countries = profile.outbounds.filter(node =>
    node.type === 'selector' && node.tag.startsWith('PHONE-RESIDENTIAL-'));
  const sharedRelay = profile.outbounds.find(node => node.tag === 'RESIDENTIAL-RELAY');
  const oldCityTags = new Set(countries.flatMap(node => node.outbounds));
  const byTag = new Map(profile.outbounds.map(node => [node.tag, node]));
  const removed = new Set();

  if (countries.length) {
    removed.add('RESIDENTIAL-RELAY');
    for (const tag of oldCityTags) removed.add(tag);
    for (const country of countries) {
      const id = country.tag.slice('PHONE-RESIDENTIAL-'.length);
      if (variant === 'full') {
        const relayTag = `PHONE-RELAY-${id}`;
        profile.outbounds.push({ ...structuredClone(sharedRelay), tag: relayTag });
        for (const tag of country.outbounds) {
          profile.outbounds.push({ ...structuredClone(byTag.get(tag)),
            tag: `${id}-${tag}`, detour: relayTag });
        }
        country.outbounds = country.outbounds.map(tag => `${id}-${tag}`);
        country.default = `${id}-${country.default}`;
      } else {
        removed.add(country.tag);
        const phone = byTag.get(`PHONE-SELECT-${id}`);
        phone.outbounds = phone.outbounds.map(tag => tag === country.tag ? 'PROXY-RESIDENTIAL' : tag);
        if (phone.default === country.tag) phone.default = 'PROXY-RESIDENTIAL';
      }
    }
  }
  profile.outbounds = profile.outbounds.filter(node => !removed.has(node.tag));
  // Claude is a fixed Germany exception, not another user-selectable group.
  // Place it before device mode/country routing, including their DIRECT option.
  const germany = 'PROXY-RES-DE-Berlin';
  if (profile.outbounds.some(node => node.tag === germany)) {
    const domains = ['claude.ai', 'claude.com', 'anthropic.com', 'claudeusercontent.com'];
    const matches = [];
    if (variant === 'full') {
      for (const country of countries) {
        const id = country.tag.slice('PHONE-RESIDENTIAL-'.length);
        const phoneRule = profile.route.rules.find(rule => rule.outbound === `PHONE-SELECT-${id}`);
        matches.push({ match: { source_mac_address: [...phoneRule.source_mac_address] },
          outbound: `${id}-RES-DE-Berlin`, dns: `dns-claude-${id}` });
      }
    }
    matches.push({ match: {}, outbound: germany, dns: 'dns-claude-de' });
    profile.route.rules.splice(3, 0,
      { domain_suffix: domains, network: 'udp', action: 'reject' },
      ...matches.map(({ match, outbound }) => ({ ...match, domain_suffix: domains, action: 'route', outbound })),
    );
    profile.dns.servers.push(...matches.map(({ outbound, dns }) => ({
      type: 'https', tag: dns, server: '1.1.1.1', detour: outbound,
    })));
    profile.dns.rules.unshift(...matches.map(({ match, dns }) => ({
      ...match, domain_suffix: domains, action: 'route', server: dns, strategy: 'prefer_ipv4',
    })));
  }
  // Keep selections independent when switching airport or layout.
  profile.experimental.cache_file.cache_id = `momo-${source.toLowerCase()}-${variant}`;
  return profile;
}

module.exports = { applyVariant };
