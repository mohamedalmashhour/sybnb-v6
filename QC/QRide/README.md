# QRide Québec — rides

Connected to the QC API (`../server`). Port 5190 (`npm run qride:dev`, build: `npm run qride:build`).

- **Riders:** pickup/destination from the place list, "use my location", the map or `lat, lng`;
  Standard / Comfort / XL; server price with GST and QST held for 5 minutes; ride now or schedule
  (30 min–30 days, Québec time); live status that updates by itself (driver, car, plate); cancel;
  ride history with the timestamped trip record (`TRIP-SAFETY-RECORD.md`).
- **Drivers:** application (licence, insurance, vehicle) → admin approval; go online/offline with a
  position; nearest requests with earnings; accept (only one driver can win), arrived, start,
  complete, or release; earnings after commission. Expired licence or insurance blocks driving.
- **Admin** (`QC_ADMIN_EMAILS`): approve/reject drivers; recent rides with step counts.

Taxi service is not offered (regulated tariffs). Distance is estimated (straight line × 1.3) until
a routing provider is connected. See `../README.md` for running the stack.
Licensing preparation: `licensing/README.md` and `licensing/evidence-register.json`.
