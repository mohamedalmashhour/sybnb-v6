// The live money constants now come from the country's capsule profile. For Syria they must equal
// the values the platform used before the change (no behaviour change).
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.SYBNB_COUNTRY = 'syria'
delete process.env.SR_RIDE_COMMISSION_RATE
const policy = await import('../../server/lib/booking-policy.mjs')
const { capsuleProfile } = await import('../../server/lib/capsule-profile.mjs')

test('Syria values unchanged after wiring to capsule profile', () => {
  assert.equal(policy.STR_COMMISSION_RATE, 0.15)
  assert.equal(policy.SR_RIDE_COMMISSION_RATE, 0.2)
  const p = capsuleProfile()
  assert.equal(p.stays.payoutHoldDays, 14)
  assert.equal(p.rides.cancellation.feePercent, 15)
  assert.equal(p.rides.cancellation.graceSeconds, 120)
})

test('capsule profile follows SYBNB_COUNTRY and is null when unset', () => {
  assert.equal(capsuleProfile({ SYBNB_COUNTRY: 'canada' }).key, 'canada')
  assert.equal(capsuleProfile({}), null)
})
