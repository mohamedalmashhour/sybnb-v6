// Admin: government money accounts — daily / monthly collection totals and recording a payment to
// the government (owner decision 2026-11-20). Read-only totals for ADMIN/SUPPORT; recording a
// remittance is ADMIN only and audited.
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { activeCountryKey } from '../lib/country.mjs'
import { capsuleProfile } from '../lib/capsule-profile.mjs'
import { collectionTotals, recordRemittance } from '../lib/tax-accounts.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const bad = (code, message) => Object.assign(new Error(message), { statusCode: 400, code, expose: true })

export async function handleTaxAccounts(req, res, url, context) {
  if (url.pathname === '/api/admin/tax-collections') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const group = url.searchParams.get('group') === 'month' ? 'month' : 'day'
    const fromS = url.searchParams.get('from'), toS = url.searchParams.get('to')
    const now = new Date()
    const from = fromS && DATE.test(fromS) ? new Date(fromS + 'T00:00:00Z') : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const to = toS && DATE.test(toS) ? new Date(new Date(toS + 'T00:00:00Z').getTime() + 86_400_000) : new Date(now.getTime() + 86_400_000)
    const result = await collectionTotals({ country: activeCountryKey(), timezone: capsuleProfile()?.timezone || 'UTC', group, from, to, account: url.searchParams.get('account') || undefined })
    const remittances = await db().taxRemittance.findMany({ where: { country: activeCountryKey() }, orderBy: { paidAt: 'desc' }, take: 50 })
    return json(res, 200, { ok: true, country: activeCountryKey(), ...result, remittances })
  }

  if (url.pathname === '/api/admin/tax-remittances') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const account = String(body.account || '').trim()
    const currency = String(body.currency || '').trim().toUpperCase()
    if (!/^[A-Z_]{3,30}$/.test(account)) throw bad('ACCOUNT_INVALID', 'Choose the account to pay (for example GST_QST or RIDE_DUES).')
    if (!/^[A-Z]{3}$/.test(currency)) throw bad('CURRENCY_INVALID', 'Currency must be a 3-letter code.')
    if (!DATE.test(body.periodStart || '') || !DATE.test(body.periodEnd || '') || body.periodStart > body.periodEnd) throw bad('PERIOD_INVALID', 'Give the period as two dates (start <= end).')
    const remittance = await db().$transaction(async (tx) => {
      const r = await recordRemittance(tx, {
        country: activeCountryKey(), timezone: capsuleProfile()?.timezone || 'UTC', account, currency,
        periodStart: body.periodStart, periodEnd: body.periodEnd, reference: body.reference ? String(body.reference).slice(0, 120) : null, actorUserId: context.user.id,
      })
      await tx.adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'TAX_REMITTANCE_RECORDED', entityType: 'tax_remittances', entityId: r.id, after: r } })
      return r
    })
    return json(res, 201, { ok: true, remittance })
  }
  return false
}
