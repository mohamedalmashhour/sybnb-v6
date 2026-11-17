// CRM routes (migration 084). ADMIN/SUPPORT-gated, money-free.
//
// Surfaces the ops/growth contact book and its activities (notes, tasks, follow-ups, campaign
// DRAFTS). Nothing here moves money, charges, pays, refunds or sends: the only outward effect is a
// row written to crm_contacts / crm_activities. All mutations are gated on ADMIN|SUPPORT and the
// index-level per-admin action rate limit (server/index.mjs) applies to the /api/admin/ prefix.
//
// Auth model: like the rest of /api/admin/*, this is bearer-token (Authorization header) — there is
// no cookie, so no CSRF/same-origin surface. requireAuth(context, roles) is the gate.

import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import {
  CRM_CONTACT_KINDS,
  CRM_CONTACT_STAGES,
  normalizeContactInput,
  normalizeActivityInput,
  normalizeLimit,
  isUuid,
} from '../lib/crm.mjs'

const CONTACT_SELECT = {
  id: true,
  userId: true,
  kind: true,
  stage: true,
  displayName: true,
  email: true,
  phone: true,
  marketingOptInAt: true,
  regionKey: true,
  notes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
}

const ACTIVITY_SELECT = {
  id: true,
  contactId: true,
  kind: true,
  status: true,
  title: true,
  body: true,
  source: true,
  dueAt: true,
  createdById: true,
  createdAt: true,
  completedAt: true,
}

export async function handleCrm(req, res, url, context) {
  // ---- List contacts: GET /api/admin/crm/contacts?stage=&kind=&q=&limit= ----
  if (url.pathname === '/api/admin/crm/contacts') {
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const params = url.searchParams
      const where = {}
      const stage = params.get('stage')
      if (stage) {
        if (!CRM_CONTACT_STAGES.includes(stage)) return json(res, 400, { ok: false, error: { code: 'CRM_VALIDATION', message: 'Unknown stage filter.' } })
        where.stage = stage
      }
      const kind = params.get('kind')
      if (kind) {
        if (!CRM_CONTACT_KINDS.includes(kind)) return json(res, 400, { ok: false, error: { code: 'CRM_VALIDATION', message: 'Unknown kind filter.' } })
        where.kind = kind
      }
      const q = (params.get('q') || '').trim()
      if (q) {
        where.OR = [
          { displayName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ]
      }
      const limit = normalizeLimit(params.get('limit'))
      const contacts = await db().crmContact.findMany({
        where,
        select: CONTACT_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: limit,
      })
      return json(res, 200, { ok: true, contacts })
    }

    // ---- Create contact: POST /api/admin/crm/contacts ----
    if (req.method === 'POST') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const body = await readJson(req)
      const data = normalizeContactInput(body, { createdById: context.user.id })
      const contact = await db().crmContact.create({ data, select: CONTACT_SELECT })
      return json(res, 201, { ok: true, contact })
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  // ---- One contact (+ its activities): GET /api/admin/crm/contacts/:id ----
  const contactMatch = url.pathname.match(/^\/api\/admin\/crm\/contacts\/([^/]+)$/)
  if (contactMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const id = contactMatch[1]
    if (!isUuid(id)) return json(res, 400, { ok: false, error: { code: 'CRM_VALIDATION', message: 'Invalid contact id.' } })
    const contact = await db().crmContact.findUnique({
      where: { id },
      select: { ...CONTACT_SELECT, activities: { select: ACTIVITY_SELECT, orderBy: { createdAt: 'desc' }, take: 200 } },
    })
    if (!contact) return json(res, 404, { ok: false, error: { code: 'CRM_CONTACT_NOT_FOUND', message: 'No such contact.' } })
    return json(res, 200, { ok: true, contact })
  }

  // ---- Add activity: POST /api/admin/crm/contacts/:id/activities ----
  const addActivityMatch = url.pathname.match(/^\/api\/admin\/crm\/contacts\/([^/]+)\/activities$/)
  if (addActivityMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const contactId = addActivityMatch[1]
    if (!isUuid(contactId)) return json(res, 400, { ok: false, error: { code: 'CRM_VALIDATION', message: 'Invalid contact id.' } })
    const exists = await db().crmContact.findUnique({ where: { id: contactId }, select: { id: true } })
    if (!exists) return json(res, 404, { ok: false, error: { code: 'CRM_CONTACT_NOT_FOUND', message: 'No such contact.' } })
    const body = await readJson(req)
    const data = normalizeActivityInput(body, { createdById: context.user.id })
    const activity = await db().crmActivity.create({ data: { ...data, contactId }, select: ACTIVITY_SELECT })
    // Touch the contact so list ordering reflects recent activity.
    await db().crmContact.update({ where: { id: contactId }, data: { updatedAt: new Date() } })
    return json(res, 201, { ok: true, activity })
  }

  // ---- Complete / cancel an activity: POST /api/admin/crm/activities/:id/status ----
  const activityStatusMatch = url.pathname.match(/^\/api\/admin\/crm\/activities\/([^/]+)\/status$/)
  if (activityStatusMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const id = activityStatusMatch[1]
    if (!isUuid(id)) return json(res, 400, { ok: false, error: { code: 'CRM_VALIDATION', message: 'Invalid activity id.' } })
    const body = await readJson(req)
    const next = String(body?.status || '')
    if (next !== 'DONE' && next !== 'CANCELLED' && next !== 'OPEN') {
      return json(res, 400, { ok: false, error: { code: 'CRM_VALIDATION', message: 'status must be OPEN, DONE or CANCELLED.' } })
    }
    const existing = await db().crmActivity.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return json(res, 404, { ok: false, error: { code: 'CRM_ACTIVITY_NOT_FOUND', message: 'No such activity.' } })
    const activity = await db().crmActivity.update({
      where: { id },
      data: { status: next, completedAt: next === 'DONE' ? new Date() : null },
      select: ACTIVITY_SELECT,
    })
    return json(res, 200, { ok: true, activity })
  }

  return false
}
