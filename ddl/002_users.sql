-- * ========================================================================= *
-- * USERS TABLE                                                               *
-- * ========================================================================= *
CREATE TABLE IF NOT EXISTS "users" (
  "uuid"          UUID                        NOT NULL DEFAULT uuid_generate_v4(),
  "name"          VARCHAR(255)                NOT NULL,
  "domain_uuid"   UUID                        NOT NULL,
  "description"   VARCHAR(255)                         DEFAULT NULL,
  "given_name"    VARCHAR(255)                         DEFAULT NULL,
  "family_name"   VARCHAR(255)                         DEFAULT NULL,
  "email_address" VARCHAR(255)                         DEFAULT NULL,
  "created_at"    TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("uuid");
ALTER TABLE "users" ADD CONSTRAINT "users_domain_email_key" UNIQUE ("domain_uuid", "email_address");
ALTER TABLE "users" ADD CONSTRAINT "users_domain_uuid_fkey" FOREIGN KEY ("domain_uuid") REFERENCES "domains" ("uuid");

-- Extra indexes for selecting/sorting
CREATE INDEX "users_domain_uuid_idx"         ON "users" ("uuid");
CREATE INDEX "users_given_name_idx"          ON "users" ("given_name");
CREATE INDEX "users_family_name_idx"         ON "users" ("family_name");
CREATE INDEX "users_email_address_idx"       ON "users" ("email_address");
CREATE INDEX "users_given_name_lower_idx"    ON "users" (LOWER("given_name"));
CREATE INDEX "users_family_name_lower_idx"   ON "users" (LOWER("family_name"));
CREATE INDEX "users_email_address_lower_idx" ON "users" (LOWER("email_address"));

-- Trigger for updates and rule for soft deletes
CREATE TRIGGER "users_updated_at" BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();

-- "Soft" deletes (move in a different table)
CREATE TABLE "users_deleted" AS SELECT * FROM users WITH NO DATA;
ALTER  TABLE "users_deleted" ADD COLUMN "deleted_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW();
CREATE  RULE "users_deleted" AS ON DELETE TO "users" DO INSERT INTO "users_deleted" SELECT OLD.*;
