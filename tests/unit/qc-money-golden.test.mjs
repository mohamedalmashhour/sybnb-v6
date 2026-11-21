// QC (Québec) pricing now runs on the wrapping/ capsules; results must equal the pre-capsule QC
// engine recorded on 2026-11-20 (375 stays + rides cases, full response shapes).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const m = await import('../../QC/server/lib/money.mjs')
const { profile } = await import('../../countries/canada/profile.mjs')
const golden = JSON.parse(readFileSync(new URL('./fixtures/qc-money-golden.json', import.meta.url)))

// The golden cases predate the Québec per-trip levy (owner 2026-11-21), so they run with it off;
// the levy and ride options are checked separately below.
const noLevy = { ...profile, rides: { ...profile.rides, regulatoryFee: undefined } }

test(`QC money adapter equals the recorded QC engine on ${golden.length} cases`, () => {
  for (const { k, a, r } of golden) {
    const got = k === 'stay'
      ? m.stayQuote({ listing: { nightlyCents: a.nightlyCents, cleaningCents: a.cleaningCents }, nights: a.nights, profile: noLevy })
      : m.rideQuote({ pickup: a.a, dropoff: a.b, category: a.category, profile: noLevy, surgeBp: a.surgeBp })
    if (k !== 'stay') { delete got.breakdown.options; delete got.breakdown.governmentCents }
    assert.deepEqual(got, r, `${k} ${JSON.stringify(a)}`)
  }
})

test('Québec levy is added untaxed per trip; pet fee is taxed and paid to the driver', () => {
  const args = { pickup: { lat: 45.52, lng: -73.58 }, dropoff: { lat: 45.47, lng: -73.74 }, category: 'STANDARD' }
  const base = m.rideQuote({ ...args, profile: noLevy })
  const levy = m.rideQuote({ ...args, profile })
  assert.equal(levy.totalCents - base.totalCents, profile.rides.regulatoryFee.cents)
  assert.equal(levy.breakdown.taxCents, base.breakdown.taxCents)
  assert.equal(levy.breakdown.governmentCents, profile.rides.regulatoryFee.cents)
  assert.equal(levy.breakdown.driver.payoutCents, base.breakdown.driver.payoutCents)
  const pet = m.rideQuote({ ...args, profile: noLevy, options: { pet: true } })
  assert.equal(pet.breakdown.lines.find((l) => l.code === 'PET_FEE').cents, profile.rides.options.petFeeCents)
  assert.ok(pet.breakdown.taxCents > base.breakdown.taxCents)
  assert.equal(pet.breakdown.driver.payoutCents - base.breakdown.driver.payoutCents, profile.rides.options.petFeeCents)
})
