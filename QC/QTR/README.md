# QTR Québec — short-term stays

Connected to the QC API (`../server`). Port 5191 (`npm run qtr:dev`, build: `npm run qtr:build`).

- **Guests:** search by city, dates and guests; listing page with unavailable dates; itemized CAD
  quote (lodging tax, GST, QST, service fee); email-code sign-in; 15-minute hold; payment
  (simulated until Stripe is enabled); bookings list; cancellation with the 72-hour policy.
- **Hosts:** application → admin approval; create/edit listings (CITQ number, location via map or
  coordinates, price, cleaning fee, minimum nights, amenities, photo URLs); submit for review;
  calendar with date blocks; confirmed bookings with payout; host cancellation (full refund).
- **Admin** (`QC_ADMIN_EMAILS`): approve/reject hosts, publish/reject listings, suspend published ones.

Photos are https URLs for now (no upload/storage yet). See `../README.md` for running the stack.
Licensing preparation: `licensing/README.md` and `licensing/evidence-register.json`.
