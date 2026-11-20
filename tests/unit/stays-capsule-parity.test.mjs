// The stays capsule, configured with Syria's capsule profile, must give EXACTLY the live Syria
// guest total and commission (server/lib/booking-policy.mjs computeGuestTotals) for every case.
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.SYBNB_COUNTRY = 'syria'
const { computeGuestTotals } = await import('../../server/lib/booking-policy.mjs')
const { stays } = await import('../../wrapping/index.mjs')
const { profile } = await import('../../countries/syria/capsules.profile.mjs')

const cases = []
for (const stayMinor of [1, 99, 1000, 37_333, 300_000, 1_234_567])
  for (const fees of [{}, { cleaningFeeMinor: 15000 }, { taxesMinor: 777 }, { cleaningFeeMinor: 0, taxesMinor: 0 }, { cleaningFeeMinor: 5000, taxesMinor: 1200, serviceFeeMinor: 300, parkingFeeMinor: 200 }])
    for (const protection of [false, true]) cases.push({ stayMinor, fees, protection })

test(`Syria parity: capsule == live formula on ${cases.length} cases`, () => {
  for (const { stayMinor, fees, protection } of cases) {
    const live = computeGuestTotals({ stayMinor, fees, protection })
    const q = stays.quoteStay({
      listing: { nightlyMinor: 1, cleaningMinor: fees.cleaningFeeMinor, taxesMinor: fees.taxesMinor, otherFeesMinor: (fees.serviceFeeMinor || 0) + (fees.parkingFeeMinor || 0) },
      nights: 1, stayMinor, profile, protection,
    })
    const ctx = JSON.stringify({ stayMinor, fees, protection })
    assert.equal(q.totalMinor, live.totalMinor, 'total ' + ctx)
    assert.equal(q.protectionMinor, live.protectionMinor, 'protection ' + ctx)
    assert.equal(q.host.commissionMinor, live.commissionMinor, 'commission ' + ctx)
    assert.equal(q.host.payoutMinor, live.hostShareMinor, 'host share ' + ctx)
  }
})
