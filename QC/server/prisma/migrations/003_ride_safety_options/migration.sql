-- Q RIDE: Premium/Electric categories, pet/accessible options, pickup PIN, trip sharing,
-- two-way ratings and tips (owner 2026-11-21: bring the store-listed features to the Québec app).
ALTER TYPE "qc_ride_category" ADD VALUE IF NOT EXISTS 'PREMIUM';
ALTER TYPE "qc_ride_category" ADD VALUE IF NOT EXISTS 'GREEN';

ALTER TABLE "qc_rides"
  ADD COLUMN "pet" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accessible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pickup_pin" TEXT,
  ADD COLUMN "share_token" TEXT,
  ADD COLUMN "rider_rating" INTEGER,
  ADD COLUMN "rider_comment" TEXT,
  ADD COLUMN "driver_rating" INTEGER,
  ADD COLUMN "tip_cents" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "qc_rides_share_token_key" ON "qc_rides"("share_token");

ALTER TABLE "qc_driver_profiles"
  ADD COLUMN "accepts_pets" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accessible" BOOLEAN NOT NULL DEFAULT false;
