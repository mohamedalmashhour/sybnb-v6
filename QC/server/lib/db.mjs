import { PrismaClient, Prisma } from '../generated/client/index.js'

let client

// QC has its own database. It never reads the V6 DATABASE_URL.
export function db() {
  if (!client) {
    const url = process.env.QC_DATABASE_URL
    if (!url) throw new Error('QC_DATABASE_URL is required — the QC backend never uses the V6 database')
    client = new PrismaClient({ datasources: { db: { url } } })
  }
  return client
}

export async function disconnectDb() {
  await client?.$disconnect()
  client = undefined
}

export { Prisma }

// Postgres exclusion (23P01) / unique (23505) violations, however Prisma wraps them.
export const isExclusionViolation = (err) => /23P01|qc_stay_no_overlap/.test(String(err?.message) + JSON.stringify(err?.meta ?? {}))
export const isUniqueViolation = (err) => err?.code === 'P2002' || /23505|unique constraint/i.test(String(err?.message) + JSON.stringify(err?.meta ?? {}))

export function audit(tx, actorId, action, target, data) {
  return tx.auditLog.create({ data: { actorId, action, target, data } })
}
