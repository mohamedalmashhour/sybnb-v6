// QC (Québec) API — separate process, database and secrets from the V6 master API.
import { createServer } from 'node:http'
import { profile } from '../../countries/canada/profile.mjs'
import { createHandler } from './app.mjs'
import { db, disconnectDb } from './lib/db.mjs'
import { expireStaleHolds } from './routes/stays.mjs'

const problems = []
if (!process.env.QC_DATABASE_URL) problems.push('QC_DATABASE_URL is required')
if (!process.env.QC_AUTH_SECRET || process.env.QC_AUTH_SECRET.length < 32) problems.push('QC_AUTH_SECRET must be at least 32 characters')
if (process.env.QC_PAYMENTS_MODE === 'simulated' && process.env.NODE_ENV === 'production') problems.push('QC_PAYMENTS_MODE=simulated is not allowed in production')
if (problems.length) {
  console.error(`[qc-api] refusing to start:\n - ${problems.join('\n - ')}`)
  process.exit(1)
}

const host = process.env.QC_API_HOST || '127.0.0.1'
const port = Number(process.env.QC_API_PORT || 3061)
const corsOrigins = String(process.env.QC_CORS_ORIGINS || 'http://127.0.0.1:5190,http://127.0.0.1:5191').split(',').map((s) => s.trim()).filter(Boolean)

await db().$queryRaw`SELECT 1`
const server = createServer(createHandler({ corsOrigins }))
server.listen(port, host, () => console.log(`[qc-api] ${profile.key} listening on http://${host}:${port} (payments: ${process.env.QC_PAYMENTS_MODE === 'simulated' ? 'simulated' : 'disabled'})`))

const sweep = setInterval(() => expireStaleHolds().catch((err) => console.error('[qc-api] hold sweep failed', err)), 60_000)
const shutdown = async () => {
  clearInterval(sweep)
  server.close()
  await disconnectDb()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
