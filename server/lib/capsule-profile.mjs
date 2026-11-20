// The active country's settings for the wrapping/ capsules (stays + rides money rules).
// Kept separate from country.mjs on purpose: booking-policy.mjs is imported BY country.mjs, so it
// cannot import country.mjs back. This module only reads SYBNB_COUNTRY and the capsule profiles.
// Returns null when no supported country is selected; callers keep their neutral fallback then
// (the server itself refuses to start without a country — see country.mjs).
import { profile as syria } from '../../countries/syria/capsules.profile.mjs'
import { profile as canada } from '../../countries/canada/capsules.profile.mjs'

const CAPSULE_PROFILES = { syria, canada }

export function capsuleProfile(env = process.env) {
  const key = String(env.SYBNB_COUNTRY || '').trim().toLowerCase()
  return CAPSULE_PROFILES[key] || null
}
