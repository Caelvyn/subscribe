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
  // Keep selections independent when switching airport or layout.
  profile.experimental.cache_file.cache_id = `momo-${source.toLowerCase()}-${variant}`;
  return profile;
}

module.exports = { applyVariant };
