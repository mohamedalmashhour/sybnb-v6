// CRM pure helpers (validation + normalization). No I/O, no money, no sending.
//
// These are the money-free building blocks shared by the CRM routes (server/routes/crm.mjs) and the
// CEO advisor (server/lib/ceo-advisor.mjs). Keeping them pure makes them unit-testable without a
// database and guarantees nothing here can charge, pay, refund or send: it only validates and shapes
// data. Marketing consent is NEVER decided here — a contact's marketingOptInAt is a display mirror,
// and any real send must re-read the live LegalConsent record elsewhere.

export const CRM_CONTACT_KINDS = Object.freeze(['LEAD', 'GUEST', 'HOST', 'DRIVER', 'SELLER', 'MERCHANT', 'BUSINESS'])
export const CRM_CONTACT_STAGES = Object.freeze(['NEW', 'ACTIVE', 'DORMANT', 'CHURNED'])
export const CRM_ACTIVITY_KINDS = Object.freeze(['NOTE', 'TASK', 'FOLLOW_UP', 'CAMPAIGN_DRAFT'])
export const CRM_ACTIVITY_STATUSES = Object.freeze(['OPEN', 'DONE', 'CANCELLED'])

export const CRM_CONTACT_NAME_MAX = 160
export const CRM_NOTES_MAX = 4000
export const CRM_ACTIVITY_TITLE_MAX = 200
export const CRM_ACTIVITY_BODY_MAX = 4000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Deliberately conservative: a shape check for display, not an RFC-5322 validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fieldError(message, code = 'CRM_VALIDATION') {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function cleanString(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw fieldError('Text fields must be strings.')
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Validate + normalize the body of "create contact". Returns a plain object ready for Prisma create.
// Throws a 400 (expose:true) on any bad field. Never trusts stage/consent beyond the allowed enums.
export function normalizeContactInput(body, { createdById = null } = {}) {
  if (!body || typeof body !== 'object') throw fieldError('A contact object is required.')

  const displayName = cleanString(body.displayName)
  if (!displayName) throw fieldError('A contact name is required.')
  if (displayName.length > CRM_CONTACT_NAME_MAX) throw fieldError('Contact name is too long.')

  const kind = body.kind === undefined || body.kind === null ? 'LEAD' : String(body.kind)
  if (!CRM_CONTACT_KINDS.includes(kind)) throw fieldError('Unknown contact kind.')

  const stage = body.stage === undefined || body.stage === null ? 'NEW' : String(body.stage)
  if (!CRM_CONTACT_STAGES.includes(stage)) throw fieldError('Unknown contact stage.')

  const email = cleanString(body.email)
  if (email && !EMAIL_RE.test(email)) throw fieldError('Email does not look valid.')
  if (email && email.length > 320) throw fieldError('Email is too long.')

  const phone = cleanString(body.phone)
  if (phone && phone.length > 40) throw fieldError('Phone is too long.')

  const regionKey = cleanString(body.regionKey)
  if (regionKey && regionKey.length > 80) throw fieldError('Region is too long.')

  const notes = cleanString(body.notes)
  if (notes && notes.length > CRM_NOTES_MAX) throw fieldError('Notes are too long.')

  let userId = null
  if (body.userId !== undefined && body.userId !== null && body.userId !== '') {
    if (!isUuid(body.userId)) throw fieldError('userId must be a UUID.')
    userId = body.userId
  }

  return {
    displayName,
    kind,
    stage,
    email,
    phone,
    regionKey,
    notes,
    userId,
    createdById: isUuid(createdById) ? createdById : null,
  }
}

// Validate + normalize the body of "add activity". `kind` defaults to TASK. `source` lets the CEO
// advisor tag the origin (e.g. "ceo:ceo_employer_churn"); it never implies a money or send action.
export function normalizeActivityInput(body, { createdById = null } = {}) {
  if (!body || typeof body !== 'object') throw fieldError('An activity object is required.')

  const title = cleanString(body.title)
  if (!title) throw fieldError('An activity title is required.')
  if (title.length > CRM_ACTIVITY_TITLE_MAX) throw fieldError('Activity title is too long.')

  const kind = body.kind === undefined || body.kind === null ? 'TASK' : String(body.kind)
  if (!CRM_ACTIVITY_KINDS.includes(kind)) throw fieldError('Unknown activity kind.')

  const bodyText = cleanString(body.body)
  if (bodyText && bodyText.length > CRM_ACTIVITY_BODY_MAX) throw fieldError('Activity body is too long.')

  const source = cleanString(body.source)
  if (source && source.length > 120) throw fieldError('Source tag is too long.')

  let dueAt = null
  if (body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== '') {
    const parsed = new Date(body.dueAt)
    if (Number.isNaN(parsed.getTime())) throw fieldError('dueAt is not a valid date.')
    dueAt = parsed
  }

  return {
    title,
    kind,
    body: bodyText,
    source,
    dueAt,
    status: 'OPEN',
    createdById: isUuid(createdById) ? createdById : null,
  }
}

// Clamp a list page size to a safe range.
export function normalizeLimit(raw, { fallback = 50, max = 200 } = {}) {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}
