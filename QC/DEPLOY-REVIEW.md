# Q STAY / Q RIDE — test deployment for Google Play review (PLAN, awaiting owner approval)

Goal: give Google's reviewers a working, sign-in-able copy of both apps. **Test environment only**:
simulated payments, sample listings and driver, no public launch, no real money.

## What gets created (nothing exists yet)
| Piece | Where | Address |
|---|---|---|
| QC API (test) | Render web service `qc-api-review` (same workspace as SYBNB) | https://api-review.qstay.ca |
| QC database (test) | New Neon project `qc-review` — separate from SYBNB/Syria and from any future production DB | — |
| Q STAY app | Render static site `qstay-review` | https://review.qstay.ca |
| Q RIDE app | Render static site `qride-review` | https://review.qrides.ca |
| Android apps | Trusted Web Activity wrappers (Bubblewrap) of the two review URLs, package `ca.qstay.app` / `ca.qrides.app`, uploaded to Play **Internal testing** | — |

## Settings (set in Render, never in Git)
- `QC_PAYMENTS_MODE=simulated` — no Stripe keys at all.
- `QC_MAIL_MODE=resend` with a QC sender, or console if review only uses the review account.
- `QC_REVIEW_EMAIL=review@qstay.ca`, `QC_REVIEW_CODE=<6 digits, given to Google only>`.
- `QC_ADMIN_EMAILS` = owner only. Fresh `QC_AUTH_SECRET`.
- Seed: sample host, 3 listings, sample driver (`qc:seed:dev`), clearly marked as demo.

## Owner actions / approvals needed
1. Approve creating the 3 Render services and the Neon project (small monthly cost; Render
   starter ≈ US$7/month for the API, static sites free; Neon free tier).
2. Approve 3 DNS records in GoDaddy (CNAME `review` on qstay.ca and qrides.ca, `api-review` on qstay.ca).
3. Android signing key: generated on your computer, kept by you (never in Git or cloud); Play App
   Signing holds the release key.

## After review
Unset `QC_REVIEW_EMAIL` / `QC_REVIEW_CODE` (or keep for future updates). The public launch stays
blocked until CTQ, Revenu Québec, CITQ, insurance and the privacy policy are approved.
