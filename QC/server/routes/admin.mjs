// Admin review: role applications, listing publication, account suspension. Every decision is audited.
import { db, audit } from '../lib/db.mjs'
import { conflict, notFound, oneOf, str } from '../lib/http.mjs'
import { publicUser, requireRole, revokeAllSessions } from '../lib/auth.mjs'
import { parseDate } from '../lib/dates.mjs'

export function adminRoutes(router) {
  router.add('GET /api/admin/applications', async ({ ctx, query }) => {
    requireRole(ctx, 'ADMIN')
    const status = oneOf(query.status ?? 'PENDING', 'status', ['PENDING', 'APPROVED', 'REJECTED'])
    const applications = await db().roleApplication.findMany({ where: { status }, include: { user: true }, orderBy: { createdAt: 'asc' }, take: 200 })
    return { ok: true, applications: applications.map((a) => ({ ...a, user: publicUser(a.user) })) }
  })

  router.add('POST /api/admin/applications/:id/decision', async ({ ctx, params, body }) => {
    const admin = requireRole(ctx, 'ADMIN')
    const decision = oneOf(body.decision, 'decision', ['APPROVE', 'REJECT'])
    const note = str(body.note, 'note', { max: 500, optional: decision === 'APPROVE' })
    const result = await db().$transaction(async (tx) => {
      const claimed = await tx.roleApplication.updateMany({
        where: { id: params.id, status: 'PENDING' },
        data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', note, reviewedBy: admin.id, reviewedAt: new Date() },
      })
      if (claimed.count !== 1) throw conflict('ALREADY_DECIDED', 'This application was already decided.')
      const app = await tx.roleApplication.findUnique({ where: { id: params.id }, include: { user: true } })
      if (decision === 'APPROVE') {
        if (!app.user.roles.includes(app.role)) await tx.user.update({ where: { id: app.userId }, data: { roles: [...app.user.roles, app.role] } })
        if (app.role === 'DRIVER') {
          const d = app.details
          const profileData = { category: d.category, vehicle: d.vehicle, licenceExpiry: parseDate(d.licenceExpiry, 'licenceExpiry'), insuranceExpiry: parseDate(d.insuranceExpiry, 'insuranceExpiry') }
          await tx.driverProfile.upsert({ where: { userId: app.userId }, create: { userId: app.userId, ...profileData }, update: profileData })
        }
        if (!app.user.name && app.details.legalName) await tx.user.update({ where: { id: app.userId }, data: { name: app.details.legalName } })
      }
      await audit(tx, admin.id, `application.${decision.toLowerCase()}`, app.id, { role: app.role, userId: app.userId, note })
      return app
    })
    return { ok: true, application: { id: result.id, role: result.role, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' } }
  })

  router.add('GET /api/admin/listings', async ({ ctx, query }) => {
    requireRole(ctx, 'ADMIN')
    const status = oneOf(query.status ?? 'PENDING_REVIEW', 'status', ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED'])
    const listings = await db().listing.findMany({ where: { status }, include: { host: true }, orderBy: { updatedAt: 'asc' }, take: 200 })
    return { ok: true, listings: listings.map((l) => ({ ...l, host: publicUser(l.host) })) }
  })

  router.add('POST /api/admin/listings/:id/decision', async ({ ctx, params, body }) => {
    const admin = requireRole(ctx, 'ADMIN')
    const decision = oneOf(body.decision, 'decision', ['PUBLISH', 'REJECT', 'SUSPEND'])
    const note = str(body.note, 'note', { max: 500, optional: decision === 'PUBLISH' })
    const from = { PUBLISH: ['PENDING_REVIEW', 'SUSPENDED'], REJECT: ['PENDING_REVIEW'], SUSPEND: ['PUBLISHED'] }[decision]
    const to = { PUBLISH: 'PUBLISHED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED' }[decision]
    const updated = await db().listing.updateMany({ where: { id: params.id, status: { in: from } }, data: { status: to, reviewNote: note } })
    if (updated.count !== 1) throw conflict('INVALID_STATE', `Only ${from.join(' or ').toLowerCase()} listings can be ${to.toLowerCase()}.`)
    await audit(db(), admin.id, `listing.${to.toLowerCase()}`, params.id, { note })
    return { ok: true, listing: { id: params.id, status: to } }
  })

  router.add('POST /api/admin/users/:id/suspend', async ({ ctx, params, body }) => {
    const admin = requireRole(ctx, 'ADMIN')
    const reason = str(body.reason, 'reason', { max: 500 })
    if (params.id === admin.id) throw conflict('SELF_SUSPEND', 'You cannot suspend your own account.')
    await db().$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: params.id } })
      if (!user) throw notFound()
      await tx.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } })
      await revokeAllSessions(tx, user.id)
      await tx.driverProfile.updateMany({ where: { userId: user.id }, data: { online: false } })
      await audit(tx, admin.id, 'user.suspended', user.id, { reason })
    })
    return { ok: true }
  })

  router.add('GET /api/admin/rides', async ({ ctx, query }) => {
    requireRole(ctx, 'ADMIN')
    const where = query.status ? { status: oneOf(query.status, 'status', ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) } : {}
    const rides = await db().ride.findMany({ where, include: { events: { orderBy: { at: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 200 })
    return { ok: true, rides }
  })

  router.add('GET /api/admin/audit', async ({ ctx }) => {
    requireRole(ctx, 'ADMIN')
    const entries = await db().auditLog.findMany({ orderBy: { at: 'desc' }, take: 200 })
    return { ok: true, entries }
  })
}
