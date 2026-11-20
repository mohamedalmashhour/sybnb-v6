// Country-neutral money helpers. Every amount is an integer in the currency's minor unit
// (cents, halalas, fils…). Rates are basis points (1 bp = 0.01%). Each line rounds half-up once
// and totals are sums of rounded lines, so receipts always add up.

export const pct = (minor, bp) => Math.round((minor * bp) / 10_000)

export function assertMinor(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer (minor units)`)
  return value
}

// Tax lines for `base` using the tax codes listed in `keys`, looked up in the profile's tax table.
// A country with no taxes simply lists none.
export function taxLines(base, keys = [], taxes = {}) {
  return keys.map((key) => {
    const t = taxes[key]
    if (!t) throw new Error(`tax '${key}' is not defined in the country profile`)
    return { code: key, label: t.label, rateBp: t.bp, baseMinor: base, minor: pct(base, t.bp) }
  })
}

export const sum = (lines) => lines.reduce((s, l) => s + l.minor, 0)
