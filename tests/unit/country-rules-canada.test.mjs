// One-base step 1: country rules read from the capsule settings. Syria unchanged; Canada gets a
// 30-minute payment hold, Québec-time check-in midnight (daylight saving) and a required
// registration number on stays.
import test from 'node:test'
import assert from 'node:assert/strict'
import { bookingPolicySettings } from '../../server/lib/country.mjs'
import { checkInStartMs, computeCancellation } from '../../server/lib/booking-policy.mjs'
import { capsuleProfile } from '../../server/lib/capsule-profile.mjs'

test('Syria booking policy is unchanged', () => {
  assert.deepEqual(bookingPolicySettings({ SYBNB_COUNTRY: 'syria' }), { timezoneOffsetMinutes: 180, fullRefundCutoffHours: 72, unpaidExpiryHours: 48 })
})

test('Canada: 30-minute hold and Québec-time midnight across daylight saving', () => {
  const p = bookingPolicySettings({ SYBNB_COUNTRY: 'canada' })
  assert.equal(p.unpaidExpiryHours, 0.5)
  assert.equal(p.timezone, 'America/Toronto')
  assert.equal(new Date(checkInStartMs('2026-07-15T00:00:00Z', p)).toISOString(), '2026-07-15T04:00:00.000Z')
  assert.equal(new Date(checkInStartMs('2026-12-15T00:00:00Z', p)).toISOString(), '2026-12-15T05:00:00.000Z')
  // 72 h before check-in 00:00 (Québec time) is still a full refund, a minute later is not
  const start = checkInStartMs('2026-12-15T00:00:00Z', p)
  assert.equal(computeCancellation({ paidMinor: 1000, checkIn: '2026-12-15T00:00:00Z', now: new Date(start - 72 * 3600e3), policy: p }).rule, 'FULL')
  assert.equal(computeCancellation({ paidMinor: 1000, checkIn: '2026-12-15T00:00:00Z', now: new Date(start - 72 * 3600e3 + 60e3), policy: p }).rule, 'HALF')
})

test('registration number required by country setting (Canada yes, Syria no)', () => {
  assert.equal(capsuleProfile({ SYBNB_COUNTRY: 'canada' }).stays.requireRegistrationNumber, true)
  assert.equal(capsuleProfile({ SYBNB_COUNTRY: 'syria' }).stays.requireRegistrationNumber, false)
})
