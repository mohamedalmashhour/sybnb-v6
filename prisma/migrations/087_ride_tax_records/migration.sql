-- One base (2026-11-20, owner + Revenu Québec): a permanent copy of every bill for rides in a country
-- that keeps tax records (Québec). One row per completed ride (COMPLETED) or charged cancellation
-- (CANCELLATION), naming the driver and the client (ids + names snapshotted, no FK, so the record
-- survives account deletion). Append-only and kept at least 6 years after the end of the year
-- (Revenu Québec: registers/bills kept six years after the last year they cover).
CREATE TABLE "ride_tax_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "country" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ride_id" TEXT NOT NULL,
  "driver_id" TEXT,
  "driver_name" TEXT,
  "driver_gst_number" TEXT,
  "driver_qst_number" TEXT,
  "rider_id" TEXT NOT NULL,
  "rider_name" TEXT,
  "currency" TEXT NOT NULL,
  "fare_minor" INTEGER NOT NULL DEFAULT 0,
  "cancellation_fee_minor" INTEGER NOT NULL DEFAULT 0,
  "dues_minor" INTEGER NOT NULL DEFAULT 0,
  "gst_minor" INTEGER NOT NULL DEFAULT 0,
  "qst_minor" INTEGER NOT NULL DEFAULT 0,
  "total_minor" INTEGER NOT NULL,
  "driver_payout_minor" INTEGER NOT NULL DEFAULT 0,
  "platform_commission_minor" INTEGER NOT NULL DEFAULT 0,
  "trip" JSONB NOT NULL DEFAULT '{}',
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "retain_until" DATE NOT NULL,
  CONSTRAINT "ride_tax_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ride_tax_records_kind_check" CHECK ("kind" IN ('COMPLETED', 'CANCELLATION'))
);
CREATE UNIQUE INDEX "ride_tax_records_ride_kind_key" ON "ride_tax_records"("ride_id", "kind");
CREATE INDEX "ride_tax_records_country_issued_idx" ON "ride_tax_records"("country", "issued_at");
CREATE INDEX "ride_tax_records_driver_idx" ON "ride_tax_records"("driver_id", "issued_at");
CREATE INDEX "ride_tax_records_rider_idx" ON "ride_tax_records"("rider_id", "issued_at");

CREATE OR REPLACE FUNCTION ride_tax_records_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ride_tax_records is append-only (% refused): tax records are kept for Revenu Québec', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ride_tax_records_append_only_trg
  BEFORE UPDATE OR DELETE ON ride_tax_records
  FOR EACH ROW EXECUTE FUNCTION ride_tax_records_append_only();
