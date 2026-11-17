// CEO advisor read model (migration 084 feature). READ-ONLY. MONEY-FREE.
//
// Produces the plain KPI snapshot that the pure rule engine (server/lib/ceo-advisor.mjs) evaluates.
// Every query here is a COUNT — no money, ledger, wallet, payout, commission or payment-event table
// is read, and nothing is written. If a count fails it degrades to 0 for that signal rather than
// failing the whole advisory view (an advisory screen must never 500 a business signal into silence
// loudly; a missing signal just doesn't fire its card). All counts are defensive and independent.

import { log } from './logger.mjs'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

async function safeCount(label, fn) {
  try {
    return await fn()
  } catch (error) {
    log.warn?.('ceo_snapshot_count_failed', { label, message: error?.message })
    return 0
  }
}

// Build the read-only KPI snapshot. `db` is the Prisma client (server/lib/prisma.mjs db()).
export async function createCeoSnapshot(db) {
  const since = new Date(Date.now() - THIRTY_DAYS_MS)

  const [
    activeListings,
    submittedListings,
    approvedListings,
    activeDrivers,
    openRideDemand,
    dormantHosts,
    marketingConsentedNoRecentCampaign,
  ] = await Promise.all([
    safeCount('activeListings', () => db.listing.count({ where: { status: 'APPROVED' } })),
    safeCount('submittedListings', () => db.listing.count({ where: { status: { in: ['PENDING_REVIEW', 'APPROVED'] }, createdAt: { gte: since } } })),
    safeCount('approvedListings', () => db.listing.count({ where: { status: 'APPROVED', createdAt: { gte: since } } })),
    safeCount('activeDrivers', () => db.driverProfile.count()),
    safeCount('openRideDemand', () => db.rideRequest.count({ where: { status: 'REQUESTED', driverId: null } })),
    // Dormant host: a verified host with no APPROVED listing standing.
    safeCount('dormantHosts', () => db.user.count({ where: { hostVerifiedAt: { not: null }, listings: { none: { status: 'APPROVED' } } } })),
    // Placeholder (no campaign table yet): consented CRM contacts. A real send must re-read live
    // LegalConsent per contact — this count only justifies DRAFTING, never sending.
    safeCount('marketingConsentedNoRecentCampaign', () => db.crmContact.count({ where: { marketingOptInAt: { not: null } } })),
  ])

  return {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    activeListings,
    submittedListings,
    approvedListings,
    activeDrivers,
    openRideDemand,
    dormantHosts,
    marketingConsentedNoRecentCampaign,
    regionKey: null, // platform-wide snapshot; per-region can be layered later
  }
}
