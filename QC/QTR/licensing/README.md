# QTR — Quebec accommodation platform preparation

DRAFT — reviewed October 14, 2026 (Toronto). No application submitted or approval verified.
`evidence-register.json` separates platform questions from each property's evidence.

## Product benchmark

Use an Airbnb-style journey: destination/dates/guest count, real search results, property
details, clear CAD total and terms, booking request/confirmation, messages and trip
support. These are design targets, not delivered Airbnb-equivalent functionality.
The retrieved Airbnb Help Centre discusses accounts, reservations, cancellations and
payment methods. The attempted article URL returned generic Help Centre content, so
no Airbnb-specific Quebec legal requirement or current fee was verified from it.

## Property and platform evidence

The official Quebec registration page states that covered paid accommodation of
31 days or less must be registered. It describes obtaining official municipal zoning
conformity documentation before application, and supporting documents including
ownership evidence, civil liability insurance of at least CAD 2,000,000 per event,
and owner/condominium permissions where applicable. Registration category and local
restrictions matter; never approve a listing from a typed number alone.

| Workstream | Evidence to prepare | Current position |
|---|---|---|
| QTR platform duties | Confirm verification, display, document retention, suspension/removal and any platform registration/authorization duties | Separate qualified/authority review required; host registration is not QTR authorization |
| Each establishment | Registration/certificate, category, location, operator identity, validity/expiry and required display | No valid certificate for the demo apartment |
| Municipality | Official conformity documentation and locality/residence-specific restrictions | Not supplied; no province-wide property permission |
| Property authority/insurance | Ownership/permission evidence and applicable liability policy | Not supplied |
| Taxes/consumer terms | Applicable lodging/sales taxes, invoicing/remittance, French terms and cancellation/refund disclosures | Not configured or legally reviewed |
| Booking integrity | Real inventory/capacity, timezone/DST, atomic holds, durable confirmation and cancellation | Not connected |
| Payments/payouts | Approved sandbox, authenticated payment events, refunds, reconciliation and host statements | Not connected |
| Privacy/support | Account protection, limited document access, retention, complaint/incident workflows | Preparation only |

The nightly-price defect was corrected to "CAD quote unavailable". No invented nightly
rate or total replaces the missing Canadian quote service. The sample wallet's USD MSH
reference remains separate from CAD pricing; no automatic currency conversion.

## Sources and review handoff

- [Quebec tourist accommodation registration](https://www.quebec.ca/tourisme-loisirs-sport/hebergement-touristique/enregistrement): retrieved and relevant text reviewed October 14, 2026.
- [Airbnb Help Centre](https://www.airbnb.ca/help): product/support benchmark only; not a legal source for QTR.
- `docs/canada/QUEBEC-LAUNCH-REVIEW.md`: prior research; exact platform obligations and local rules still need review.

Keep private host/property evidence in restricted storage, not Git. Record reviewed
references and expiry, and have the authorized reviewer determine the submission
package. Code and a competitor-like interface do not confer a licence. This dossier
has not been filed, and the app is not authorized to operate publicly.
