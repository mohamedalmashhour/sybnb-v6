import { db, audit } from '../lib/db.mjs'
import { badRequest, conflict, oneOf, str } from '../lib/http.mjs'
import { isEmail, issueLoginCode, normalizeEmail, publicUser, requireUser, revokeSession, verifyLoginCode } from '../lib/auth.mjs'
import { parseDate, toDateString, todayIn } from '../lib/dates.mjs'
import { sendMail } from '../lib/mailer.mjs'

export function accountRoutes(router, { profile }) {
  router.add('POST /api/auth/code', async ({ body }) => {
    const email = normalizeEmail(body.email)
    if (!isEmail(email)) throw badRequest('FIELD_INVALID', 'Enter a valid email address.', { field: 'email' })
    const code = await issueLoginCode(email)
    const fr = String(body.locale ?? '').startsWith('fr')
    await sendMail({
      to: email,
      subject: fr ? `Votre code de connexion : ${code}` : `Your sign-in code: ${code}`,
      text: fr ? `Votre code est ${code}. Il expire dans 10 minutes.` : `Your code is ${code}. It expires in 10 minutes.`,
    })
    return { status: 202, body: { ok: true } }
  })

  router.add('POST /api/auth/verify', async ({ body }) => {
    const email = normalizeEmail(body.email)
    const { token, user } = await verifyLoginCode(email, body.code)
    return { ok: true, token, user: publicUser(user) }
  })

  router.add('POST /api/auth/logout', async ({ ctx }) => {
    requireUser(ctx)
    await revokeSession(ctx.auth.sessionId)
    return { ok: true }
  })

  router.add('GET /api/me', async ({ ctx }) => ({ ok: true, user: publicUser(requireUser(ctx)) }))

  router.add('PATCH /api/me', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    const data = {}
    if ('name' in body) data.name = str(body.name, 'name', { max: 80 })
    if ('locale' in body) data.locale = oneOf(body.locale, 'locale', profile.locales)
    const updated = await db().user.update({ where: { id: user.id }, data })
    return { ok: true, user: publicUser(updated) }
  })

  // Apply to become a host or driver. Approval is a human admin decision; nothing is granted here.
  router.add('POST /api/applications', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    const role = oneOf(body.role, 'role', ['HOST', 'DRIVER'])
    if (user.roles.includes(role)) throw conflict('ALREADY_APPROVED', `You already have an approved ${role.toLowerCase()} account.`)
    const details = role === 'DRIVER' ? driverDetails(body.details ?? {}, profile) : hostDetails(body.details ?? {})
    const pending = await db().roleApplication.findFirst({ where: { userId: user.id, role, status: 'PENDING' } })
    if (pending) throw conflict('APPLICATION_PENDING', 'Your application is already under review.')
    const app = await db().$transaction(async (tx) => {
      const created = await tx.roleApplication.create({ data: { userId: user.id, role, details } })
      await audit(tx, user.id, 'application.submitted', created.id, { role })
      return created
    })
    return { status: 201, body: { ok: true, application: app } }
  })

  router.add('GET /api/applications', async ({ ctx }) => {
    const user = requireUser(ctx)
    const applications = await db().roleApplication.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    return { ok: true, applications }
  })
}

function hostDetails(d) {
  return {
    legalName: str(d.legalName, 'legalName', { max: 120 }),
    phone: str(d.phone, 'phone', { max: 30 }),
    address: str(d.address, 'address', { max: 200 }),
  }
}

function driverDetails(d, profile) {
  const today = todayIn(profile.timezone)
  const future = (v, field) => {
    const date = parseDate(v, field)
    if (date <= today) throw badRequest('DOCUMENT_EXPIRED', `${field} must be in the future.`, { field })
    return toDateString(date)
  }
  const year = Number(d.vehicle?.year)
  if (!Number.isInteger(year) || year < today.getUTCFullYear() - 15 || year > today.getUTCFullYear() + 1) {
    throw badRequest('FIELD_INVALID', 'vehicle.year is outside the accepted range.', { field: 'vehicle.year' })
  }
  return {
    legalName: str(d.legalName, 'legalName', { max: 120 }),
    phone: str(d.phone, 'phone', { max: 30 }),
    licenceNumber: str(d.licenceNumber, 'licenceNumber', { max: 40 }),
    licenceExpiry: future(d.licenceExpiry, 'licenceExpiry'),
    insuranceExpiry: future(d.insuranceExpiry, 'insuranceExpiry'),
    category: oneOf(d.category ?? 'STANDARD', 'category', Object.keys(profile.rides.categories)),
    vehicle: {
      make: str(d.vehicle?.make, 'vehicle.make', { max: 40 }),
      model: str(d.vehicle?.model, 'vehicle.model', { max: 40 }),
      year,
      colour: str(d.vehicle?.colour, 'vehicle.colour', { max: 30 }),
      plate: str(d.vehicle?.plate, 'vehicle.plate', { max: 12 }).toUpperCase(),
    },
  }
}
