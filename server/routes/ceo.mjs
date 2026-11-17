// CEO advisor routes (migration 084 feature). ADMIN-gated. ADVISORY, MONEY-FREE, SEND-FREE.
//
// GET  /api/admin/ceo/advisories  -> read-only KPI snapshot + advisory cards (no state change).
// POST /api/admin/ceo/actions     -> execute ONE money-free action: queue a CRM task, or draft a
//                                    campaign. Both only write a CrmActivity row against an existing
//                                    contact. Nothing here sends, charges, pays, refunds or transfers.
//
// ADMIN only (not SUPPORT): the advisor is a leadership tool. Bearer-token auth like the rest of
// /api/admin/*; the index-level per-admin action rate limit covers the POST.

import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { createCeoSnapshot } from '../lib/ceo-data.mjs'
import { evaluateCeoAdvisories, ceoActionToActivity, CEO_ACTION_KEYS } from '../lib/ceo-advisor.mjs'
import { isUuid } from '../lib/crm.mjs'

const ACTIVITY_SELECT = {
  id: true, contactId: true, kind: true, status: true, title: true, body: true, source: true,
  dueAt: true, createdById: true, createdAt: true, completedAt: true,
}

export async function handleCeo(req, res, url, context) {
  // ---- Advisory view: GET /api/admin/ceo/advisories ----
  if (url.pathname === '/api/admin/ceo/advisories') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const snapshot = await createCeoSnapshot(db())
    const advisories = evaluateCeoAdvisories(snapshot)
    return json(res, 200, { ok: true, snapshot, advisories })
  }

  // ---- Execute a money-free action: POST /api/admin/ceo/actions ----
  if (url.pathname === '/api/admin/ceo/actions') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)

    const action = String(body?.action || '')
    if (!CEO_ACTION_KEYS.includes(action)) {
      return json(res, 400, { ok: false, error: { code: 'CEO_UNKNOWN_ACTION', message: `action must be one of ${CEO_ACTION_KEYS.join(', ')}.` } })
    }

    // Both actions attach to an existing CRM contact (keeps FK integrity; never auto-creates).
    const contactId = body?.contactId
    if (!isUuid(contactId)) {
      return json(res, 400, { ok: false, error: { code: 'CEO_VALIDATION', message: 'A valid contactId is required.' } })
    }
    const contact = await db().crmContact.findUnique({ where: { id: contactId }, select: { id: true } })
    if (!contact) {
      return json(res, 404, { ok: false, error: { code: 'CRM_CONTACT_NOT_FOUND', message: 'No such contact.' } })
    }

    // Build the money-free activity payload. ceoActionToActivity throws on an unknown action, so a
    // typo can never fall through to an unintended effect.
    const activityData = ceoActionToActivity(action, {
      ruleKey: body?.ruleKey,
      taskTitle: body?.title,
      campaignTitle: body?.title,
      detail: body?.detail,
    })

    const activity = await db().crmActivity.create({
      data: { ...activityData, status: 'OPEN', contactId, createdById: context.user.id },
      select: ACTIVITY_SELECT,
    })
    return json(res, 201, { ok: true, action, activity })
  }

  return false
}
