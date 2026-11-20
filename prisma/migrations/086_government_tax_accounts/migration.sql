-- One base (2026-11-20, owner): money collected for the government (sales taxes, per-trip dues) is
-- held by the company and recorded in its own accounts, never shared with drivers/hosts, then paid
-- to the government from daily/monthly collection totals.
--   tax_collections: one row per collected amount (account GST_QST / RIDE_DUES / LODGING_TAX ...)
--   tax_remittances: one row per payment made to the government for an account and period
CREATE TABLE "tax_remittances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "country" TEXT NOT NULL,
  "account" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "reference" TEXT,
  "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "recorded_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "tax_remittances_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "tax_collections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "country" TEXT NOT NULL,
  "account" TEXT NOT NULL,
  "tax_code" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "base_minor" INTEGER NOT NULL DEFAULT 0,
  "rate_bp" DOUBLE PRECISION,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "remittance_id" UUID,
  CONSTRAINT "tax_collections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_collections_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "tax_collections_remittance_fkey" FOREIGN KEY ("remittance_id") REFERENCES "tax_remittances"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "tax_collections_source_code_key" ON "tax_collections"("source_type", "source_id", "tax_code");
CREATE INDEX "tax_collections_account_collected_idx" ON "tax_collections"("country", "account", "collected_at");
CREATE INDEX "tax_collections_remittance_idx" ON "tax_collections"("remittance_id");
