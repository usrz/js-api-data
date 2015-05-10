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
  IF (OLD.deleted_at IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Attempting to update deleted encryption key "%"', OLD.uuid;
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
  -- Raise exception if attempting to update
  IF (OLD.uuid       != NEW.uuid)   OR
     (OLD.parent     != NEW.parent) OR
     (OLD.created_at != NEW.created_at)
  THEN
    RAISE EXCEPTION 'Attempting to update "%" values for key "%"', TG_TABLE_NAME, OLD.uuid;
  END IF;

  -- Raise exception if attempting to update something deleted
  IF (OLD.deleted_at IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Attempting to update "%" values for deleted key "%"', TG_TABLE_NAME, OLD.uuid;
  END IF;

  -- Enforce "updated_at" to be now()
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- A simple trigger preventing whatever it's associated to...

CREATE FUNCTION "fn_prevent_trigger" () RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Preventing "%" on "%"', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE 'plpgsql';

-- * ========================================================================= *
-- * DOMAINS                                                                   *
-- * ========================================================================= *

CREATE TABLE "domains" (
  "uuid"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "parent"         UUID                     NOT NULL,
  "encryption_key" UUID                     NOT NULL,
  "encrypted_data" BYTEA                    NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"     TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "domains"
  ADD CONSTRAINT "domains_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "domains_parent_check"
      CHECK (parent = uuid),
  ADD CONSTRAINT "domains_domains_uuid_fkey"
      FOREIGN KEY ("parent") REFERENCES "domains" ("uuid"),
  ADD CONSTRAINT "domains_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Hack-a-majig: We want "domains" to look like everything else (this having a
-- "parent" owner). This simplifies the code on the store side (avoid copy and
-- paste) but we want to make sure on insert that domains have self as parent
CREATE FUNCTION "fn_insert_domain_trigger" () RETURNS TRIGGER AS $$
BEGIN
  NEW.parent = NEW.uuid;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Ensure "parent" is equal to "uuid"
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
  "parent"         UUID                     NOT NULL,
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
      FOREIGN KEY ("parent") REFERENCES "domains" ("uuid"),
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

-- * ========================================================================= *

CREATE TABLE "users_index" (
  "scope"      UUID                     NOT NULL,
  "owner"      UUID                     NOT NULL,
  "value"      UUID                     NOT NULL,
  "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE "users_index"
  ADD CONSTRAINT "users_index_pkey"
      PRIMARY KEY ("value"),
  ADD CONSTRAINT "users_index_scope_check"
      CHECK (scope = uuid_nil()),
  ADD CONSTRAINT "users_index_users_fkey"
      FOREIGN KEY ("value") REFERENCES "users" ("uuid");

-- Protect against updates
CREATE TRIGGER "users_index_update" BEFORE UPDATE ON "users_index"
  FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();
