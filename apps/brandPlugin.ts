import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
// @ts-ignore -- plain ESM registry shared with server/tests
import { brand as lookupBrand } from '../brands/registry.mjs'

const PLATFORM_SRC = resolve(__dirname, '../src')
const BRAND_DIR = resolve(__dirname, '../src/shared/brand')

// Generic brand skin for any brand in brands/registry.mjs. The platform source carries 'SYBNB' in
// user-facing strings; for another brand, rename the brand word at compile time — whole word only
// (codes such as SYBNB_COUNTRY, 'SYBNB-BANK-ADV' and an exact 'SYBNB' literal are left alone), and
// rebrand the static pages copied from public/. The SYBNB brand itself is a no-op.
export function brandSkin(brandKey: string): Plugin {
  const b = lookupBrand(brandKey)
  const platformBrand = lookupBrand('sybnb')
  const isPlatform = b.key === 'sybnb'
  return {
    name: `brand-skin-${b.key}`,
    enforce: 'pre',
    transform(code, id) {
      if (isPlatform) return null
      const file = id.split('?')[0]
      if (!file.startsWith(PLATFORM_SRC) || file.startsWith(BRAND_DIR) || !/\.(tsx?|jsx?)$/.test(file)) return null
      if (!code.includes('SYBNB') && !code.includes(platformBrand.nameAr)) return null
      const out = code
        .replace(/SYBNB/g, (match, offset: number, all: string) => {
          const before = all[offset - 1] || ''
          const after = all[offset + match.length] || ''
          if (/[A-Za-z0-9_\-]/.test(before) || /[A-Za-z0-9_\-]/.test(after)) return match
          if (/['"`]/.test(before) && before === after) return match
          return b.name
        })
        .replaceAll(platformBrand.nameAr, b.nameAr)
      return { code: out, map: null }
    },
    writeBundle(options) {
      if (isPlatform || !options.dir) return
      for (const name of ['privacy.html', 'landing.html', 'admin.html']) {
        const file = resolve(options.dir, name)
        if (!existsSync(file)) continue
        const html = readFileSync(file, 'utf8')
        const out = html
          .replace(/SYBNB(?![_-])/g, b.name)
          .replaceAll(platformBrand.nameAr, b.nameAr)
          .replaceAll(platformBrand.supportEmail, b.supportEmail)
          .replace(/https?:\/\/(www\.)?sybnb\.app/g, `https://${b.webDomain}`)
        if (out !== html) writeFileSync(file, out)
      }
    },
  }
}

// Vite `define` values for a brand build.
export function brandDefines(brandKey: string) {
  const b = lookupBrand(brandKey)
  return {
    'import.meta.env.VITE_BRAND_NAME': JSON.stringify(b.name),
    'import.meta.env.VITE_BRAND_KEY': JSON.stringify(b.key),
    'import.meta.env.VITE_SYBNB_COUNTRY': JSON.stringify(b.country),
  }
}
