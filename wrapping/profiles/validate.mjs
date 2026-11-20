// Fail-closed check that a country profile has everything the capsules need.
export function capsuleProfileProblems(p, { stays = true, rides = true } = {}) {
  const out = []
  const need = (cond, msg) => { if (!cond) out.push(msg) }
  need(p?.key, 'missing key')
  need(p?.currencies?.default && p.currencies.allowed?.includes(p.currencies.default), 'default currency must be in allowed list')
  need(p?.timezone, 'missing timezone')
  const taxCodes = Object.keys(p?.taxes ?? {}).filter((k) => k !== 'status')
  const known = (list, where) => (list ?? []).forEach((k) => need(taxCodes.includes(k), `${where} uses unknown tax '${k}'`))
  if (stays) {
    const s = p?.stays
    need(s, 'missing stays section')
    if (s) {
      need(s.cancellationPolicies?.[s.defaultPolicy], 'stays.defaultPolicy must name a defined cancellation policy')
      known(s.lodgingTaxes, 'stays.lodgingTaxes'); known(s.salesTaxes, 'stays.salesTaxes')
    }
  }
  if (rides) {
    const r = p?.rides
    need(r && Object.keys(r.categories ?? {}).length, 'rides needs at least one category')
    if (r) {
      for (const [k, c] of Object.entries(r.categories ?? {})) {
        for (const f of ['baseMinor', 'perKmMinor', 'perMinMinor', 'minimumMinor']) need(Number.isInteger(c[f]) && c[f] >= 0, `rides.categories.${k}.${f} must be a non-negative integer`)
      }
      known(r.taxes, 'rides.taxes')
    }
  }
  return out
}
