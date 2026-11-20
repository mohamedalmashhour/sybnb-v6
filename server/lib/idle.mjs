// Database idle mode (country-neutral). Lets a serverless Postgres (e.g. Neon) scale to zero when
// nobody is using the platform, instead of being kept awake 24/7 by health checks and timers.
//
// - Real traffic (any request except health/metrics/scheduler pings) marks activity.
// - After DB_IDLE_AFTER_MINUTES with no real traffic (default 10), background jobs that touch the
//   database skip their runs, except one run per job every DB_IDLE_SWEEP_MINUTES (default 60) so
//   expiries/cleanups still happen while idle.
// - The first real request after idle wakes everything immediately (callers refresh what they need).
// Set DB_IDLE_AFTER_MINUTES=0 to disable idle mode entirely (always-on behaviour, as before).

const PASSIVE_PATHS = new Set(['/api/health', '/api/health/ready', '/api/health/live', '/api/metrics', '/internal/tick'])

function minutes(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

let lastActivityAt = Date.now()
const lastIdleRun = new Map()

export function isPassivePath(pathname) { return PASSIVE_PATHS.has(pathname) }

/** Record real user/API traffic. Health checks and pingers do not count. */
export function markActivity(pathname, now = Date.now()) {
  if (pathname && isPassivePath(pathname)) return false
  lastActivityAt = now
  return true
}

export function idleAfterMs() { return minutes('DB_IDLE_AFTER_MINUTES', 10) * 60_000 }
export function idleSweepMs() { return Math.max(1, minutes('DB_IDLE_SWEEP_MINUTES', 60)) * 60_000 }

/** True when idle mode is enabled and there has been no real traffic for the idle window. */
export function isIdle(now = Date.now()) {
  const after = idleAfterMs()
  return after > 0 && now - lastActivityAt > after
}

/**
 * Gate for a database-touching background job. Active: always run. Idle: run at most once per
 * idle sweep window per job name, so the database can sleep in between.
 */
export function shouldRunJob(name, now = Date.now()) {
  if (!isIdle(now)) return true
  const last = lastIdleRun.get(name) || 0
  if (now - last < idleSweepMs()) return false
  lastIdleRun.set(name, now)
  return true
}

/** Wrap a timer callback so it respects idle mode. */
export function idleGated(name, fn) {
  return (...args) => (shouldRunJob(name) ? fn(...args) : undefined)
}

export function idleStatus(now = Date.now()) {
  return { idle: isIdle(now), lastActivityAt: new Date(lastActivityAt).toISOString(), idleAfterMinutes: idleAfterMs() / 60_000 }
}

/** Test hooks. */
export function _resetIdleForTests(now = Date.now()) { lastActivityAt = now; lastIdleRun.clear() }
