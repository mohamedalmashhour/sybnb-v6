# Wrapping — country-neutral capsules

> ## ⚠️ NOTICE — PAYMENTS AND PRICES ARE VARIABLES (owner decision 2026-11-20)
> Every payment method and every price, fee, commission, tax and fare in these capsules is a
> **country setting**, never a fixed value in code. Each country sets them in its own profile
> (`countries/<country>/capsules.profile.mjs`) and they will be adjusted later, country by country.
> The payment solution (local wallet, cards, Mada, Apple Pay, cash…) is chosen per country.
> Do not hard-code a payment method or a price in `wrapping/`, `server/` or `src/`.

Ready-made business engines that every country reuses. Only the **country profile** changes.

| Capsule | Model | What it does |
|---|---|---|
| `stays/` | Airbnb (short-term rentals) | date validation, availability, price quote (discounts, cleaning, service fee, taxes), booking states, cancellation refunds by policy tier, host cancel, payout timing, listing publication rules |
| `rides/` | Uber (on-demand rides) | service-area check, route estimate, surge, fare quote per category (+stops, booking fee, taxes), trip states, cancel fee with grace window, no-show, driver ranking, pickup ETA |
| `core/currency` | shared | change one ISO code → decimals, formatting, conversion follow |
| `core/map` | shared | map centre, zoom, service area, provider per country |
| `core/` | shared | money in minor units, tax lines, geo distance, timezone dates, strict state machine |

Rules:
- Pure functions: no database, no HTTP, no payment provider, no country values in code.
- All money is integers in the currency's minor unit; rates in basis points.
- A new country = copy `profiles/template.profile.mjs` to `countries/<country>/capsules.profile.mjs`,
  fill it in, and check it with `capsuleProfileProblems(profile)`.
- Tests: `tests/unit/wrapping-*.test.mjs`.

Next capsules (after stays + rides): food delivery, marketplace, wallet/payments adapter.
