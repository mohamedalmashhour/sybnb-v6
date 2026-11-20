-- One base (2026-11-20): optional sales-tax registration numbers on the driver profile. Required only
-- where the country setting says so (Québec: drivers must be GST/QST-registered before the first trip,
-- and the platform shows the QST number to the rider). Nullable: no existing row or country changes.
ALTER TABLE "driver_profiles" ADD COLUMN "sales_tax_numbers" JSONB;
