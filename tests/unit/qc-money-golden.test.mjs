// QC (Québec) pricing now runs on the wrapping/ capsules; results must equal the pre-capsule QC
// engine recorded on 2026-11-20 (375 stays + rides cases, full response shapes).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const m = await import('../../QC/server/lib/money.mjs')
const { profile } = await import('../../countries/canada/profile.mjs')
const golden = JSON.parse(readFileSync(new URL('./fixtures/qc-money-golden.json', import.meta.url)))

test(`QC money adapter equals the recorded QC engine on ${golden.length} cases`, () => {
  for (const { k, a, r } of golden) {
    const got = k === 'stay'
      ? m.stayQuote({ listing: { nightlyCents: a.nightlyCents, cleaningCents: a.cleaningCents }, nights: a.nights, profile })
      : m.rideQuote({ pickup: a.a, dropoff: a.b, category: a.category, profile, surgeBp: a.surgeBp })
    assert.deepEqual(got, r, `${k} ${JSON.stringify(a)}`)
  }
})
