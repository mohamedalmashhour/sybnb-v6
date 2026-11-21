-- Owner 2026-11-20 (Uber/Lyft-style end of trip):
--   rider_reviews: the DRIVER rates the RIDER (1..5) once per completed ride (rider -> driver ratings
--                  already live in ride_reviews).
--   ride_tips:     the rider tips the driver after a completed ride, once per ride; 100% to the driver.
CREATE TABLE "rider_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id" UUID NOT NULL,
  "driver_id" UUID NOT NULL,
  "rider_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "hidden_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "rider_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rider_reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "rider_reviews_ride_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "rider_reviews_ride_key" ON "rider_reviews"("ride_id");
CREATE INDEX "rider_reviews_rider_idx" ON "rider_reviews"("rider_id", "hidden_at");
CREATE TABLE "ride_tips" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ride_id" UUID NOT NULL,
  "rider_id" UUID NOT NULL,
  "driver_id" UUID NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ride_tips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ride_tips_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "ride_tips_ride_fkey" FOREIGN KEY ("ride_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ride_tips_ride_key" ON "ride_tips"("ride_id");
CREATE INDEX "ride_tips_driver_idx" ON "ride_tips"("driver_id", "created_at");
