// Country-neutral currency helpers. A country changes its currency by setting ONE value
// (profile.currencies.default); decimals and formatting come from the ISO code via Intl, so
// USD/CAD/SAR = 2 decimals, KWD/BHD = 3, JPY = 0 — no code change needed.
// Override decimals per country with profile.currencies.minorDigits when the market uses whole
// units in practice (e.g. SYP quoted without decimals).

export function minorDigits(code, profile) {
  const o = profile?.currencies?.minorDigits
  if (Number.isInteger(o?.[code])) return o[code]
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits
  } catch {
    throw new Error(`unknown currency code '${code}'`)
  }
}

export const activeCurrency = (profile) => profile.currencies.default

// 12.5 (major units) -> 1250 minor units for a 2-decimal currency.
export const toMinor = (major, code, profile) => Math.round(Number(major) * 10 ** minorDigits(code, profile))
export const toMajor = (minor, code, profile) => minor / 10 ** minorDigits(code, profile)

// Display text, e.g. formatMoney(1250, 'SAR', 'ar-SA') -> "‏١٢٫٥٠ ر.س.‏"
export function formatMoney(minor, code, locale = 'en', profile) {
  const d = minorDigits(code, profile)
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: d, maximumFractionDigits: d }).format(toMajor(minor, code, profile))
}

// Convert between two currencies with a rate table { 'USD->SYP': 13000 } (rate per 1 major unit).
export function convertMinor(minor, from, to, rates, profile) {
  if (from === to) return minor
  const rate = rates?.[`${from}->${to}`]
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`no exchange rate ${from}->${to}`)
  return toMinor(toMajor(minor, from, profile) * rate, to, profile)
}
