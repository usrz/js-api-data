-- * ========================================================================= *
-- * DOMAINS TABLE                                                             *
-- * ========================================================================= *
CREATE TABLE IF NOT EXISTS "domains" (
  "uuid"        UUID                        NOT NULL DEFAULT uuid_generate_v4(),
  "name"        VARCHAR(255)                NOT NULL,
  "description" VARCHAR(255)                         DEFAULT NULL,
  "created_at"  TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE "domains" ADD CONSTRAINT "domains_pkey" PRIMARY KEY ("uuid");
ALTER TABLE "domains" ADD CONSTRAINT "domains_name_key" UNIQUE ("name");

-- Extra indexes for sorting
CREATE INDEX "domains_name_idx"              ON "domains" ("name");
CREATE INDEX "domains_description_idx"       ON "domains" ("description");
CREATE INDEX "domains_name_lower_idx"        ON "domains" (LOWER("name"));
CREATE INDEX "domains_description_lower_idx" ON "domains" (LOWER("description"));

-- Trigger for updates and rule
CREATE TRIGGER "domains_updated_at" BEFORE UPDATE ON "domains" FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();

-- "Soft" deletes (move in a different table)
CREATE TABLE "domains_deleted" AS SELECT * FROM domains WITH NO DATA;
ALTER  TABLE "domains_deleted" ADD COLUMN "deleted_at" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW();
CREATE  RULE "domains_deleted" AS ON DELETE TO "domains" DO INSERT INTO "domains_deleted" SELECT OLD.*;
