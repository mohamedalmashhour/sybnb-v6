# Québec platform (QC)

Canada/Québec stack, separate from the V6 Syria platform: its own API, database and secrets.

**One base (owner direction 2026-11-20):** QC pricing and calendar rules now run on the shared,
country-neutral capsules in `wrapping/` (stays = Airbnb model, rides = Uber model), configured by
`countries/canada/profile.mjs` through `countries/canada/capsules.profile.mjs`. `server/lib/money.mjs`
and `server/lib/dates.mjs` are thin adapters with the same response shapes. Still separate for now:
the QC database/schema, routes and the QTR/QRide apps — they fold into the master in later phases.
⚠️ Payments and prices are variables, set per country in the profile — never in code.

- `server/` — QC API (rides + stays). See `server/README.md`.
- `QTR/` — short-term stays app (guests, hosts, admin). Port 5191.
- `QRide/` — rides app (riders, drivers, admin). Port 5190.
- `shared/` — API client, email-code sign-in, applications and admin review used by both apps.

## Run everything locally

```sh
npm run qc:db:generate && npm run qc:db:migrate   # once
npm run qc:seed:dev                               # optional sample host, listings, driver
npm run qc:api                                    # API on 127.0.0.1:3061
npm run qtr:dev                                   # http://127.0.0.1:5191
npm run qride:dev                                 # http://127.0.0.1:5190
```

Sign-in is by email code. In dev (`QC_MAIL_MODE=console`) the code is printed in the
`qc:api` terminal. Emails listed in `QC_ADMIN_EMAILS` get the admin role. Seeded accounts:
`host@qc.local` (host) and `driver@qc.local` (driver).

The apps call `VITE_QC_API_URL` (default `http://127.0.0.1:3061`); the API must list the app
origins in `QC_CORS_ORIGINS`. Google Maps needs per-app restricted browser keys
(`VITE_GOOGLE_MAPS_BROWSER_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`); without them, places are chosen
from the built-in list, "use my location", or typed as `lat, lng`.

## Still closed

Payments: `simulated` for dev, or `stripe` with sandbox test keys (see `server/README.md`); live keys
are refused. No deployment, public access or live licence exists. Tax/fee rates await accountant
confirmation; CITQ, passenger-transport authorization, insurance and Law 25 reviews are owner
actions. Licensing preparation: `QRide/licensing/`, `QTR/licensing/`.
Store identity documents and credentials outside Git.
