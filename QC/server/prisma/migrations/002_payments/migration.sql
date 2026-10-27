-- CreateEnum
CREATE TYPE "qc_payment_kind" AS ENUM ('STAY', 'RIDE');

-- CreateEnum
CREATE TYPE "qc_payment_status" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'CANCELED', 'FAILED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "qc_ride_status" ADD VALUE 'PAYMENT_PENDING';

-- CreateTable
CREATE TABLE "qc_payments" (
    "id" UUID NOT NULL,
    "kind" "qc_payment_kind" NOT NULL,
    "user_id" UUID NOT NULL,
    "stay_booking_id" UUID,
    "ride_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "captured_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "qc_payment_status" NOT NULL DEFAULT 'PENDING',
    "stripe_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_payments_stay_booking_id_key" ON "qc_payments"("stay_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "qc_payments_ride_id_key" ON "qc_payments"("ride_id");

-- CreateIndex
CREATE UNIQUE INDEX "qc_payments_stripe_session_id_key" ON "qc_payments"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "qc_payments_stripe_payment_intent_id_key" ON "qc_payments"("stripe_payment_intent_id");


ALTER TABLE "qc_payments" ADD CONSTRAINT "qc_payment_money" CHECK (
  "amount_cents" > 0 AND "captured_cents" BETWEEN 0 AND "amount_cents" AND "refunded_cents" BETWEEN 0 AND "captured_cents");
ALTER TABLE "qc_payments" ADD CONSTRAINT "qc_payment_target" CHECK (("stay_booking_id" IS NULL) <> ("ride_id" IS NULL));
