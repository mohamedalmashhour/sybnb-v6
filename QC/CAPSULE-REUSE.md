# Reuse existing SYBNB capsules through explicit boundaries

| Capsule | Existing source | Quebec use in this phase |
|---|---|---|
| Maps | `src/shared/maps/googleMapsClient.mjs` | Direct import in both apps; country public centre from `countries/canada/maps.public.mjs`; separate key/map-ID bindings |
| Account presentation | `apps/shared/account-capsule.mjs` | Direct import in both apps; driver/admin applications stay pending; sample sign-in only |
| Account-first contract | `src/shared/capsules/index.ts` | Preserve the rule that state changes require verified accounts; browser demo flags do not implement this production rule |
| Real authentication | `server/routes/auth.mjs`, `server/lib/session-store.mjs` | Existing session/security behavior is a reusable foundation; not connected to private Quebec apps yet; no privileged self-registration |
| Case status | `src/shared/capsules/CaseStatusCapsule.tsx` | Future backend-driven case views; do not fabricate approved/closed status from local state |
| Payment presentation | `src/modules/payments/PaymentCapsule.tsx` | Requires a Quebec payment contract and CAD adapter; legacy proof/admin flow is not automatically a Canadian card checkout |
| Ride map | `src/shared/maps/RideMap.tsx` | Do not inherit Syria fallback coordinates or dispatch assumptions |
| Checkout | `src/modules/bookings/CheckoutPage.tsx` | Reuse architecture after isolating inventory, timezone, fees, taxes, cancellation and CAD money units |
| Revenue Guard | `server/lib/revenue-guard.mjs` | Future scoped audit integration; flags require human review, never automatic penalties |

Actual runtime imports in this phase are Maps and account presentation. Other rows
are an inspected reuse plan, not delivered API integration. Original modules remain
in their shared locations: do not duplicate or mutate master-country rules to make
Quebec screens appear operational. No dependency on Uber/Airbnb code or private APIs.

## Guest-client update — 2026-10-16

Owner direction supersedes the account-first client example for rides and short-term stays: clients continue with email-code verification, without registration or passwords. QRide/QTR simulate that step only. Driver, host and admin account capsules remain in place. See `docs/architecture/GUEST-CHECKOUT.md` for the real V6 API/session contract.
