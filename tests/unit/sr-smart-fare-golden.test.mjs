// Golden test: the Syria ride fare (now computed by the wrapping/rides smart-fare engine with the
// Syria market settings) must equal the fares recorded from the pre-capsule engine on 2026-11-20.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.SYBNB_COUNTRY = 'syria'
delete process.env.SR_HOLIDAYS
const g = await import('../../countries/syria/geo/geocoding.mjs')
const p = await import('../../countries/syria/geo/sr-pricing.mjs')
const golden = JSON.parse(readFileSync(new URL('./fixtures/sr-fare-golden.json', import.meta.url)))
const rec = p.normalizePricing(p.recommendedConfig())

test(`Syria smart fare equals the recorded fares on ${golden.length} cases`, () => {
  for (const { opts, ...want } of golden) {
    const q = g.quoteSrRide({ ...opts, now: new Date(opts.now), pricing: opts.pricing === 'recommended' ? rec : undefined })
    const got = { fare: q.fareMinor, base: q.baseFareMinor, ring: q.ring, day: q.dayType, surge: q.surgeMultiplier, km: q.distanceKm, min: q.estimatedMinutes }
    assert.deepEqual(got, want, JSON.stringify(opts).slice(0, 160))
  }
})
