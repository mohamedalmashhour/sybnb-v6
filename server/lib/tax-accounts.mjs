// GOVERNMENT MONEY ACCOUNTS (owner decision 2026-11-20). Sales taxes and per-trip dues collected from
// customers belong to the government: the company holds them in their own accounts (never shared
// with drivers or hosts), then pays them from daily / monthly collection totals.
//   accounts: GST_QST (sales taxes), RIDE_DUES (Québec $0.90 per trip), later LODGING_TAX for stays.
// Country-neutral: what is collected, and into which account, comes from the country settings.
import { db } from './prisma.mjs'

// Record the government charges of a COMPLETED, paid ride (snapshotted on the ride at request time).
// Idempotent: one row per (ride, tax code), so a re-run of settlement never double-records.
export async function recordRideGovernmentCharges(tx, { ride, country, at = new Date() }) {
  const gc = ride?.metadata?.governmentCharges
  if (!gc) return { recorded: 0 }
  const rows = []
  if (gc.duesMinor > 0) rows.push({ account: gc.duesAccount || 'RIDE_DUES', taxCode: 'DUES', baseMinor: 0, rateBp: null, amountMinor: gc.duesMinor })
  for (const t of gc.taxes || []) if (t.minor > 0) rows.push({ account: t.account || 'GST_QST', taxCode: t.code, baseMinor: t.baseMinor, rateBp: t.rateBp, amountMinor: t.minor })
  if (!rows.length) return { recorded: 0 }
  const res = await tx.taxCollection.createMany({
    data: rows.map((r) => ({ ...r, country, sourceType: 'ride', sourceId: ride.id, currency: ride.currency, collectedAt: at })),
    skipDuplicates: true,
  })
  return { recorded: res.count }
}

// Daily or monthly totals per account and tax code, in the country's time zone, with what is still
// to pay (not yet linked to a remittance).
export async function collectionTotals({ country, timezone = 'UTC', group = 'day', from, to, account }) {
  const unit = group === 'month' ? 'month' : 'day'
  const rows = await db().$queryRawUnsafe(
    `SELECT to_char(date_trunc('${unit}', collected_at AT TIME ZONE $2), '${unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}') AS period,
            account, tax_code AS "taxCode", currency,
            SUM(amount_minor)::int AS "collectedMinor",
            SUM(CASE WHEN remittance_id IS NULL THEN amount_minor ELSE 0 END)::int AS "outstandingMinor",
            COUNT(*)::int AS entries
       FROM tax_collections
      WHERE country = $1 AND collected_at >= $3 AND collected_at < $4 AND ($5::text IS NULL OR account = $5)
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3`,
    country, timezone, from, to, account || null,
  )
  const totals = {}
  for (const r of rows) {
    const k = `${r.account}:${r.currency}`
    totals[k] ||= { account: r.account, currency: r.currency, collectedMinor: 0, outstandingMinor: 0 }
    totals[k].collectedMinor += r.collectedMinor
    totals[k].outstandingMinor += r.outstandingMinor
  }
  return { group: unit, rows, totals: Object.values(totals) }
}

// Record a payment to the government for one account and period: links every still-unpaid collection
// of that account/currency in the period and stores the total. Refuses an empty period.
export async function recordRemittance(tx, { country, timezone = 'UTC', account, currency, periodStart, periodEnd, reference, actorUserId }) {
  const ids = await tx.$queryRaw`
    SELECT id FROM tax_collections
     WHERE country = ${country} AND account = ${account} AND currency = ${currency} AND remittance_id IS NULL
       AND (collected_at AT TIME ZONE ${timezone})::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
     FOR UPDATE`
  if (!ids.length) {
    const error = new Error('Nothing left to pay for this account and period.')
    error.statusCode = 409
    error.code = 'NOTHING_TO_REMIT'
    error.expose = true
    throw error
  }
  const sum = await tx.taxCollection.aggregate({ where: { id: { in: ids.map((r) => r.id) } }, _sum: { amountMinor: true } })
  const remittance = await tx.taxRemittance.create({
    data: { country, account, currency, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), amountMinor: sum._sum.amountMinor || 0, reference: reference || null, recordedById: actorUserId || null },
  })
  await tx.taxCollection.updateMany({ where: { id: { in: ids.map((r) => r.id) }, remittanceId: null }, data: { remittanceId: remittance.id } })
  return remittance
}
