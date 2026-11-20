import test from 'node:test'
import assert from 'node:assert/strict'

function stubFetch(handler) { const calls = []; globalThis.fetch = async (url, opt) => { calls.push({ url: String(url), opt }); return handler(String(url), opt) }; return calls }
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('brevo SMS provider posts to Brevo transactional SMS with digits-only recipient', async () => {
  process.env.SMS_PROVIDER = 'brevo'; process.env.BREVO_API_KEY = 'k'; process.env.SMS_SENDER_ID = 'SYBNB'
  const calls = stubFetch(() => ok({ messageId: 42 }))
  const { sendSms, smsProviderStatus } = await import('../../server/lib/sms.mjs?b=' + Date.now())
  assert.equal(smsProviderStatus().configured, true)
  const r = await sendSms({ to: '+1 (514) 555-0101', body: 'code 123456', purpose: 'guest-login' })
  assert.equal(r.provider, 'brevo'); assert.equal(r.messageId, '42')
  assert.match(calls[0].url, /transactionalSMS\/sms$/)
  assert.equal(JSON.parse(calls[0].opt.body).recipient, '15145550101')
})

test('brevo SMS provider fails closed without sender', async () => {
  process.env.SMS_PROVIDER = 'brevo'; delete process.env.SMS_SENDER_ID
  const { sendSms } = await import('../../server/lib/sms.mjs?c=' + Date.now())
  await assert.rejects(sendSms({ to: '+15145550101', body: 'x' }), { code: 'SMS_PROVIDER_NOT_CONFIGURED' })
})

test('twilio verify start + check', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 't'; process.env.TWILIO_VERIFY_SERVICE_SID = 'VA1'
  const calls = stubFetch((url, opt) => url.endsWith('/Verifications') ? ok({ sid: 'VE1', status: 'pending' })
    : ok({ status: new URLSearchParams(opt.body).get('Code') === '654321' ? 'approved' : 'pending' }))
  const tv = await import('../../server/lib/twilio-verify.mjs?d=' + Date.now())
  const s = await tv.twilioVerifyStart('+15145550101')
  assert.equal(s.provider, 'twilio-verify'); assert.equal(s.messageId, 'VE1')
  assert.match(calls[0].url, /verify\.twilio\.com\/v2\/Services\/VA1\/Verifications$/)
  assert.equal(await tv.twilioVerifyCheck('+15145550101', '000000'), false)
  assert.equal(await tv.twilioVerifyCheck('+15145550101', '654321'), true)
})

test('twilio verify fails closed without config', async () => {
  delete process.env.TWILIO_VERIFY_SERVICE_SID
  const tv = await import('../../server/lib/twilio-verify.mjs?e=' + Date.now())
  await assert.rejects(tv.twilioVerifyStart('+15145550101'), { code: 'SMS_PROVIDER_NOT_CONFIGURED' })
})
