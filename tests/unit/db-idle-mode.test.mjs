import test from 'node:test'
import assert from 'node:assert/strict'
import { markActivity, isIdle, shouldRunJob, idleGated, isPassivePath, _resetIdleForTests } from '../../server/lib/idle.mjs'
import { startClockSync, _resetClockForTests, securityTimeStatus } from '../../server/lib/authz/clock.mjs'

const MIN = 60_000

test('health checks and pingers never count as activity', () => {
  const t0 = 1_000_000_000
  _resetIdleForTests(t0)
  for (const p of ['/api/health', '/api/health/ready', '/api/health/live', '/api/metrics', '/internal/tick']) {
    assert.equal(isPassivePath(p), true)
    assert.equal(markActivity(p, t0 + 30 * MIN), false)
  }
  assert.equal(isIdle(t0 + 30 * MIN), true, 'only passive traffic -> idle')
  assert.equal(markActivity('/api/listings', t0 + 30 * MIN), true)
  assert.equal(isIdle(t0 + 31 * MIN), false, 'real traffic wakes it')
})

test('idle after 10 minutes by default; jobs run once per idle hour', () => {
  const t0 = 2_000_000_000
  _resetIdleForTests(t0)
  assert.equal(isIdle(t0 + 9 * MIN), false)
  assert.equal(shouldRunJob('sweep', t0 + 5 * MIN), true, 'active -> always runs')
  assert.equal(isIdle(t0 + 11 * MIN), true)
  assert.equal(shouldRunJob('sweep', t0 + 11 * MIN), true, 'first idle run allowed')
  assert.equal(shouldRunJob('sweep', t0 + 20 * MIN), false, 'skipped inside the idle window')
  assert.equal(shouldRunJob('other', t0 + 20 * MIN), true, 'windows are per job')
  assert.equal(shouldRunJob('sweep', t0 + 72 * MIN), true, 'runs again after an hour')
})

test('DB_IDLE_AFTER_MINUTES=0 disables idle mode', () => {
  const prev = process.env.DB_IDLE_AFTER_MINUTES
  process.env.DB_IDLE_AFTER_MINUTES = '0'
  try {
    _resetIdleForTests(0)
    assert.equal(isIdle(10_000 * MIN), false)
    let n = 0; const g = idleGated('x', () => { n++ })
    g(); g(); assert.equal(n, 2)
  } finally { if (prev === undefined) delete process.env.DB_IDLE_AFTER_MINUTES; else process.env.DB_IDLE_AFTER_MINUTES = prev }
})

test('clock sync: start-up sample always runs; periodic samples pause when shouldRun() is false', async () => {
  _resetClockForTests()
  let calls = 0
  const client = { $queryRaw: async () => { calls++; return [{ t: new Date() }] } }
  const h = startClockSync(client, { intervalMs: 3_600_000, shouldRun: () => false })
  await h.first
  assert.equal(calls, 1, 'first sample ignores idle')
  assert.equal(securityTimeStatus().ready, true)
  await h.run()
  assert.equal(calls, 1, 'idle -> no extra database sample')
  h.stop()
})
