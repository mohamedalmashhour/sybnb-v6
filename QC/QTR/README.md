# QTR Québec

Private short-term-rental app folder, separate from `QC/QRide`. Frontend prototype only;
no real accounts, inventory, payments, employee records or bookings are stored. CAD prices
and payments are the agreed sandbox direction, with an optional separate USD MSH reference.

From the root checkout with Node 24 and existing lockfile dependencies:

```sh
npm run qtr:dev
npm run qtr:build
```

Local server: loopback only, strict port 5191. Build: `QC/QTR/dist`. QRide uses a different
entry/port/build and has no stays/host navigation; QTR has no rider/driver navigation.

This demo has stay search, sample customer account steps, simulated payment actions, host
sample sign-in/registration and document-review screens, and a public example of admin HR.
It is not the authenticated V6 admin interface. No external AI requests or payment processing.
No real personal credentials/documents should be entered.
The shared in-app Google Maps capsule can set search coordinates after restricted browser
key/map ID configuration. See `../GOOGLE-MAPS.md`; live provider verification remains pending.
The real service needs backend
authentication and role permissions, persistent reservations/calendar concurrency, verified
property registration/locality/insurance, correct taxes, timezone rules, payment and refund
processing, incident support and a separately approved release. Account/booking state is lost
on reload. No auth/account/database is shared with QRide by this prototype.

Folder separation and `private: true` prevent neither unauthorized file access nor web access
by themselves. No public host, deployment or repository publication was created. Future
deployment needs access controls; future backend reuse must not mix financial/customer data
without an explicitly approved architecture. Build artifacts and secrets must remain separate.

Licensing preparation: see `licensing/README.md` and `licensing/evidence-register.json`.
Sequential implementation plan: `../IMPLEMENTATION-ORDER.md`.
