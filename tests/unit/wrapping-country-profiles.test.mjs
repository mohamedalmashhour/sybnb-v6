import test from 'node:test'
import assert from 'node:assert/strict'
import { capsuleProfileProblems, stays, rides } from '../../wrapping/index.mjs'
import { profile as syria } from '../../countries/syria/capsules.profile.mjs'
import { profile as canada } from '../../countries/canada/capsules.profile.mjs'

for (const [name, p] of [['syria', syria], ['canada', canada]]) {
  test(`${name} capsule profile is complete and quotes add up`, () => {
    assert.deepEqual(capsuleProfileProblems(p), [])
    const q = stays.quoteStay({ listing: { nightlyMinor: 5000, cleaningMinor: 1000, maxGuests: 2 }, nights: 3, profile: p })
    assert.equal(q.lines.reduce((s, l) => s + l.minor, 0) + q.taxMinor, q.totalMinor)
    const cats = Object.keys(p.rides.categories)
    const b = p.rides.serviceBounds
    const a = { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 }
    const r = rides.quoteRide({ pickup: a, dropoff: { lat: a.lat + 0.05, lng: a.lng }, category: cats[0], profile: p })
    assert.ok(r.totalMinor > 0)
  })
}

test('syria matches live values: 15% host commission, 72h full refund then 50%, 20% ride commission', () => {
  assert.equal(syria.stays.hostCommissionBp, 1500)
  assert.equal(syria.stays.payoutHoldDays, 14)
  assert.deepEqual(syria.stays.cancellationPolicies.standard.map((t) => t.refundBp), [10000, 5000])
  assert.equal(syria.rides.driverCommissionBp, 2000)
  assert.equal(syria.rides.categories['SR Economy'].minimumMinor, 400)
})

test('canada carries GST/QST on stay + fee and lodging tax on the stay', () => {
  assert.deepEqual(canada.stays.lodgingTaxes, ['LODGING'])
  assert.deepEqual(canada.stays.salesTaxes, ['GST', 'QST'])
  assert.equal(canada.taxes.status, 'PENDING_ACCOUNTANT_CONFIRMATION')
})
