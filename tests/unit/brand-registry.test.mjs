import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { BRANDS, brand } from '../../brands/registry.mjs'
import { supportedCountries } from '../../server/lib/country.mjs'
import { capsuleProfileProblems } from '../../wrapping/index.mjs'

test('every brand is complete, its logos exist, and its country has capsule settings', async () => {
  for (const b of Object.values(BRANDS)) {
    for (const f of ['key', 'name', 'nameAr', 'country', 'status', 'webDomain', 'supportEmail', 'colors', 'logos', 'tagline']) assert.ok(b[f], `${b.key}.${f}`)
    for (const src of Object.values(b.logos)) assert.ok(existsSync(`public${src}`), `${b.key} logo ${src} missing`)
    for (const lang of ['ar', 'en', 'fr']) assert.ok(b.tagline[lang], `${b.key} tagline ${lang}`)
    const { profile } = await import(`../../countries/${b.country}/capsules.profile.mjs`)
    assert.deepEqual(capsuleProfileProblems(profile), [], b.key)
    if (b.status === 'LIVE') assert.ok(supportedCountries().includes(b.country), `${b.key} is LIVE but ${b.country} is not a live country`)
  }
})

test('unknown brand fails closed', () => {
  assert.throws(() => brand('nope'), /not registered/)
  assert.equal(brand('REZEKME').name, 'Rezekme')
})
