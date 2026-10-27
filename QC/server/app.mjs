// QC backend request handler. Kept separate from index.mjs so tests can mount it on a random port.
import { profile } from '../../countries/canada/profile.mjs'
import { authenticate } from './lib/auth.mjs'
import { HttpError, createRouter, readJson, sendJson } from './lib/http.mjs'
import { accountRoutes } from './routes/account.mjs'
import { adminRoutes } from './routes/admin.mjs'
import { rideRoutes } from './routes/rides.mjs'
import { stayRoutes } from './routes/stays.mjs'

export function createHandler({ corsOrigins = [] } = {}) {
  const router = createRouter()
  router.add('GET /api/health', async () => ({ ok: true, country: profile.key, gates: profile.gates, payments: process.env.QC_PAYMENTS_MODE === 'simulated' ? 'simulated' : 'disabled' }))
  router.add('GET /api/config', async () => ({
    ok: true,
    currency: profile.currencies.default,
    locales: profile.locales,
    timezone: profile.timezone,
    rideCategories: Object.entries(profile.rides.categories).map(([key, c]) => ({ key, seats: c.seats })),
    taxStatus: profile.taxes.status,
    stays: { holdMinutes: profile.stays.holdMinutes, fullRefundCutoffHours: profile.stays.fullRefundCutoffHours, requireRegistrationNumber: profile.stays.requireRegistrationNumber },
  }))
  accountRoutes(router, { profile })
  stayRoutes(router, { profile })
  rideRoutes(router, { profile })
  adminRoutes(router)

  return async function handle(req, res) {
    const origin = req.headers.origin
    const cors = origin && corsOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, vary: 'origin', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' }
      : {}
    if (req.method === 'OPTIONS') {
      res.writeHead(cors['access-control-allow-origin'] ? 204 : 403, cors)
      return res.end()
    }
    try {
      const url = new URL(req.url, 'http://local')
      const match = router.match(req.method, url.pathname)
      if (!match) throw new HttpError(404, 'NOT_FOUND', 'No QC API route matched this request.')
      if (match.methodNotAllowed) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
      const body = await readJson(req)
      const ctx = { auth: await authenticate(req) }
      const result = await match.handler({ req, res, params: match.params, query: Object.fromEntries(url.searchParams), body, ctx })
      if (result && 'status' in result && 'body' in result) sendJson(res, result.status, result.body, cors)
      else sendJson(res, 200, result ?? { ok: true }, cors)
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { ok: false, error: { code: err.code, message: err.message, details: err.details } }, cors)
      } else {
        console.error('[qc-api] unhandled', err)
        sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong.' } }, cors)
      }
    }
  }
}
