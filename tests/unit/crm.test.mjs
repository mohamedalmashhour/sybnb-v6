import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeContactInput,
  normalizeActivityInput,
  normalizeLimit,
  isUuid,
  CRM_CONTACT_KINDS,
  CRM_ACTIVITY_KINDS,
} from '../../server/lib/crm.mjs'

const UUID = '11111111-1111-4111-8111-111111111111'

test('normalizeContactInput: minimal valid contact defaults to LEAD/NEW', () => {
  const out = normalizeContactInput({ displayName: '  Amina  ' })
  assert.equal(out.displayName, 'Amina')
  assert.equal(out.kind, 'LEAD')
  assert.equal(out.stage, 'NEW')
  assert.equal(out.email, null)
  assert.equal(out.userId, null)
  assert.equal(out.createdById, null)
})

test('normalizeContactInput: carries createdById only when a UUID', () => {
  assert.equal(normalizeContactInput({ displayName: 'A' }, { createdById: UUID }).createdById, UUID)
  assert.equal(normalizeContactInput({ displayName: 'A' }, { createdById: 'nope' }).createdById, null)
})

test('normalizeContactInput: rejects missing name', () => {
  assert.throws(() => normalizeContactInput({ displayName: '   ' }), /name is required/)
  assert.throws(() => normalizeContactInput({}), /name is required/)
})

test('normalizeContactInput: rejects unknown kind/stage', () => {
  assert.throws(() => normalizeContactInput({ displayName: 'A', kind: 'ALIEN' }), /Unknown contact kind/)
  assert.throws(() => normalizeContactInput({ displayName: 'A', stage: 'HOT' }), /Unknown contact stage/)
})

test('normalizeContactInput: validates email shape and userId UUID', () => {
  assert.throws(() => normalizeContactInput({ displayName: 'A', email: 'not-an-email' }), /Email does not look valid/)
  assert.equal(normalizeContactInput({ displayName: 'A', email: 'x@y.co' }).email, 'x@y.co')
  assert.throws(() => normalizeContactInput({ displayName: 'A', userId: '123' }), /userId must be a UUID/)
  assert.equal(normalizeContactInput({ displayName: 'A', userId: UUID }).userId, UUID)
})

test('normalizeContactInput: every declared kind is accepted', () => {
  for (const kind of CRM_CONTACT_KINDS) {
    assert.equal(normalizeContactInput({ displayName: 'A', kind }).kind, kind)
  }
})

test('normalizeActivityInput: defaults to TASK/OPEN, parses dueAt', () => {
  const out = normalizeActivityInput({ title: 'Call host' })
  assert.equal(out.kind, 'TASK')
  assert.equal(out.status, 'OPEN')
  assert.equal(out.dueAt, null)
  const due = normalizeActivityInput({ title: 'x', dueAt: '2026-12-01T00:00:00Z' })
  assert.ok(due.dueAt instanceof Date)
})

test('normalizeActivityInput: rejects empty title, bad kind, bad date', () => {
  assert.throws(() => normalizeActivityInput({ title: '' }), /title is required/)
  assert.throws(() => normalizeActivityInput({ title: 'x', kind: 'PAY' }), /Unknown activity kind/)
  assert.throws(() => normalizeActivityInput({ title: 'x', dueAt: 'yesterday' }), /not a valid date/)
})

test('normalizeActivityInput: campaign draft + source tag are money-free passthrough', () => {
  const out = normalizeActivityInput({ title: 'Winter promo', kind: 'CAMPAIGN_DRAFT', source: 'ceo:ceo_marketing_opportunity' })
  assert.equal(out.kind, 'CAMPAIGN_DRAFT')
  assert.equal(out.source, 'ceo:ceo_marketing_opportunity')
  assert.ok(CRM_ACTIVITY_KINDS.includes(out.kind))
})

test('normalizeLimit: clamps to [1,max] with fallback', () => {
  assert.equal(normalizeLimit(undefined), 50)
  assert.equal(normalizeLimit('0'), 50)
  assert.equal(normalizeLimit('-5'), 50)
  assert.equal(normalizeLimit('10'), 10)
  assert.equal(normalizeLimit('9999'), 200)
})

test('isUuid: accepts v4 uuid, rejects junk', () => {
  assert.equal(isUuid(UUID), true)
  assert.equal(isUuid('123'), false)
  assert.equal(isUuid(null), false)
})
