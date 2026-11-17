// CEO advisor (migration 084 feature). ADVISORY ONLY. MONEY-FREE. SEND-FREE.
//
// Mirrors the Joblop CEO persona on the Rezekme (sybnb-v6) backend, adapted to Rezekme's domain
// (rides + stays: hosts, drivers, listings, bookings). It reads a plain KPI snapshot and returns a
// list of advisory "cards": each names a signal and, at most, a single money-free recommended
// action. The ONLY actions that exist are `queue_crm_task` (write a CrmActivity TASK) and
// `draft_campaign` (write a CrmActivity CAMPAIGN_DRAFT). There is deliberately NO pay / payout /
// refund / charge / transfer / lock / settle / capture / withdraw / invoice / send capability
// anywhere in this module. Sending a drafted campaign is always a separate human step that must
// re-read live LegalConsent first — this module never sends and never reads money.
//
// This file is PURE (no I/O): the snapshot is produced read-only elsewhere (server/lib/ceo-data.mjs)
// and passed in, which keeps the whole rule set unit-testable without a database.

// The only two outputs the advisor may recommend. Exported for the guardrail test.
export const CEO_ACTION_KEYS = Object.freeze(['queue_crm_task', 'draft_campaign'])

export const CEO_RULE_KEYS = Object.freeze([
  'ceo_host_supply_low',
  'ceo_driver_supply_imbalance',
  'ceo_host_churn',
  'ceo_listing_pipeline_stalled',
  'ceo_marketing_opportunity',
])

export const CEO_DEFAULT_THRESHOLDS = Object.freeze({
  hostSupplyMinActiveListings: 10, // below this many active listings, supply is thin
  driverDemandRatioMax: 0.5, // active drivers per open ride-demand unit; below => imbalance
  hostChurnDormantMin: 3, // this many dormant hosts raises a churn card
  pipelineSubmittedMin: 5, // this many listings awaiting review
  pipelineApprovedRatioMax: 0.5, // with < this share approved, the pipeline is stalled
  marketingConsentedMin: 25, // consented contacts with no recent campaign to justify a draft
})

export const CEO_SEVERITIES = Object.freeze(['info', 'watch', 'act'])

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// Evaluate the full rule set against a snapshot. Returns an array of advisory cards, most severe
// first. Each card: { key, severity, title, detail, recommendedAction|null, actionArgs|null }.
// recommendedAction is ALWAYS one of CEO_ACTION_KEYS or null (advisory with no action).
export function evaluateCeoAdvisories(snapshot = {}, thresholds = CEO_DEFAULT_THRESHOLDS) {
  const t = { ...CEO_DEFAULT_THRESHOLDS, ...(thresholds || {}) }
  const s = snapshot || {}
  const cards = []

  // 1. Host supply thin overall or in a region. Advisory only (no single CRM contact to act on).
  const activeListings = num(s.activeListings)
  if (activeListings < t.hostSupplyMinActiveListings) {
    cards.push({
      key: 'ceo_host_supply_low',
      severity: 'act',
      title: 'Host supply is thin',
      detail: `Only ${activeListings} active listings (target ≥ ${t.hostSupplyMinActiveListings}). Guest demand may go unmet.`,
      recommendedAction: null,
      actionArgs: null,
    })
  }

  // 2. Driver supply vs ride demand imbalance -> queue a CRM task to recruit drivers in the region.
  const activeDrivers = num(s.activeDrivers)
  const openRideDemand = num(s.openRideDemand)
  if (openRideDemand > 0) {
    const ratio = activeDrivers / openRideDemand
    if (ratio < t.driverDemandRatioMax) {
      cards.push({
        key: 'ceo_driver_supply_imbalance',
        severity: 'act',
        title: 'Driver supply is short of ride demand',
        detail: `${activeDrivers} active drivers for ${openRideDemand} units of open ride demand (ratio ${ratio.toFixed(2)} < ${t.driverDemandRatioMax}).`,
        recommendedAction: 'queue_crm_task',
        actionArgs: { taskTitle: 'Recruit / activate drivers to meet ride demand', regionKey: s.regionKey ?? null },
      })
    }
  }

  // 3. Host churn: dormant hosts -> queue a win-back CRM task.
  const dormantHosts = num(s.dormantHosts)
  if (dormantHosts >= t.hostChurnDormantMin) {
    cards.push({
      key: 'ceo_host_churn',
      severity: 'watch',
      title: 'Hosts are going dormant',
      detail: `${dormantHosts} hosts have gone dormant (≥ ${t.hostChurnDormantMin}). Consider a win-back outreach.`,
      recommendedAction: 'queue_crm_task',
      actionArgs: { taskTitle: 'Win-back outreach to dormant hosts', regionKey: s.regionKey ?? null },
    })
  }

  // 4. Listing approval pipeline stalled: many submitted, few approved -> queue an ops task.
  const submittedListings = num(s.submittedListings)
  const approvedListings = num(s.approvedListings)
  if (submittedListings >= t.pipelineSubmittedMin) {
    const approvedRatio = approvedListings / submittedListings
    if (approvedRatio < t.pipelineApprovedRatioMax) {
      cards.push({
        key: 'ceo_listing_pipeline_stalled',
        severity: 'watch',
        title: 'Listing review pipeline is stalled',
        detail: `${submittedListings} listings submitted, ${approvedListings} approved (${(approvedRatio * 100).toFixed(0)}% < ${(t.pipelineApprovedRatioMax * 100).toFixed(0)}%). Review backlog may be blocking supply.`,
        recommendedAction: 'queue_crm_task',
        actionArgs: { taskTitle: 'Clear the listing review backlog', regionKey: null },
      })
    }
  }

  // 5. Marketing opportunity: enough consented contacts with no recent campaign -> DRAFT a campaign.
  //    NOTE: consent here is a placeholder count from the snapshot; a real send must re-read live
  //    LegalConsent per contact. This only DRAFTS; it never sends.
  const marketingConsented = num(s.marketingConsentedNoRecentCampaign)
  if (marketingConsented >= t.marketingConsentedMin) {
    cards.push({
      key: 'ceo_marketing_opportunity',
      severity: 'info',
      title: 'Audience ready for a campaign',
      detail: `${marketingConsented} consented contacts have had no recent campaign (≥ ${t.marketingConsentedMin}). A draft could re-engage them. Draft only — sending stays a human step after a live consent re-check.`,
      recommendedAction: 'draft_campaign',
      actionArgs: { campaignTitle: 'Re-engagement campaign (DRAFT)' },
    })
  }

  const order = { act: 0, watch: 1, info: 2 }
  return cards.sort((a, b) => order[a.severity] - order[b.severity])
}

// Map a recommended CEO action to a money-free CrmActivity payload. Returns a plain object the route
// hands to crm.normalizeActivityInput / prisma. NEVER returns anything that moves money or sends.
// Throws on an unknown action key so a typo can never fall through to an unintended effect.
export function ceoActionToActivity(actionKey, args = {}) {
  if (!CEO_ACTION_KEYS.includes(actionKey)) {
    const error = new Error('Unknown CEO action.')
    error.statusCode = 400
    error.code = 'CEO_UNKNOWN_ACTION'
    error.expose = true
    throw error
  }
  if (actionKey === 'queue_crm_task') {
    return {
      kind: 'TASK',
      title: String(args.taskTitle || 'CEO advisory follow-up task'),
      body: args.detail ? String(args.detail) : null,
      source: `ceo:${args.ruleKey || 'manual'}`,
    }
  }
  // draft_campaign -> a CAMPAIGN_DRAFT activity. Draft only. Never sends.
  return {
    kind: 'CAMPAIGN_DRAFT',
    title: String(args.campaignTitle || 'Campaign draft'),
    body: 'DRAFT ONLY. Sending requires a human to re-read live marketing consent (LegalConsent) first.',
    source: `ceo:${args.ruleKey || 'manual'}`,
  }
}
