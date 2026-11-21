-- Q EAT: food delivery (owner 2026-11-21). Merchants, menus and orders; rules in wrapping/delivery.
ALTER TYPE "qc_role" ADD VALUE IF NOT EXISTS 'MERCHANT';
CREATE TYPE "qc_merchant_status" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "qc_order_status" AS ENUM ('PAYMENT_PENDING', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED', 'UNDELIVERABLE');

CREATE TABLE "qc_merchants" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "address" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "phone" TEXT,
  "radius_m" INTEGER NOT NULL DEFAULT 6000,
  "prep_minutes" INTEGER NOT NULL DEFAULT 20,
  "min_order_cents" INTEGER,
  "hours" JSONB,
  "busy" BOOLEAN NOT NULL DEFAULT false,
  "status" "qc_merchant_status" NOT NULL DEFAULT 'PENDING_REVIEW',
  "permit_number" TEXT,
  "neq" TEXT,
  "gst_number" TEXT,
  "qst_number" TEXT,
  "photo" TEXT,
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qc_merchants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qc_merchants_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "qc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "qc_merchants_status_idx" ON "qc_merchants"("status");

CREATE TABLE "qc_menu_items" (
  "id" UUID NOT NULL,
  "merchant_id" UUID NOT NULL,
  "section" TEXT NOT NULL DEFAULT 'Menu',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price_cents" INTEGER NOT NULL CHECK ("price_cents" >= 0),
  "allergens" TEXT,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qc_menu_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qc_menu_items_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "qc_merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "qc_menu_items_merchant_id_idx" ON "qc_menu_items"("merchant_id");

CREATE TABLE "qc_food_orders" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "merchant_id" UUID NOT NULL,
  "courier_id" UUID,
  "status" "qc_order_status" NOT NULL DEFAULT 'PLACED',
  "fulfillment" TEXT NOT NULL DEFAULT 'delivery',
  "items" JSONB NOT NULL,
  "address" JSONB,
  "note" TEXT,
  "subtotal_cents" INTEGER NOT NULL,
  "tip_cents" INTEGER NOT NULL DEFAULT 0,
  "total_cents" INTEGER NOT NULL,
  "breakdown" JSONB NOT NULL,
  "eta_low_min" INTEGER,
  "eta_high_min" INTEGER,
  "refund_cents" INTEGER,
  "cancelled_by" TEXT,
  "rating" INTEGER,
  "rating_comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMP(3),
  "ready_at" TIMESTAMP(3),
  "picked_up_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  CONSTRAINT "qc_food_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qc_food_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "qc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "qc_food_orders_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "qc_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "qc_food_orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "qc_merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "qc_food_orders_merchant_id_status_idx" ON "qc_food_orders"("merchant_id", "status");
CREATE INDEX "qc_food_orders_customer_id_created_at_idx" ON "qc_food_orders"("customer_id", "created_at");
CREATE INDEX "qc_food_orders_courier_id_status_idx" ON "qc_food_orders"("courier_id", "status");
