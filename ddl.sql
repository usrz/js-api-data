-- * ========================================================================= *
-- * GENERIC/SHARED ACROSS ALL TABLES                                          *
-- * ========================================================================= *

-- Load our extensions
CREATE EXTENSION "uuid-ossp";

-- Trigger function for updating the "updated_at" on every call
CREATE FUNCTION "fn_update_trigger" () RETURNS TRIGGER AS $$
BEGIN
  -- Raise exception if attempting to update "uuid"
  IF OLD.uuid <> NEW.uuid THEN
    RAISE EXCEPTION 'Attempting to update "%" table''s "uuid" column from "%" to "%"', TG_TABLE_NAME, OLD.uuid, NEW.uuid;
  END IF;
  -- Raise exception if attempting to update "domain"
  IF OLD.domain <> NEW.domain THEN
    RAISE EXCEPTION 'Attempting to update "%" table''s "domain" from "%" to "%"', TG_TABLE_NAME, OLD.created_at, NEW.created_at;
  END IF;
  -- Raise exception if attempting to update "created_at"
  IF OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'Attempting to update "%" table''s "created_at" from "%" to "%"', TG_TABLE_NAME, OLD.created_at, NEW.created_at;
  END IF;
  -- Enforce "updated_at" to be now()
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- * ========================================================================= *
-- * DOMAINS                                                                   *
-- * ========================================================================= *

CREATE TABLE "domains" (
  "uuid"       UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "attributes" BYTEA                    NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "domains" ADD CONSTRAINT "domains_pkey" PRIMARY KEY ("uuid");

CREATE TRIGGER "domains_updated_at" BEFORE UPDATE ON "domains" FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();

-- * ========================================================================= *
-- * USERS                                                                     *
-- * ========================================================================= *

CREATE TABLE "users" (
  "uuid"       UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "domain"     UUID                     NOT NULL,
  "attributes" BYTEA                    NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "users" ADD CONSTRAINT "users_pkey"             PRIMARY KEY ("uuid");
ALTER TABLE "users" ADD CONSTRAINT "users_domain_uuid_fkey" FOREIGN KEY ("domain") REFERENCES "domains" ("uuid");

CREATE TRIGGER "users_updated_at" BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();
