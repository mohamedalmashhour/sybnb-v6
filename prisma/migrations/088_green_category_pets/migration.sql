-- Owner 2026-11-20: Uber/Lyft-style options. GREEN = electric/hybrid car category; drivers who
-- accept pets opt in (accepts_pets) and only they are offered rides booked with a pet.
ALTER TYPE "VehicleCategory" ADD VALUE IF NOT EXISTS 'GREEN';
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "accepts_pets" BOOLEAN NOT NULL DEFAULT false;
