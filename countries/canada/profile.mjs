// SYBNB — Canada (Québec) country profile, used ONLY by the isolated QC backend (QC/server).
//
// Registered in the master API registry (server/lib/country.mjs) so one codebase serves every
// country; QC/server still loads it directly and runs with its own database, storage and secrets. Nothing here is inherited from
// countries/syria and nothing here leaks into it.
//
// Tax and fee values are configuration, NOT a compliance conclusion. Every rate below must be
// confirmed by the operator's accountant before payments are enabled (see `taxes.status`).
export const profile = Object.freeze({
  key: 'canada',
  country: 'CA',
  region: 'QC',
  displayName: { en: 'Québec, Canada', fr: 'Québec, Canada' },
  operatingEntity: { name: '9375-7649 QUÉBEC INC.', country: 'CA-QC' },

  // All money is stored as integer cents in CAD.
  currencies: { allowed: ['CAD'], default: 'CAD' },
  phoneCountryCode: '+1',
  defaultLocale: 'fr-CA',
  locales: ['fr-CA', 'en-CA'],
  // IANA zone for every Québec date rule (check-in day, cancellation cutoff, scheduled rides).
  timezone: 'America/Toronto',

  communications: { email: true, sms: false },

  // Host/driver payout methods (⚠️ payments are country settings, owner 2026-11-20; to adjust later).
  // Admin pays outside the platform and marks the request PAID, as in the master payout flow.
  payoutMethods: {
    BANK: { required: ['bankName', 'accountName', 'accountNumber'] },
  },

  // Launch gates for the master API — all closed until the Québec review passes.
  gates: {
    legal: 'DRAFT',
    payments: 'disabled',
    publicAccess: 'closed',
    deployment: 'blocked',
  },

  // Rates in basis points (1 bp = 0.01%). Applied per service in QC/server/lib/money.mjs.
  taxes: {
    status: 'PENDING_ACCOUNTANT_CONFIRMATION',
    GST: { bp: 500, account: 'GST_QST', label: { fr: 'TPS', en: 'GST' } },
    QST: { bp: 997.5, account: 'GST_QST', label: { fr: 'TVQ', en: 'QST' } },
    LODGING: { bp: 350, account: 'LODGING_TAX', label: { fr: "Taxe sur l'hébergement", en: 'Lodging tax' } },
    stays: ['LODGING', 'GST', 'QST'],
    rides: ['GST', 'QST'],
  },

  stays: {
    // Platform service fee charged to the guest, and commission withheld from the host, in bp.
    guestServiceFeeBp: 1200,
    hostCommissionBp: 300,
    fullRefundCutoffHours: 72,
    lateCancelRefundBp: 5000,
    // Stripe Checkout sessions last at least 30 minutes, so the hold matches.
    holdMinutes: 30,
    maxNights: 30,
    // Québec requires a short-term-rental registration number on every published listing.
    requireRegistrationNumber: true,
  },

  rides: {
    // Non-taxi categories only. Taxi tariffs are regulated and not offered until approved.
    categories: {
      STANDARD: { baseCents: 350, perKmCents: 95, perMinCents: 30, minimumCents: 800, seats: 4 },
      COMFORT: { baseCents: 450, perKmCents: 125, perMinCents: 40, minimumCents: 1100, seats: 4 },
      XL: { baseCents: 550, perKmCents: 160, perMinCents: 45, minimumCents: 1400, seats: 6 },
    },
    bookingFeeCents: 250,
    driverCommissionBp: 2500,
    // Average urban speed used to estimate duration until a routing provider is connected.
    estimatedKmh: 28,
    // Straight-line distance is multiplied by this to approximate road distance.
    roadFactor: 1.3,
    quoteTtlSeconds: 300,
    maxSurgeBp: 15000,
    // Bounding box for accepted pickup/drop-off points (province of Québec, approximate).
    serviceBounds: { minLat: 44.99, maxLat: 62.6, minLng: -79.8, maxLng: -57.1 },
  },

  gates: {
    legal: 'DRAFT',
    payments: 'disabled',
    publicAccess: 'closed',
    deployment: 'blocked',
  },

  externalGates: [
    'Québec short-term-rental registration (CITQ / Ministère du Tourisme) rules for platforms',
    'Remunerated passenger transportation authorization (Act respecting remunerated passenger transportation by automobile)',
    'GST/QST registration and lodging-tax collection obligations — accountant',
    'Law 25 privacy assessment, data residency and incident process',
    'Insurance for hosts, drivers and platform',
    'Payment provider onboarding (Stripe Canada) and payout compliance',
  ],
})
