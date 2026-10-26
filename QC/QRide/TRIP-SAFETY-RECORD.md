# Driver identity and trip safety history

## Delivered in QRide frontend prototype

After a sample match: driver name, vehicle make/model/year, colour and conspicuously fictional
plate `DEMO-QC-001`. The vehicle is selected from a category-specific example and snapshotted
with the trip. Before a match, no actual driver is presented as available.

Sample lifecycle: requested → driver matched → simulated boarding/start → sample route event
→ completed. A numbered UTC event timeline, vehicle snapshot, pickup/destination, sample CAD
price and state can be viewed through rider/driver/platform example views. Multiple records
are selectable. A sample safety-review event and JSON download work. Editing a later request
does not rewrite a prior trip's snapshot. State lasts only in the page; reset/reload clears it.

These views are public demonstrations with synthetic profiles, NOT authorization controls,
durable records, tamper-resistant evidence, emergency reporting or a server-audited system.
No microphone/camera/continuous GPS tracking is started. Route points are simulated, not
actual driving telemetry; they cannot be used to assess a driver's conduct. Real pickup text
entered into the prototype may appear in an explicit download; no automatic upload occurs.

Owner was asked whether recording means GPS/events, audio, or audio/video. Audio/video remains
off pending the answer and the separate Quebec privacy/legal/provider review. No default
assumption grants covert recording or automatic access to another participant's media.

## Required real implementation

1. Server-owned trip record with immutable assignment snapshot: trip ID, participant references,
   vehicle ID/make/model/year/colour/plate and qualification version at assignment. Avoid adding
   private driver ID documents or unnecessary passenger identity to the shared history.
2. Assigned-driver lifecycle authorization and boarding verification (for example an approved
   rider PIN mechanism); rider confirmation can be corroborating evidence. GPS/geofence alone
   must not prove boarding. No arbitrary client may start another person's trip.
3. Route-event collection only for an appropriate, disclosed service purpose and lifecycle.
   Record timestamp/source/accuracy and server receive time; validate order, duplicates,
   implausible data and missing GPS. Stop collection at trip end. Do not represent uncertain
   device speed or GPS deviations as proven unsafe driving.
4. Idempotent server transitions and append-only audit events with integrity/backup controls,
   durable recovery and explicit corrections rather than silent history edits. Capture quote,
   acceptance, stops, route changes, start/end, cancellations, payment/refund references and
   safety-report links without exposing provider secrets or payment-card details.
5. Rider access only to their own trips; driver access only to their assigned trips; platform
   access only for authorized safety/support roles and legitimate cases. Record who accessed
   which record, why and when. Export only the permitted fields. Role controls must be enforced
   server-side, not a frontend selector. General HR/admin access is not automatic media access.
6. Set and document purpose-specific retention, deletion, dispute/legal holds, correction/export
   handling and access logs after privacy review. Encrypt private data and use controlled,
   expiring media access if media is later approved; never publish permanent recording URLs.
7. Any audio/video feature needs its own notice, consent/other applicable legal-basis assessment,
   clear active-recording indication, participant controls, media storage/access policy and
   on-device/platform security review. Do not inherit the legacy Syria audio retention or gates
   as Quebec policy. Automatic cabin capture is not implemented by this frontend.

Existing V6 has `server/lib/ride-events.mjs`, ride telemetry and a separate gated SR audio
module. That SR module defaults capture off and exposes uploaded media to platform admins
only when attached to a safety report. Its existence is not Quebec certification or evidence
that QRide is connected to it. Review ownership, consent, retention and audit behavior before
reusing interfaces; keep Canada storage and secrets separate.

## Validation

QRide build and both-app browser checks passed. Added browser checks verify matched name,
model/plate, simulated start/route/end events, all three sample viewer modes, issue event,
JSON export, explicit media-off status and sequential event numbering. No real GPS/media
recording, production access control, permanent history or safety response was tested.
No API/schema/payment/recording flag changed. QTR remains a separate, unchanged app.
