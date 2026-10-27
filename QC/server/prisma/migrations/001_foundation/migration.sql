-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "qc_role" AS ENUM ('GUEST', 'HOST', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "qc_account_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "qc_application_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "qc_listing_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "qc_stay_status" AS ENUM ('HOLD', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "qc_ride_category" AS ENUM ('STANDARD', 'COMFORT', 'XL');

-- CreateEnum
CREATE TYPE "qc_ride_status" AS ENUM ('REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "qc_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fr-CA',
    "roles" "qc_role"[] DEFAULT ARRAY['GUEST']::"qc_role"[],
    "status" "qc_account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_login_codes" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_role_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "qc_role" NOT NULL,
    "status" "qc_application_status" NOT NULL DEFAULT 'PENDING',
    "details" JSONB NOT NULL,
    "note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_role_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_driver_profiles" (
    "user_id" UUID NOT NULL,
    "category" "qc_ride_category" NOT NULL DEFAULT 'STANDARD',
    "vehicle" JSONB NOT NULL,
    "licence_expiry" DATE NOT NULL,
    "insurance_expiry" DATE NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "qc_driver_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "qc_listings" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "registration_number" TEXT,
    "max_guests" INTEGER NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "beds" INTEGER NOT NULL,
    "bathrooms" DOUBLE PRECISION NOT NULL,
    "nightly_cents" INTEGER NOT NULL,
    "cleaning_cents" INTEGER NOT NULL DEFAULT 0,
    "min_nights" INTEGER NOT NULL DEFAULT 1,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "qc_listing_status" NOT NULL DEFAULT 'DRAFT',
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_calendar_blocks" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_calendar_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_stay_bookings" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "guests" INTEGER NOT NULL,
    "status" "qc_stay_status" NOT NULL DEFAULT 'HOLD',
    "hold_expires_at" TIMESTAMP(3),
    "quote" JSONB NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "refund_cents" INTEGER,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_stay_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_ride_quotes" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "category" "qc_ride_category" NOT NULL,
    "pickup" JSONB NOT NULL,
    "dropoff" JSONB NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_ride_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_rides" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "driver_id" UUID,
    "category" "qc_ride_category" NOT NULL,
    "pickup" JSONB NOT NULL,
    "dropoff" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "status" "qc_ride_status" NOT NULL DEFAULT 'REQUESTED',
    "total_cents" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "cancelled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "qc_rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_ride_events" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_users_email_key" ON "qc_users"("email");

-- CreateIndex
CREATE INDEX "qc_login_codes_email_created_at_idx" ON "qc_login_codes"("email", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "qc_sessions_token_hash_key" ON "qc_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "qc_sessions_user_id_idx" ON "qc_sessions"("user_id");

-- CreateIndex
CREATE INDEX "qc_role_applications_status_role_idx" ON "qc_role_applications"("status", "role");

-- CreateIndex
CREATE INDEX "qc_listings_status_city_idx" ON "qc_listings"("status", "city");

-- CreateIndex
CREATE INDEX "qc_calendar_blocks_listing_id_idx" ON "qc_calendar_blocks"("listing_id");

-- CreateIndex
CREATE INDEX "qc_stay_bookings_listing_id_status_idx" ON "qc_stay_bookings"("listing_id", "status");

-- CreateIndex
CREATE INDEX "qc_stay_bookings_guest_id_idx" ON "qc_stay_bookings"("guest_id");

-- CreateIndex
CREATE UNIQUE INDEX "qc_rides_quote_id_key" ON "qc_rides"("quote_id");

-- CreateIndex
CREATE INDEX "qc_rides_status_category_idx" ON "qc_rides"("status", "category");

-- CreateIndex
CREATE INDEX "qc_rides_rider_id_idx" ON "qc_rides"("rider_id");

-- CreateIndex
CREATE INDEX "qc_rides_driver_id_idx" ON "qc_rides"("driver_id");

-- CreateIndex
CREATE INDEX "qc_ride_events_ride_id_at_idx" ON "qc_ride_events"("ride_id", "at");

-- CreateIndex
CREATE INDEX "qc_audit_log_action_at_idx" ON "qc_audit_log"("action", "at");

-- AddForeignKey
ALTER TABLE "qc_sessions" ADD CONSTRAINT "qc_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "qc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_role_applications" ADD CONSTRAINT "qc_role_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "qc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_driver_profiles" ADD CONSTRAINT "qc_driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "qc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_listings" ADD CONSTRAINT "qc_listings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "qc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_calendar_blocks" ADD CONSTRAINT "qc_calendar_blocks_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "qc_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_stay_bookings" ADD CONSTRAINT "qc_stay_bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "qc_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_stay_bookings" ADD CONSTRAINT "qc_stay_bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "qc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_ride_quotes" ADD CONSTRAINT "qc_ride_quotes_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "qc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rides" ADD CONSTRAINT "qc_rides_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "qc_ride_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rides" ADD CONSTRAINT "qc_rides_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "qc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rides" ADD CONSTRAINT "qc_rides_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "qc_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_ride_events" ADD CONSTRAINT "qc_ride_events_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "qc_rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity guarantees Prisma cannot express.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Two live stays (an unexpired hold or a confirmed booking) can never overlap on one listing.
ALTER TABLE "qc_stay_bookings" ADD CONSTRAINT "qc_stay_no_overlap"
  EXCLUDE USING gist ("listing_id" WITH =, daterange("check_in", "check_out", '[)') WITH &&)
  WHERE ("status" IN ('HOLD', 'CONFIRMED'));

ALTER TABLE "qc_stay_bookings" ADD CONSTRAINT "qc_stay_dates" CHECK ("check_out" > "check_in");
ALTER TABLE "qc_calendar_blocks" ADD CONSTRAINT "qc_block_dates" CHECK ("end_date" > "start_date");
ALTER TABLE "qc_listings" ADD CONSTRAINT "qc_listing_money" CHECK ("nightly_cents" > 0 AND "cleaning_cents" >= 0);

-- A driver has at most one active ride.
CREATE UNIQUE INDEX "qc_one_active_ride_per_driver" ON "qc_rides" ("driver_id")
  WHERE "status" IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS');

-- The trip safety record is append-only.
CREATE FUNCTION qc_ride_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'qc_ride_events is append-only';
END $$;
CREATE TRIGGER qc_ride_events_no_update BEFORE UPDATE OR DELETE ON "qc_ride_events"
  FOR EACH ROW EXECUTE FUNCTION qc_ride_events_append_only();
CREATE TRIGGER qc_audit_log_no_update BEFORE UPDATE OR DELETE ON "qc_audit_log"
  FOR EACH ROW EXECUTE FUNCTION qc_ride_events_append_only();
