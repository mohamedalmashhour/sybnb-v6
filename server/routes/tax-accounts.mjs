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

// ---- Ride tax records: lists for the accounting department and Revenu Québec reviews -------------
const CSV_COLS = ['issuedAt', 'kind', 'rideId', 'driverId', 'driverName', 'driverGstNumber', 'driverQstNumber', 'riderId', 'riderName', 'currency', 'fareMinor', 'cancellationFeeMinor', 'duesMinor', 'gstMinor', 'qstMinor', 'totalMinor', 'driverPayoutMinor', 'platformCommissionMinor', 'retainUntil']
const csvCell = (v) => { const s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export async function handleRideTaxRecords(req, res, url, context) {
  if (url.pathname === '/api/admin/ride-tax-records') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const kind = ['COMPLETED', 'CANCELLATION'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : undefined
    const fromS = url.searchParams.get('from'), toS = url.searchParams.get('to')
    const where = {
      country: activeCountryKey(),
      ...(kind ? { kind } : {}),
      ...(url.searchParams.get('driverId') ? { driverId: url.searchParams.get('driverId') } : {}),
      ...(url.searchParams.get('riderId') ? { riderId: url.searchParams.get('riderId') } : {}),
      issuedAt: { gte: fromS && DATE.test(fromS) ? new Date(fromS + 'T00:00:00Z') : new Date(0), lt: toS && DATE.test(toS) ? new Date(new Date(toS + 'T00:00:00Z').getTime() + 86_400_000) : new Date(Date.now() + 86_400_000) },
    }
    const records = await db().rideTaxRecord.findMany({ where, orderBy: { issuedAt: 'asc' }, take: 10_000 })
    if (url.searchParams.get('format') === 'csv') {
      const body = [CSV_COLS.join(','), ...records.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n')
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ride-tax-records-${kind || 'all'}.csv"` })
      res.end(body)
      return true
    }
    const sum = (k) => records.reduce((a, r) => a + r[k], 0)
    return json(res, 200, { ok: true, count: records.length, totals: { fareMinor: sum('fareMinor'), cancellationFeeMinor: sum('cancellationFeeMinor'), duesMinor: sum('duesMinor'), gstMinor: sum('gstMinor'), qstMinor: sum('qstMinor'), totalMinor: sum('totalMinor') }, records })
  }

  // Per-driver totals for a period: what Revenu Québec expects the platform to give each driver
  // (amounts collected incl. taxes, GST and QST collected on the driver's behalf).
  if (url.pathname === '/api/admin/ride-tax-records/drivers') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const fromS = url.searchParams.get('from'), toS = url.searchParams.get('to')
    if (!DATE.test(fromS || '') || !DATE.test(toS || '')) throw bad('PERIOD_INVALID', 'Give from and to as dates.')
    const rows = await db().rideTaxRecord.groupBy({
      by: ['driverId', 'driverName', 'driverGstNumber', 'driverQstNumber', 'currency'],
      where: { country: activeCountryKey(), issuedAt: { gte: new Date(fromS + 'T00:00:00Z'), lt: new Date(new Date(toS + 'T00:00:00Z').getTime() + 86_400_000) } },
      _sum: { fareMinor: true, cancellationFeeMinor: true, duesMinor: true, gstMinor: true, qstMinor: true, totalMinor: true, driverPayoutMinor: true },
      _count: { _all: true },
    })
    return json(res, 200, { ok: true, period: { from: fromS, to: toS }, drivers: rows.map((r) => ({ driverId: r.driverId, driverName: r.driverName, gstNumber: r.driverGstNumber, qstNumber: r.driverQstNumber, currency: r.currency, records: r._count._all, ...Object.fromEntries(Object.entries(r._sum).map(([k, v]) => [k, v || 0])) })) })
  }
  return false
}
