# QC organization phase validation

Toronto date: October 14, 2026. Code/source candidate: `985a931`.

## Exact change boundary

- Moved tracked `apps/qride/` files to `QC/QRide/`, then built QRide successfully.
- Moved tracked `apps/qtr/` files to `QC/QTR/`, then built QTR successfully.
- Updated root app npm scripts, account-capsule imports, narrowly allowed shared dev
  directory, app/browser runner paths and current setup documentation.
- QTR's malformed `1— USD` nightly placeholder now says CAD quote unavailable.
  No sample rate, real quote, conversion or ledger semantics was introduced.
- Added separate draft licensing evidence registers, source-backed preparation notes,
  capsule reuse inventory and sequential implementation plan.
- Shared capsules remain in their original locations and are imported, not duplicated.
  No server/src/prisma/countries runtime file changed, no database migration, no
  country activation and no private evidence/keys copied. Private app source movement
  does not establish storage/access isolation for future real customers.

## Checks

- QRide and QTR builds from root npm scripts: passed.
- Both per-app prefix build commands: passed.
- Built-app browser walkthroughs: passed, including role application/sign-in/sign-out,
  admin gating, ride/schedule/history, stay date validation and corrected CAD placeholder.
- Mocked Maps regression: passed in both apps, including separate public configuration,
  opt-in loading, pin selection, location sync, error handling and cleanup.
- Exported standalone preview checks: passed, including pending admin applications.
- Isolated helper preparation: 72 root unit tests passed, zero failures; main V6 build passed.
- Full governed suite completed with exit 12. The same 12 failing suite names remain:
  sr-geocoding, presentation, legal, payment-policy-enforcement, listing-approval-code,
  marketplace, cars, buy, new-construction, sell, advertising, sr-ride-pooling.
  These remain unresolved release blockers. The API snapshot excludes QC/app frontends;
  the separate app builds/browser checks supply their evidence.

## Outstanding and rollback

Live Maps still requires per-app restricted browser keys/map IDs. Canadian backend
sessions, authorization, quotes, dispatch/inventory, bookings and provider payments
are not connected. All evidence registers are draft/unapproved; no licence application
was submitted. The legal/insurance/tax reviews remain required for the applicable model.

Rollback: revert `985a931` preserving later user changes; this restores the earlier app
paths and placeholder. No migration is needed. Protected historical rollback commits
remain reachable. Source remains local to this cloud checkout, not installed on the Mac
or publicly deployed. Updated startup paths were saved to the cloud configuration draft;
saving does not apply configuration or publish a new environment.

Next phase: QRide's isolated Canadian backend boundary and persistent account
applications/approved provisioning. QTR follows the ordered milestones in
`IMPLEMENTATION-ORDER.md`; no operating authorization follows from this preparation.
