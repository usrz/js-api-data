-- * ========================================================================= *
-- * DB INITIALIZATION                                                         *
-- * ========================================================================= *

-- Load our extensions
CREATE EXTENSION "uuid-ossp";

-- * ========================================================================= *
-- * ENCRYPTION KEYS                                                           *
-- * ========================================================================= *

-- We keep a number of encryption keys around, so that we can periodically
-- rotate them. The "deleted_at" flags indicates keys which can still be used
-- for decryption of old data, but must not be used for encryption of new data.

CREATE TABLE "encryption_keys" (
  "uuid"          UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "encrypted_key" BYTEA                    NOT NULL,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"    TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "encryption_keys"
  ADD CONSTRAINT "encryption_keys_pkey"
      PRIMARY KEY ("uuid");

-- Create a function+triger that will protect us from updates
CREATE FUNCTION "fn_encryption_keys_update_trigger" () RETURNS TRIGGER AS $$
BEGIN
  -- Raise exception if attempting to update anything
  IF (OLD.uuid          != NEW.uuid)          OR
     (OLD.encrypted_key != NEW.encrypted_key) OR
     (OLD.created_at    != NEW.created_at)
  THEN
    RAISE EXCEPTION 'Attempting to update values of encryption key "%"', OLD.uuid;
  END IF;

  -- Raise exception if attempting to modify an existing "deleted_at"
  IF (OLD.deleted_at IS NOT NULL) AND
     ((OLD.deleted_at != NEW.deleted_at) OR (NEW.deleted_at IS NULL ))
  THEN
    RAISE EXCEPTION 'Attempting to update "deleted_at" of encryption key "%"', OLD.uuid;
  END IF;

  -- All good!
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER "encryption_keys_update" BEFORE UPDATE ON "encryption_keys"
  FOR EACH ROW EXECUTE PROCEDURE "fn_encryption_keys_update_trigger" ();

-- Use a rule to turn DELETE into UPDATE (deleted_at)
CREATE RULE "encryption_keys_delete" AS ON DELETE TO "encryption_keys" DO INSTEAD
  UPDATE "encryption_keys"
     SET deleted_at=NOW()
   WHERE uuid=OLD.uuid
     AND deleted_at IS NULL;

-- * ========================================================================= *
-- | * ===================================================================== * |
-- | | DATA TABLES                                                           | |
-- | * ===================================================================== * |
-- * ========================================================================= *

-- Every data table has the same structure:
--
-- uuid           -> primary key
-- encryption_key -> fk to encryption_keys table
-- encrypted_data -> encrypted json
-- created_at     -> when the row was created
-- updated_at     -> the last time the row was saved
-- deleted_at     -> soft deletion marker
--
-- We want to protect against updates to "uuid" and "created_at" in order to
-- protect data consistency, then "updated_at" gets updated to "NOW()"

CREATE FUNCTION "fn_update_trigger" () RETURNS TRIGGER AS $$
BEGIN
  -- Raise exception if attempting to update anything
  IF (OLD.uuid       != NEW.uuid)   OR
     (OLD.domain     != NEW.domain) OR
     (OLD.created_at != NEW.created_at)
  THEN
    RAISE EXCEPTION 'Attempting to update "%" values for key "%"', TG_TABLE_NAME, OLD.uuid;
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
  "uuid"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "domain"         UUID                     NOT NULL, -- always same as uuid
  "encryption_key" UUID                     NOT NULL,
  "encrypted_data" BYTEA                    NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"     TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "domains"
  ADD CONSTRAINT "domains_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "domains_domains_uuid_fkey"
      FOREIGN KEY ("domain") REFERENCES "domains" ("uuid"),
  ADD CONSTRAINT "domains_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Hack-a-majig: We want "domains" to look like everything else (this having a
-- "domain" owner). This simplifies the code on the store side (avoid copy and
-- paste) but we want to make sure on insert that the UUID stored is the same
CREATE FUNCTION "fn_insert_domain_trigger" () RETURNS TRIGGER AS $$
BEGIN
  NEW.domain = NEW.uuid;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Ensure "domain" is equal to "uuid"
CREATE TRIGGER "domains_insert" BEFORE INSERT ON "domains"
  FOR EACH ROW EXECUTE PROCEDURE "fn_insert_domain_trigger" ();

-- Protect against updates
CREATE TRIGGER "domains_update" BEFORE UPDATE ON "domains"
  FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();

-- Turn DELETE into UPDATE (deleted_at)
CREATE RULE "domains_delete" AS ON DELETE TO "domains" DO INSTEAD
  UPDATE "domains"
     SET deleted_at=NOW()
   WHERE uuid=OLD.uuid
     AND deleted_at IS NULL;


-- * ========================================================================= *
-- * USERS                                                                     *
-- * ========================================================================= *

CREATE TABLE "users" (
  "uuid"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "domain"         UUID                     NOT NULL,
  "encryption_key" UUID                     NOT NULL,
  "encrypted_data" BYTEA                    NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"     TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "users"
  ADD CONSTRAINT "users_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "users_domains_uuid_fkey"
      FOREIGN KEY ("domain") REFERENCES "domains" ("uuid"),
  ADD CONSTRAINT "users_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Protect against updates
CREATE TRIGGER "users_update" BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();

-- Turn DELETE into UPDATE (deleted_at)
CREATE RULE "users_delete" AS ON DELETE TO "users" DO INSTEAD
  UPDATE "users"
     SET deleted_at=NOW()
   WHERE uuid=OLD.uuid
     AND deleted_at IS NULL;

