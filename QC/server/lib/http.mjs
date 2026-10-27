// Minimal HTTP helpers for the QC backend: JSON in/out, typed errors and a param router.

const MAX_BODY_BYTES = 256 * 1024

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details)
export const forbidden = (message = 'You are not allowed to do this.') => new HttpError(403, 'FORBIDDEN', message)
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message)
export const conflict = (code, message) => new HttpError(409, code, message)

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

export async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {}
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw badRequest('INVALID_JSON', 'Request body must be a JSON object.')
  }
}

// Routes are registered as 'METHOD /path/:param'. Handlers receive ({ req, res, params, query, body, ctx }).
export function createRouter() {
  const routes = []
  const add = (spec, handler) => {
    const [method, path] = spec.split(' ')
    const keys = []
    const pattern = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '/?$')
    routes.push({ method, pattern, keys, handler })
  }
  const match = (method, pathname) => {
    let pathMatched = false
    for (const r of routes) {
      const m = r.pattern.exec(pathname)
      if (!m) continue
      pathMatched = true
      if (r.method !== method) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
      return { handler: r.handler, params }
    }
    return pathMatched ? { methodNotAllowed: true } : null
  }
  return { add, match }
}


// Small validation helpers. All throw 400 with a field-specific code.
export function str(value, field, { min = 1, max = 500, optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return null
    throw badRequest('FIELD_REQUIRED', `${field} is required.`, { field })
  }
  if (typeof value !== 'string') throw badRequest('FIELD_INVALID', `${field} must be text.`, { field })
  const v = value.trim()
  if (v.length < min || v.length > max) throw badRequest('FIELD_INVALID', `${field} must be ${min}-${max} characters.`, { field })
  return v
}

export function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return null
    throw badRequest('FIELD_REQUIRED', `${field} is required.`, { field })
  }
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest('FIELD_INVALID', `${field} must be a whole number from ${min} to ${max}.`, { field })
  return n
}

export function num(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw badRequest('FIELD_INVALID', `${field} must be a number from ${min} to ${max}.`, { field })
  return n
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw badRequest('FIELD_INVALID', `${field} must be one of ${allowed.join(', ')}.`, { field })
  return value
}
