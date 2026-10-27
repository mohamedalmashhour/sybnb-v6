# QC API (Québec rides + stays)

Isolated backend for QRide (SR) and QTR (STR). Its own process, Postgres database, secrets and
Prisma client; configured by `countries/canada/profile.mjs`. It never reads V6 `DATABASE_URL`.

```sh
cp QC/server/.env.example QC/server/.env   # fill QC_AUTH_SECRET, QC_ADMIN_EMAILS
createdb qc_dev && createdb qc_test
npm run qc:db:generate
npm run qc:db:migrate                      # applies to QC_DATABASE_URL
npm run qc:api                             # http://127.0.0.1:3061
npm run qc:test                            # end-to-end tests against QC_TEST_DATABASE_URL
npm run qc:seed:dev                        # sample host + 3 listings, sample driver (dev only)
```

## What is real

- Email-code sign-in (no passwords), hashed codes/tokens, 30-day bearer sessions, suspension revokes all sessions.
- Host and driver applications reviewed by an admin; the server rejects unapproved drivers and drivers with expired licence or insurance.
- Listings: draft → review (Québec registration number + photo required) → published; editing guest-facing fields sends it back to review.
- Stays: search by city/dates/guests, server-side CAD quotes (lodging tax, GST, QST, service fee, host payout), 15-minute holds, per-listing locking plus a Postgres exclusion constraint so nights can never be double-booked, host calendar blocks, guest/host cancellation with the 72-hour refund rule in Québec time.
- Rides: server-issued expiring quotes inside Québec, single-use quotes, scheduled rides, nearest-first offers, atomic single-winner accept, one active ride per driver (DB index), arrive/start/complete, append-only trip safety record, driver earnings.
- Admin: application decisions, listing publish/reject/suspend, user suspension, ride and audit views. Audit log is append-only.

## Not done yet

- **Payments.** `POST /api/bookings/:id/confirm` refuses with `PAYMENTS_DISABLED` unless `QC_PAYMENTS_MODE=simulated` (blocked in production). Next: Stripe Canada test-mode checkout, webhooks, refunds, host/driver payouts. Ride payment capture is not wired.
- Routing: ride distance is straight line × 1.3; a routing provider replaces it later.
- Photo upload/storage (listings take https URLs for now), messaging, reviews, push notifications.
- Tax rates, fees and commissions are configuration marked `PENDING_ACCOUNTANT_CONFIRMATION`, not compliance conclusions. Licensing (CITQ registration rules, remunerated passenger transportation authorization), insurance and Law 25 reviews are owner actions.
