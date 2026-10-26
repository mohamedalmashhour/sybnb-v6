# QRide Québec

Dedicated Quebec ride-app entry point in the SYBNB V6 workspace. This first delivery is a
runnable frontend prototype; it is NOT connected to real authentication, dispatch or payments.
Owner-confirmed: Quebec-wide target; CAD prices/payments, optional USD MSH reference. STR is
a separate service, and Syrian yellow taxis are not selectable in the Quebec app.

From the repository root, using Node 24 and existing lockfile dependencies:

```sh
npm run qride:dev
npm run qride:build
```

The server binds loopback only on port 5190; strict port selection never kills another process.
The build produces `QC/QRide/dist`. The web manifest supplies QRide name/theme; it is not an
App Store submission or a claim that mobile installation criteria have all been certified.

Current interactions: rider sample sign-in/registration, pickup/manual location/Google Maps
handoff, car categories and Quebec taxi concept, sample capped CAD quotes, scheduled date/time,
driver sample account access, simulated wallet actions, advisory HR example and reset.
No real credentials should be entered. No accounts, documents, quotes or reservations persist.
Admin screens are public examples only; actual V6 `/admin/hr` remains separately authenticated.
Matched driver/car/plate and a sample trip-event timeline are available in Trip history;
see `TRIP-SAFETY-RECORD.md`. No audio/video or continuous GPS recording occurs.

The in-app Google Maps capsule supports pin selection when its restricted browser key/map ID
are configured (see `../GOOGLE-MAPS.md`). Live provider verification is pending; autocomplete,
server routes and traffic-based prices are not connected. Dates use the Montreal example timezone; other Quebec localities need their own
timezone rules. Taxi tariffs, taxes, fees, operating permissions and insurance are not implemented
as approved live policies. The Canadian country is still unregistered in the V6 API.

Next backend phases: isolated Canada database/storage/config; verified customer and driver
authentication; qualified-driver onboarding; server-authoritative cent-based expiring quotes;
persisted scheduled ride state and dispatch; payment-provider sandbox/webhook/reconciliation;
incident/support operations and admin permissions. Real customer funds, withdrawals and public
deployment remain blocked pending separate reviews. See `docs/canada/QUEBEC-LAUNCH-REVIEW.md`
and `docs/strategy/QUEBEC-SYRIA-EXPANSION.md` for evidence and remaining release conditions.

This dedicated entry replaces the mixed ride/stay concept for the QRide brand. The earlier
`docs/prototypes/quebec` remains a historical combined-platform prototype, not a second backend.

Licensing preparation: see `licensing/README.md` and `licensing/evidence-register.json`.
Sequential implementation plan: `../IMPLEMENTATION-ORDER.md`.
