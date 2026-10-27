// Passwordless email-code sign-in and bearer sessions. Codes and tokens are stored only as
// keyed hashes. Roles are granted by approved applications (HOST, DRIVER) or by QC_ADMIN_EMAILS.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { db, audit } from './db.mjs'
import { HttpError, forbidden } from './http.mjs'

const CODE_TTL_MS = 10 * 60_000
const MAX_CODE_ATTEMPTS = 5
const MAX_CODES_PER_WINDOW = 5
const CODE_WINDOW_MS = 15 * 60_000
const SESSION_TTL_MS = 30 * 86_400_000

function secret() {
  const s = process.env.QC_AUTH_SECRET
  if (!s || s.length < 32) throw new Error('QC_AUTH_SECRET must be set to at least 32 characters')
  return s
}

const keyed = (purpose, value) => createHmac('sha256', secret()).update(`${purpose}:${value}`).digest('hex')

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()
export const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254

const adminEmails = () => new Set(String(process.env.QC_ADMIN_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean))

export async function issueLoginCode(email) {
  const since = new Date(Date.now() - CODE_WINDOW_MS)
  const recent = await db().loginCode.count({ where: { email, createdAt: { gte: since } } })
  if (recent >= MAX_CODES_PER_WINDOW) throw new HttpError(429, 'TOO_MANY_CODES', 'Too many codes requested. Try again in a few minutes.')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db().loginCode.create({ data: { email, codeHash: keyed('code', `${email}:${code}`), expiresAt: new Date(Date.now() + CODE_TTL_MS) } })
  return code
}

export async function verifyLoginCode(email, code) {
  const invalid = new HttpError(401, 'INVALID_CODE', 'That code is invalid or has expired.')
  const row = await db().loginCode.findFirst({ where: { email, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) throw invalid
  const expected = Buffer.from(row.codeHash, 'hex')
  const actual = Buffer.from(keyed('code', `${email}:${String(code ?? '').trim()}`), 'hex')
  if (!timingSafeEqual(expected, actual)) {
    await db().loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    throw invalid
  }
  // Consume exactly once even if two verifications race.
  const consumed = await db().loginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } })
  if (consumed.count !== 1) throw invalid

  return db().$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email } })
    const isAdmin = adminEmails().has(email)
    if (!user) {
      user = await tx.user.create({ data: { email, roles: isAdmin ? ['GUEST', 'ADMIN'] : ['GUEST'] } })
      await audit(tx, user.id, 'user.created', user.id, { via: 'email_code' })
    } else if (isAdmin && !user.roles.includes('ADMIN')) {
      user = await tx.user.update({ where: { id: user.id }, data: { roles: [...user.roles, 'ADMIN'] } })
      await audit(tx, user.id, 'role.granted', user.id, { role: 'ADMIN', via: 'QC_ADMIN_EMAILS' })
    }
    if (user.status !== 'ACTIVE') throw forbidden('This account is suspended.')
    const token = randomBytes(32).toString('base64url')
    await tx.session.create({ data: { userId: user.id, tokenHash: keyed('session', token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } })
    return { token, user }
  })
}

export async function authenticate(req) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const session = await db().session.findUnique({ where: { tokenHash: keyed('session', token) }, include: { user: true } })
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return null
  return { sessionId: session.id, user: session.user }
}

export function requireUser(ctx) {
  if (!ctx.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  return ctx.auth.user
}

export function requireRole(ctx, role) {
  const user = requireUser(ctx)
  if (!user.roles.includes(role)) throw forbidden(`This needs an approved ${role.toLowerCase()} account.`)
  return user
}

export async function revokeSession(sessionId) {
  await db().session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
}

export async function revokeAllSessions(tx, userId) {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
}

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, locale: u.locale, roles: u.roles, status: u.status })
