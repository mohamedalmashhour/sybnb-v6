// Outgoing email. QC_MAIL_MODE: 'resend' (real, needs QC_RESEND_API_KEY + QC_MAIL_FROM),
// 'console' (dev default: prints to stdout) or 'memory' (tests read `outbox`).
export const outbox = []

export async function sendMail({ to, subject, text }) {
  const mode = process.env.QC_MAIL_MODE || 'console'
  if (mode === 'memory') {
    outbox.push({ to, subject, text, at: new Date() })
    return
  }
  if (mode === 'console') {
    console.log(`[qc-mail] to=${to} subject=${JSON.stringify(subject)}\n${text}`)
    return
  }
  if (mode !== 'resend') throw new Error(`Unknown QC_MAIL_MODE '${mode}'`)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.QC_RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.QC_MAIL_FROM, to, subject, text }),
  })
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`)
}
