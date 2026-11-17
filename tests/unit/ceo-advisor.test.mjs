import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateCeoAdvisories,
  ceoActionToActivity,
  CEO_ACTION_KEYS,
  CEO_RULE_KEYS,
  CEO_DEFAULT_THRESHOLDS,
} from '../../server/lib/ceo-advisor.mjs'

// A healthy snapshot that trips NO rule.
const HEALTHY = {
  activeListings: 100,
  submittedListings: 10,
  approvedListings: 9,
  activeDrivers: 50,
  openRideDemand: 10,
  dormantHosts: 0,
  marketingConsentedNoRecentCampaign: 0,
}

test('healthy snapshot produces no advisory cards', () => {
  assert.deepEqual(evaluateCeoAdvisories(HEALTHY), [])
})

test('thin host supply raises an advisory-only card (no action)', () => {
  const cards = evaluateCeoAdvisories({ ...HEALTHY, activeListings: 3 })
  const card = cards.find((c) => c.key === 'ceo_host_supply_low')
  assert.ok(card)
  assert.equal(card.recommendedAction, null)
})

test('driver imbalance recommends queue_crm_task', () => {
  const cards = evaluateCeoAdvisories({ ...HEALTHY, activeDrivers: 2, openRideDemand: 20 })
  const card = cards.find((c) => c.key === 'ceo_driver_supply_imbalance')
  assert.ok(card)
  assert.equal(card.recommendedAction, 'queue_crm_task')
})

test('dormant hosts recommend queue_crm_task', () => {
  const cards = evaluateCeoAdvisories({ ...HEALTHY, dormantHosts: 5 })
  assert.equal(cards.find((c) => c.key === 'ceo_host_churn').recommendedAction, 'queue_crm_task')
})

test('stalled pipeline recommends queue_crm_task', () => {
  const cards = evaluateCeoAdvisories({ ...HEALTHY, submittedListings: 10, approvedListings: 1 })
  assert.equal(cards.find((c) => c.key === 'ceo_listing_pipeline_stalled').recommendedAction, 'queue_crm_task')
})

test('marketing opportunity recommends draft_campaign only', () => {
  const cards = evaluateCeoAdvisories({ ...HEALTHY, marketingConsentedNoRecentCampaign: 40 })
  assert.equal(cards.find((c) => c.key === 'ceo_marketing_opportunity').recommendedAction, 'draft_campaign')
})

test('cards are sorted most-severe first (act before watch before info)', () => {
  const cards = evaluateCeoAdvisories({
    activeListings: 1, submittedListings: 10, approvedListings: 1, activeDrivers: 50,
    openRideDemand: 10, dormantHosts: 5, marketingConsentedNoRecentCampaign: 40,
  })
  const sev = cards.map((c) => c.severity)
  const rank = { act: 0, watch: 1, info: 2 }
  for (let i = 1; i < sev.length; i++) assert.ok(rank[sev[i - 1]] <= rank[sev[i]])
})

// ---- GUARDRAILS (mirror Joblop): the advisor can ONLY queue a task or draft a campaign. ----

test('GUARDRAIL: every recommendedAction is null or one of exactly the two money-free actions', () => {
  // Trip every rule at once.
  const cards = evaluateCeoAdvisories({
    activeListings: 0, submittedListings: 50, approvedListings: 0, activeDrivers: 0,
    openRideDemand: 99, dormantHosts: 99, marketingConsentedNoRecentCampaign: 99,
  })
  assert.ok(cards.length >= 4)
  for (const c of cards) {
    assert.ok(c.recommendedAction === null || CEO_ACTION_KEYS.includes(c.recommendedAction))
  }
})

test('GUARDRAIL: action keys are exactly queue_crm_task + draft_campaign, nothing money-moving', () => {
  assert.deepEqual([...CEO_ACTION_KEYS].sort(), ['draft_campaign', 'queue_crm_task'])
  const forbidden = /pay|payout|refund|charge|transfer|lock|settle|capture|withdraw|invoice|send|commission|ledger|wallet/i
  for (const k of CEO_ACTION_KEYS) assert.ok(!forbidden.test(k), `action key ${k} must be money/send-free`)
})

test('GUARDRAIL: ceoActionToActivity only yields TASK or CAMPAIGN_DRAFT, never a money effect', () => {
  const task = ceoActionToActivity('queue_crm_task', { taskTitle: 'x', ruleKey: 'ceo_host_churn' })
  assert.equal(task.kind, 'TASK')
  assert.equal(task.source, 'ceo:ceo_host_churn')
  const draft = ceoActionToActivity('draft_campaign', { campaignTitle: 'y' })
  assert.equal(draft.kind, 'CAMPAIGN_DRAFT')
  assert.match(draft.body, /DRAFT ONLY/)
  const forbidden = /\bpay\b|payout|refund|charge|transfer|capture|withdraw|settle/i
  for (const a of [task, draft]) {
    assert.ok(!forbidden.test(JSON.stringify(a)))
  }
})

test('GUARDRAIL: ceoActionToActivity throws on any non-whitelisted action', () => {
  assert.throws(() => ceoActionToActivity('refund_user', {}), /Unknown CEO action/)
  assert.throws(() => ceoActionToActivity('send_campaign', {}), /Unknown CEO action/)
})

test('rule keys are stable and defaults present', () => {
  assert.equal(CEO_RULE_KEYS.length, 5)
  assert.ok(CEO_DEFAULT_THRESHOLDS.hostSupplyMinActiveListings > 0)
})
