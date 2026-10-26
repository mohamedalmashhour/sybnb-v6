# QRide — Quebec transport authorization preparation

DRAFT — reviewed October 14, 2026 (Toronto). No application submitted or approval verified.
`evidence-register.json` tracks missing evidence; it cannot enable dispatch or launch.

## Product benchmark

Uber's official Montreal page shows destination entry, ride options, advance reservation
and CA$ fare examples. QRide uses those journey patterns with its own identity; no
competitor fare, commission, service guarantee, authorization or insurance is inherited.
Our categories, fares and matched drivers remain fictional. The owner-directed 15%
commission is a product proposal; its base/tax treatment needs approval.

## Authority and evidence route

| Workstream | Evidence to prepare | Current position |
|---|---|---|
| Operator/intermediary route | Written CTQ/MTMD confirmation of the model, application route, applicant details, fees and ongoing reporting | Not confirmed; do not assume every ride intermediary needs the same authorization |
| Applicant | Legal identity, NEQ, address, authorized signatory and control structure where required | Company documents not verified here |
| Drivers | Correct qualified-driver route, licence, screening/training documentation, review and expiry controls | Screens only; no real approved drivers |
| Vehicles | Eligibility, registration, qualification/inspection evidence and major-defect/daily inspection controls | Screens only; no approved vehicles |
| Insurance | Our own policy/insurer confirmation covering available, pickup and occupied-trip states | Missing; Uber/Lyft policies do not cover QRide |
| Tax/billing | Confirm GST/QST, mandatory billing/SRS and operator arrangement obligations with Revenu Québec | Requirements/integration not certified |
| Coverage | Municipality/airport-specific evidence and pickup-zone restrictions | Quebec-wide target does not approve every zone |
| Safety/privacy | Incident handling, authorized record access, retention, complaint response, privacy/security and French-language review | Draft architecture; no continuous recording authorization implied |
| Operational evidence | Server eligibility blocks, expiring quotes, atomic dispatch, receipts/refunds, reconciliation, audits and failure/recovery checks | Backend integration and release blockers remain |

SAAQ states that a qualified driver is authorized by SAAQ or registered with an
operator authorized for that route. Its authorized-driver information lists Class 5+
licence, non-probationary driving experience, French ability, specified judicial-record
documents and recognized training/test. These are route-specific: confirm the route
before turning requirements into hardcoded admission rules. SAAQ also describes
pre-shift component checks and major defects. Do not replace evidence with a checkbox.

## Source register

Retrieved and relevant text reviewed on the date above:

- [SAAQ drivers](https://saaq.gouv.qc.ca/en/transportation-passengers/remunerated-passenger-transportation-automobile/drivers)
- [SAAQ qualified vehicles](https://saaq.gouv.qc.ca/en/transportation-passengers/remunerated-passenger-transportation-automobile/owners)
- [Uber Montreal — product benchmark only](https://www.uber.com/global/en/r/cities/montreal-qc-ca/)

The SAAQ page points to CTQ for the operator list. The exact QRide operator application,
fees and acceptance remain for direct authority confirmation; no CTQ application was
submitted. Tax/insurance details in `docs/canada/QUEBEC-LAUNCH-REVIEW.md` are earlier
research and must be revalidated for our entity and model before filing.

## Handoff to the authorized reviewer

Supply evidence references, reviewer identity, review date and expiry where applicable
in a restricted case system; do not commit personal documents. Counsel/authority/insurer
review must resolve the register's open questions and determine the actual application
package. Product code is supporting evidence, not a transport licence. Submission,
public deployment and live funds require their own authorized step.
