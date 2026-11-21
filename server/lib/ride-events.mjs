// Safety Phase 1 (2026-10-10): the writer for the immutable trip "black box" (see
// prisma/schema.prisma model RideEvent). Every meaningful moment of a ride -- created, offered,
// accepted, each driver status change, an SOS -- is appended here with who/when/where so a trip can
// be reconstructed exactly after the fact.
//
// CONTRACT: best-effort audit. Writing an event must NEVER break (or roll back) the ride action it
// records. logRideEvent takes an explicit Prisma client so a caller can either (a) pass a live
// `tx` to make the event part of a surrounding transaction, or (b) pass `db()` to write it
// standalone/out-of-band. It catches and logs its own errors and returns the created row or null;
// it never throws. logRideEventSafe is the same thing with an even louder "cannot throw" guarantee
// for fire-and-forget call sites (`void logRideEventSafe(...)`).
import { log } from './logger.mjs'

// Keep metadata to plain JSON and bounded -- this is an audit sink, not a blob store. A non-object
// meta is coerced to {} rather than rejected, because a logging call must never be the thing that
// throws.
function safeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  return meta
}

export async function logRideEvent(client, { rideId, type, actorId = null, actorRole = null, lat = null, lng = null, meta = {}, createdAt = null } = {}) {
  try {
    if (!client || !rideId || !type) return null
    return await client.rideEvent.create({
      data: {
        rideId,
        type,
        actorId: actorId ?? null,
        actorRole: actorRole ?? null,
        lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : null,
        lng: typeof lng === 'number' && Number.isFinite(lng) ? lng : null,
        meta: safeMeta(meta),
        // Only set for fixes buffered offline and uploaded later: they keep the time they were recorded.
        ...(createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
      },
    })
  } catch (error) {
    // Swallow: a failed audit write must not break the ride flow that triggered it.
    log.warn('ride_event_log_failed', {
      rideId,
      type,
      code: error?.code,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// Convenience wrapper for fire-and-forget call sites. Identical behaviour (logRideEvent already
// swallows), kept as a named export so intent reads clearly at the call site and any future
// pre/post handling has one home.
export async function logRideEventSafe(client, payload) {
  try {
    return await logRideEvent(client, payload)
  } catch {
    return null
  }
}

// Black-box retention (owner 2026-11-20): a trip's recording (route pings + trip events) is kept for
// 7 days after the trip ends. Any problem must be raised in that week: a ride with a safety report /
// incident, or a dispute, is kept (safety hold). The ride itself, its receipt and its tax records
// (6 years, Revenu Québec) are separate and never deleted here. Best-effort; never throws.
export const BLACK_BOX_RETENTION_DAYS = 7
export async function purgeExpiredRideEvents(client, { now = new Date(), limit = 500 } = {}) {
  try {
    const cutoff = new Date(now.getTime() - BLACK_BOX_RETENTION_DAYS * 864e5)
    const res = await client.$executeRaw`
      DELETE FROM ride_events e
       WHERE e.ride_id IN (
         SELECT r.id FROM ride_requests r
          WHERE r.status IN ('COMPLETED', 'CANCELLED')
            AND r.updated_at < ${cutoff}
            AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.ride_id = r.id::text)
            AND NOT EXISTS (SELECT 1 FROM ride_events d WHERE d.ride_id = r.id AND d.type IN ('DISPUTED', 'SOS'))
            AND EXISTS (SELECT 1 FROM ride_events x WHERE x.ride_id = r.id)
          LIMIT ${limit}
       )`
    return { purged: Number(res) || 0 }
  } catch (error) {
    log.warn('ride_events_purge_failed', { message: error instanceof Error ? error.message : String(error) })
    return { purged: 0 }
  }
}
