// Browser client for the QC API (QC/server). Each app keeps its own session token.
const BASE = String(import.meta.env.VITE_QC_API_URL || 'http://127.0.0.1:3061').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const storage = {
  get(key) { try { return localStorage.getItem(key) } catch { return null } },
  set(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key) } catch {} },
}

export function createApi(appKey) {
  const tokenKey = `qc.${appKey}.session`
  let token = storage.get(tokenKey)
  let user = null

  async function request(method, path, body) {
    let res
    try {
      res = await fetch(BASE + path, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new ApiError(0, 'NETWORK', 'The QC service is unreachable.')
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 401 && token) setToken(null)
    if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'ERROR', data.error?.message ?? `Request failed (${res.status})`, data.error?.details)
    return data
  }

  function setToken(next) {
    token = next
    storage.set(tokenKey, next)
    if (!next) user = null
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    get user() { return user },
    get signedIn() { return Boolean(token) },
    async loadUser() {
      if (!token) return null
      try { user = (await request('GET', '/api/me')).user } catch (err) { if (err.status === 401) user = null; else throw err }
      return user
    },
    async verify(email, code) {
      const r = await request('POST', '/api/auth/verify', { email, code })
      setToken(r.token)
      user = r.user
      return user
    },
    async logout() {
      try { await request('POST', '/api/auth/logout') } catch {}
      setToken(null)
    },
    hasRole: (role) => Boolean(user?.roles?.includes(role)),
  }
}
