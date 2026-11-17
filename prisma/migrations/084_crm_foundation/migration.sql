-- Migration 084 -- CRM + CEO advisor foundation. ADDITIVE ONLY. PREPARED, NOT APPLIED.
-- Review it, then apply it through the normal release process (migration-gate + prisma migrate deploy).
--
-- Adds two new tables (crm_contacts, crm_activities) and their enums. Nothing here touches money,
-- the ledger, wallet, commission or consent tables, and no existing table is altered. The CEO
-- advisor records its two money-free outputs (a staff CRM task, a campaign DRAFT) as crm_activities
-- rows; it never sends, charges, pays or refunds. marketing_opt_in_at is a display-only cached
-- mirror of LegalConsent and is NEVER the consent source of truth.

CREATE TYPE "CrmContactKind"    AS ENUM ('LEAD', 'GUEST', 'HOST', 'DRIVER', 'SELLER', 'MERCHANT', 'BUSINESS');
CREATE TYPE "CrmContactStage"   AS ENUM ('NEW', 'ACTIVE', 'DORMANT', 'CHURNED');
CREATE TYPE "CrmActivityKind"   AS ENUM ('NOTE', 'TASK', 'FOLLOW_UP', 'CAMPAIGN_DRAFT');
CREATE TYPE "CrmActivityStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

CREATE TABLE "crm_contacts" (
  "id"                 UUID             NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            UUID,
  "kind"               "CrmContactKind"  NOT NULL DEFAULT 'LEAD',
  "stage"              "CrmContactStage" NOT NULL DEFAULT 'NEW',
  "display_name"       TEXT              NOT NULL,
  "email"              TEXT,
  "phone"              TEXT,
  "marketing_opt_in_at" TIMESTAMPTZ(6),
  "region_key"         TEXT,
  "notes"              TEXT,
  "created_by_id"      UUID,
  "created_at"         TIMESTAMPTZ(6)    NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6)    NOT NULL DEFAULT now(),
  CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_activities" (
  "id"            UUID                NOT NULL DEFAULT gen_random_uuid(),
  "contact_id"    UUID                NOT NULL,
  "kind"          "CrmActivityKind"   NOT NULL DEFAULT 'TASK',
  "status"        "CrmActivityStatus" NOT NULL DEFAULT 'OPEN',
  "title"         TEXT                NOT NULL,
  "body"          TEXT,
  "source"        TEXT,
  "due_at"        TIMESTAMPTZ(6),
  "created_by_id" UUID,
  "created_at"    TIMESTAMPTZ(6)      NOT NULL DEFAULT now(),
  "completed_at"  TIMESTAMPTZ(6),
  CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "crm_contacts"
  ADD CONSTRAINT "crm_contacts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "crm_activities"
  ADD CONSTRAINT "crm_activities_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "crm_activities"
  ADD CONSTRAINT "crm_activities_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

CREATE INDEX "crm_contacts_stage_updated_idx" ON "crm_contacts" ("stage", "updated_at");
CREATE INDEX "crm_contacts_kind_stage_idx"    ON "crm_contacts" ("kind", "stage");
CREATE INDEX "crm_contacts_user_idx"          ON "crm_contacts" ("user_id");
CREATE INDEX "crm_activities_contact_idx"     ON "crm_activities" ("contact_id", "created_at");
CREATE INDEX "crm_activities_status_due_idx"  ON "crm_activities" ("status", "due_at");
CREATE INDEX "crm_activities_source_idx"      ON "crm_activities" ("source");
