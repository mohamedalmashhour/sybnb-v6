import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.QC_AUTH_SECRET ??= 'x'.repeat(40)
const { reviewCodeFor } = await import('../lib/auth.mjs')

test('review account is off unless both settings are present', () => {
  delete process.env.QC_REVIEW_EMAIL; delete process.env.QC_REVIEW_CODE
  assert.equal(reviewCodeFor('review@qstay.ca'), null)
  process.env.QC_REVIEW_EMAIL = 'review@qstay.ca'
  assert.equal(reviewCodeFor('review@qstay.ca'), null)
})

test('only the review email gets the fixed 6-digit code', () => {
  process.env.QC_REVIEW_EMAIL = 'Review@QStay.ca'; process.env.QC_REVIEW_CODE = '246810'
  process.env.QC_ADMIN_EMAILS = 'admin@qc.local'
  assert.equal(reviewCodeFor('review@qstay.ca'), '246810')
  assert.equal(reviewCodeFor('someone@qstay.ca'), null)
})

test('bad code or an admin email disables it', () => {
  process.env.QC_REVIEW_EMAIL = 'review@qstay.ca'; process.env.QC_REVIEW_CODE = '1234'
  assert.equal(reviewCodeFor('review@qstay.ca'), null)
  process.env.QC_REVIEW_CODE = '246810'; process.env.QC_ADMIN_EMAILS = 'review@qstay.ca'
  assert.equal(reviewCodeFor('review@qstay.ca'), null)
})
