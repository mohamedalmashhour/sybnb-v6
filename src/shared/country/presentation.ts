// Country-neutral PUBLIC presentation resolver (MASTER, browser-safe). Fail-closed.
//
// This module and the CountryPresentationProfile type are the ONLY country data the browser bundle
// may use. It intentionally does NOT import the server profile (countries/syria/profile.mjs), which
// carries server-only policy/gates. It imports only each country's explicitly-public presentation.

// The public, client-visible presentation contract. No secrets / providers / gates / entity data.
export type CountryPresentationProfile = {
  countryCode: string
  locale: string
  fallbackLocale: string
  phoneCallingCode: string
  phonePlaceholder: string
  supportedLanguages: string[]
  displayCurrencies: string[]
  timeZone: string
  // Country name in each UI language (used in labels like "All of <country>").
  countryName: { ar: string; en: string; fr: string }
  // Full phrases (grammar differs per language/country): "All of …" and "in …".
  allCountry: { ar: string; en: string; fr: string }
  inCountry: { ar: string; en: string; fr: string }
  // Example/default places shown in the ride booking form.
  rideDefaults: { pickup: { ar: string; en: string; fr: string }; dropoff: { ar: string; en: string; fr: string } }
  // IANA zone the market operates in (reports, local day boundaries). timeZone above is display formatting.
  operatingTimeZone: string
  // Main currency shown by default (one of displayCurrencies).
  defaultCurrency: string
  // Map defaults for this country: where maps open and how far zoomed when there is no point yet.
  map: { center: { lat: number; lng: number }; zoom: number; bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } }
}

// Explicit registry — the ONLY sanctioned bridge from master browser code to a country's public
// presentation. Static import of the *public* profile only (never the server profile).
import { syriaPresentation } from '../../../countries/syria/presentation'

const PRESENTATIONS: Record<string, CountryPresentationProfile> = {
  syria: syriaPresentation,
}

const REQUIRED_FIELDS: (keyof CountryPresentationProfile)[] = [
  'countryCode', 'locale', 'fallbackLocale', 'phoneCallingCode', 'phonePlaceholder', 'supportedLanguages', 'displayCurrencies', 'timeZone', 'defaultCurrency', 'map', 'countryName', 'allCountry', 'inCountry', 'rideDefaults', 'operatingTimeZone',
]

function assertComplete(p: CountryPresentationProfile, key: string): CountryPresentationProfile {
  for (const f of REQUIRED_FIELDS) {
    const v = p[f]
    if (v == null || (Array.isArray(v) ? v.length === 0 : String(v).length === 0)) {
      throw new Error(`country presentation '${key}' is incomplete: missing '${String(f)}' (fail-closed)`)
    }
  }
  return p
}

// Resolve a country's public presentation explicitly. Fail closed on missing/unsupported/incomplete.
export function resolveCountryPresentation(country: string | undefined | null): CountryPresentationProfile {
  const key = String(country || '').trim().toLowerCase()
  if (!key) throw new Error('country presentation: no country selected (fail-closed)')
  const p = PRESENTATIONS[key]
  if (!p) throw new Error(`country presentation: country '${key}' is not supported (fail-closed)`)
  return assertComplete(p, key)
}

export function supportedPresentationCountries(): string[] {
  return Object.keys(PRESENTATIONS)
}

// The active country for the browser build. Derived from the build-time VITE_SYBNB_COUNTRY, or — in a
// single-country release — the sole registered country (registry-driven, NOT a hard-coded country).
// Fail-closed if ambiguous or unsupported.
export function activeCountryPresentation(): CountryPresentationProfile {
  const envCountry = typeof import.meta !== 'undefined' ? (import.meta as any)?.env?.VITE_SYBNB_COUNTRY : undefined
  const supported = supportedPresentationCountries()
  const key = envCountry || (supported.length === 1 ? supported[0] : undefined)
  if (!key) throw new Error('country presentation: VITE_SYBNB_COUNTRY must be set when multiple countries are supported (fail-closed)')
  return resolveCountryPresentation(key)
}

// ---- Presentation helpers (source of the previously hard-coded literals) ----

// Locale for a display language, from the active country presentation (was: lang==='ar'?'ar-SY':'en-US').
export function localeForLang(lang: string | undefined): string {
  const p = activeCountryPresentation()
  if (lang === 'ar') return p.locale
  // French UI language: French number/date formatting. Language-level (not a country value), so
  // the country profile stays the single source for currency, time zone and the Arabic locale.
  if (lang === 'fr') return 'fr'
  return p.fallbackLocale
}

// Map defaults of the active country (centre + zoom used before any real point is known).
export function countryMapCenter(): { lat: number; lng: number } {
  return activeCountryPresentation().map.center
}
export function countryMapZoom(): number {
  return activeCountryPresentation().map.zoom
}
// Every currency the active country displays/accepts (Syria: SYP + USD).
export function countryCurrencies(): string[] {
  return [...activeCountryPresentation().displayCurrencies]
}
export function defaultDisplayCurrency(): string {
  return activeCountryPresentation().defaultCurrency
}

// Country name for a UI language (ar / fr / en fallback).
export function countryNameText(lang: string | undefined): string {
  const n = activeCountryPresentation().countryName
  return lang === 'ar' ? n.ar : lang === 'fr' ? n.fr : n.en
}
export function countryPhrase(which: 'allCountry' | 'inCountry', lang: string | undefined): string {
  const n = activeCountryPresentation()[which]
  return lang === 'ar' ? n.ar : lang === 'fr' ? n.fr : n.en
}
export function rideDefaultPlace(which: 'pickup' | 'dropoff', lang: string | undefined): string {
  const d = activeCountryPresentation().rideDefaults[which]
  return lang === 'ar' ? d.ar : lang === 'fr' ? d.fr : d.en
}

export function countryOperatingTimeZone(): string {
  return activeCountryPresentation().operatingTimeZone
}

export function phoneCallingCode(): string {
  return activeCountryPresentation().phoneCallingCode
}

export function phonePlaceholder(): string {
  return activeCountryPresentation().phonePlaceholder
}
