// Refund rules from the stays capsule (Syria profile) must equal the live Syria rule
// (server/lib/booking-policy.mjs computeCancellation) at every moment around the deadlines.
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.SYBNB_COUNTRY = 'syria'
const { computeCancellation, resolveBookingPolicy, checkInStartMs } = await import('../../server/lib/booking-policy.mjs')
const { stays } = await import('../../wrapping/index.mjs')
const { profile } = await import('../../countries/syria/capsules.profile.mjs')
const { profile: base } = await import('../../countries/syria/profile.mjs')

const policy = resolveBookingPolicy(base.bookingPolicy, {})
const checkIn = '2026-12-20T00:00:00.000Z'
const start = checkInStartMs(checkIn, policy)
const H = 3_600_000
const moments = [-200, -73, -72.0001, -72, -71.9999, -24, -0.0001, 0, 0.0001, 5, 48].map((h) => new Date(start + h * H))

test('Syria refund parity: every moment x guest/host x protection x amounts', () => {
  let n = 0
  for (const now of moments)
    for (const cancelledBy of ['GUEST', 'HOST'])
      for (const protectionPurchased of [false, true])
        for (const paidMinor of [0, 1, 999, 100_001, 330_000]) {
          const protectionMinor = protectionPurchased ? Math.round(paidMinor * 0.03) : 0
          const live = computeCancellation({ paidMinor, protectionPurchased, protectionMinor, checkIn, now, cancelledBy, policy })
          const cap = stays.cancellationRefund({ paidMinor, protectionPurchased, protectionMinor, checkIn, now, cancelledBy, profile, startMs: start })
          const ctx = JSON.stringify({ now, cancelledBy, protectionPurchased, paidMinor })
          assert.equal(cap.rule, live.rule, 'rule ' + ctx)
          assert.equal(cap.refundMinor, live.refundMinor, 'refund ' + ctx)
          assert.equal(cap.retainedProtectionMinor, live.retainedProtectionMinor, 'protection ' + ctx)
          n++
        }
  assert.ok(n === moments.length * 20)
})
