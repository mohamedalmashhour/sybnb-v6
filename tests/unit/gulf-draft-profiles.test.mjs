// Gulf draft capsule profiles: complete, VAT applied as configured, prices still placeholders.
import test from 'node:test'
import assert from 'node:assert/strict'
import { capsuleProfileProblems, stays, currency, map } from '../../wrapping/index.mjs'
import { profile as ksa } from '../../countries/saudi-arabia/capsules.profile.mjs'
import { profile as uae } from '../../countries/uae/capsules.profile.mjs'
import { supportedCountries } from '../../server/lib/country.mjs'

for (const [p, vatBp, cur] of [[ksa, 1500, 'SAR'], [uae, 500, 'AED']]) {
  test(`${p.key} draft profile is complete and marked as a draft`, () => {
    assert.deepEqual(capsuleProfileProblems(p), [])
    assert.equal(p.status, 'DRAFT')
    assert.equal(p.payments.status, 'TO_BE_DECIDED')
    assert.equal(p.taxes.status, 'PENDING_ACCOUNTANT_CONFIRMATION')
    assert.ok(!supportedCountries().includes(p.key), 'drafts must not be registered as a live country')
  })
  test(`${p.key}: VAT on stay + cleaning, ${cur} with 2 decimals, map opens on the capital/hub`, () => {
    const q = stays.quoteStay({ listing: { nightlyMinor: 50000, cleaningMinor: 10000, maxGuests: 2 }, nights: 2, profile: p })
    assert.equal(q.taxMinor, Math.round(110000 * vatBp / 10000))
    assert.equal(q.currency, cur)
    assert.equal(currency.minorDigits(cur), 2)
    assert.deepEqual(map.initialView(p).center, p.map.center)
  })
}
