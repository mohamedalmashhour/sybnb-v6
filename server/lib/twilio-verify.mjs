// Twilio Verify adapter (SMS one-time codes in Canada/US without registering our own sender number:
// Twilio Verify uses its own pre-approved sender pool). Twilio generates and checks the code, so the
// OTP engine stores a marker instead of a code hash when this provider is used.
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
export const TWILIO_VERIFY_MARKER = 'twilio-verify'

function cfg() {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, service = process.env.TWILIO_VERIFY_SERVICE_SID
  if (!sid || !token || !service) {
    const error = new Error('SMS provider is not configured for live delivery.')
    error.statusCode = 503; error.code = 'SMS_PROVIDER_NOT_CONFIGURED'; error.expose = true
    throw error
  }
  return { service, auth: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` }
}

export function twilioVerifyConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID)
}

async function call(path, params) {
  const { service, auth } = cfg()
  const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: auth },
    body: new URLSearchParams(params),
  })
  let data = {}
  try { data = await res.json() } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data }
}

// Start an SMS verification. Returns { provider, messageId, delivered }.
export async function twilioVerifyStart(to, locale) {
  const r = await call('Verifications', { To: to, Channel: 'sms', ...(locale ? { Locale: locale } : {}) })
  if (!r.ok) {
    const error = new Error('SMS provider rejected the message.')
    error.statusCode = 502; error.code = 'SMS_SEND_FAILED'; error.detail = `twilio-verify ${r.data.code || r.status}`; error.expose = true
    throw error
  }
  return { provider: TWILIO_VERIFY_MARKER, messageId: r.data.sid || `tv-${Date.now()}`, delivered: true }
}

// Check a code. Returns true only when Twilio says "approved".
export async function twilioVerifyCheck(to, code) {
  const r = await call('VerificationCheck', { To: to, Code: String(code) })
  return r.ok && r.data.status === 'approved'
}
