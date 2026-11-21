// Québec stays: lodging tax and GST/QST are government money, each in its own account, and never
// part of the host payout. Syria has no such taxes, so its quotes carry no governmentCharges.
import test from 'node:test'
import assert from 'node:assert/strict'
import { quoteStay } from '../../wrapping/stays/index.mjs'
import { profile as canada } from '../../countries/canada/capsules.profile.mjs'
import { profile as syria } from '../../countries/syria/capsules.profile.mjs'

test('canada stay quote splits government money by account', () => {
  const q = quoteStay({ listing: { nightlyMinor: 15000 }, nights: 2, profile: canada })
  const gc = q.governmentCharges
  assert.ok(gc)
  assert.deepEqual(gc.taxes.map((t) => [t.code, t.account]), [['LODGING', 'LODGING_TAX'], ['GST', 'GST_QST'], ['QST', 'GST_QST']])
  assert.equal(gc.totalMinor, q.taxMinor)
  assert.equal(q.host.payoutMinor, 30000 - 900)
  assert.equal(q.host.payoutMinor + q.host.commissionMinor + q.serviceFeeMinor + gc.totalMinor, q.totalMinor)
})

test('syria stay quote has no government charges', () => {
  const q = quoteStay({ listing: { nightlyMinor: 100 }, nights: 2, profile: syria })
  assert.equal(q.governmentCharges, undefined)
})
