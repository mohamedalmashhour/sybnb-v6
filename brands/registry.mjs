// BRAND REGISTRY — one entry per brand ("skin") built on the one country-neutral base.
// A brand = name, domains, support email, logos, colours, tagline and the country it serves.
// The platform logic is identical for every brand; only these values (and the country profile
// selected by SYBNB_COUNTRY) change. ⚠️ Payments and prices are country settings, never brand ones.
export const BRANDS = Object.freeze({
  sybnb: {
    key: 'sybnb', name: 'SYBNB', nameAr: 'سيبنب', country: 'syria', status: 'LIVE',
    webDomain: 'sybnb.app', supportEmail: 'info@sybnb.app',
    colors: { primary: '#e5b80b', dark: '#0b0f17', accent: '#20d29b' },
    logos: { platform: '/assets/logos/sybnb-platform.png', mark: '/assets/logos/sybnb-arch-monogram.png' },
    tagline: { ar: 'منصة واحدة توفّر وقتك وتبسّط معاملاتك', en: 'One platform that saves your time', fr: 'Une seule plateforme pour gagner du temps' },
  },
  rezekme: {
    key: 'rezekme', name: 'Rezekme', nameAr: 'Rezekme', country: 'syria', status: 'LIVE',
    webDomain: 'rezekme.com', supportEmail: 'support@rezekme.com',
    apps: { stay: 'https://stay.rezekme.com', rides: 'https://rides.rezekme.com', admin: 'https://admin.rezekme.com' },
    colors: { primary: '#14261f', accent: '#e07a52', light: '#fffdf8' }, // dark green + terracotta (owner's Figma)
    logos: { platform: '/icons/icon-512.png', mark: '/icons/icon-192.png' }, // app icons; the R wordmark is drawn in-app
    tagline: { ar: 'إقامات ورحلات بثقة', en: 'Stays and rides you can trust', fr: 'Séjours et trajets en toute confiance' },
  },
  quebecbnb: {
    key: 'quebecbnb', name: 'QuebecBNB', nameAr: 'QuebecBNB', country: 'canada', status: 'DRAFT',
    webDomain: 'quebecbnb.com', supportEmail: 'info@sybnb.app',
    colors: { primary: '#1f4e9c', accent: '#d7263d', light: '#ffffff' },
    logos: { platform: '/assets/logos/sybnb-platform.png', mark: '/assets/logos/sybnb-arch-monogram.png' },
    tagline: { ar: 'إقامات ورحلات في كيبيك', en: 'Stays and rides in Québec', fr: 'Séjours et trajets au Québec' },
  },
  gulf: {
    key: 'gulf', name: 'Rezekme', nameAr: 'Rezekme', country: 'saudi-arabia', status: 'DRAFT', // name to decide
    webDomain: 'rezekme.com', supportEmail: 'support@rezekme.com',
    colors: { primary: '#14261f', accent: '#c9a227', light: '#fffdf8' },
    logos: { platform: '/icons/icon-512.png', mark: '/icons/icon-192.png' }, // app icons; the R wordmark is drawn in-app
    tagline: { ar: 'إقامات ورحلات في الخليج', en: 'Stays and rides across the Gulf', fr: 'Séjours et trajets dans le Golfe' },
  },
})

export function brand(key) {
  const b = BRANDS[String(key || '').toLowerCase()]
  if (!b) throw new Error(`brand '${key}' is not registered (brands/registry.mjs)`)
  return b
}
