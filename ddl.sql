-- * ========================================================================= *
-- * DB INITIALIZATION                                                         *
-- * ========================================================================= *

-- Load our extensions
CREATE EXTENSION "uuid-ossp";







-- CREATE  RULE "domains_deleted" AS ON DELETE TO "domains" DO INSERT INTO "domains_deleted" SELECT OLD.*;
-- CREATE TABLE objects_deleted AS SELECT * FROM objects WITH NO DATA;
-- CREATE RULE "objects_delete" AS ON DELETE TO "objects" DO  INSERT INTO objects_deleted (uuid, parent, deleted_at) SELECT old.uuid, old.parent, NOW();

CREATE FUNCTION "nodelete" () RETURNS TRIGGER AS $$
BEGIN
  IF OLD.uuid = uuid_nil() THEN
    RAISE EXCEPTION 'Attempting to delete root';
  END IF;
  INSERT INTO objects_deleted (uuid, parent, deleted_at)
       VALUES (OLD.uuid, OLD.parent, NOW());
  RETURN OLD;
END;
$$ LANGUAGE 'plpgsql';
CREATE TRIGGER "nodelete" BEFORE DELETE ON "objects" FOR EACH ROW EXECUTE PROCEDURE "nodelete"();
CREATE VIEW objects_all AS
  SELECT uuid, parent, NULL AS deleted_at FROM objects UNION
  SELECT uuid, parent, deleted_at FROM objects_deleted;











-- * ========================================================================= *
-- * TRIGGER FUNCTIONS                                                         *
-- * ========================================================================= *

-- A simple trigger preventing whatever it's associated to...

CREATE FUNCTION "fn_prevent_trigger" () RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Preventing "%" on "%"', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE 'plpgsql';

-- Deletions with triggers. Basically, we use this because when the trigger is
-- added to an inherited table, deletions from the parents will still be
-- processed and marked as soft deletes

CREATE FUNCTION "fn_delete_trigger" () RETURNS TRIGGER AS $$
BEGIN
  EXECUTE 'UPDATE "'                 ||
          quote_ident(TG_TABLE_NAME) ||
          '" SET "deleted_at" = NOW() WHERE uuid = $1'
    USING OLD.uuid;
  RETURN NULL;
END;
$$ LANGUAGE 'plpgsql';


-- * ========================================================================= *
-- * ENCRYPTION KEYS                                                           *
-- * ========================================================================= *

-- We keep a number of encryption keys around, so that we can periodically
-- rotate them. The "deleted_at" flags indicates keys which can still be used
-- for decryption of old data, but must not be used for encryption of new data.

CREATE TABLE "encryption_keys" (
  "uuid"          UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "encrypted_key" BYTEA                    , --NOT NULL,
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

-- =============================================================================
-- Every data table has the same structure:
--
-- uuid           -> primary key
-- encryption_key -> fk to encryption_keys table
-- encrypted_data -> encrypted json
-- created_at     -> when the row was created
-- updated_at     -> the last time the row was saved
-- deleted_at     -> soft deletion marker

CREATE TABLE "encrypted_objects" (
  "uuid"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "parent"         UUID                     NOT NULL,
  "encryption_key" UUID                     NOT NULL,
  "encrypted_data" BYTEA                    NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"     TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

-- Constraints, do we need those?
ALTER TABLE "encrypted_objects"
  ADD CONSTRAINT "pencrypted_objects_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "encrypted_objects_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- =============================================================================
-- Index tables base table
--
-- scope      -> the key that groups all hashed values together (eg. domain)
-- owner      -> owner of the indexed value (eg. a user in the scoped domain)
-- value      -> UUIDv5 (hashed) from the scope UUID and "key:value" (string)
-- indexed_at -> when the value was indexed.

CREATE TABLE "encrypted_indexes" (
  "scope"      UUID                     NOT NULL,
  "owner"      UUID                     NOT NULL,
  "value"      UUID                     NOT NULL,
  "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- We want to protect against updates to "uuid" and "created_at" in order to
-- protect data consistency, then "updated_at" gets updated to "NOW()"
--
-- As triggers, constraints, rules and indexes are not propagated to inheriting
-- tables, we will define the functions here, and reference them each time.

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

-- Deletions with triggers. Basically, we use this because when the trigger is
-- added to an inherited table, deletions from the parents will still be
-- processed and marked as soft deletes

CREATE FUNCTION "fn_delete_trigger" () RETURNS TRIGGER AS $$
BEGIN
  EXECUTE 'UPDATE "'                 ||
          quote_ident(TG_TABLE_NAME) ||
          '" SET "deleted_at" = NOW() WHERE uuid = $1'
    USING OLD.uuid;
  RETURN NULL;
END;
$$ LANGUAGE 'plpgsql';

-- A simple trigger preventing whatever it's associated to...

CREATE FUNCTION "fn_prevent_trigger" () RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Preventing "%" on "%"', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE 'plpgsql';

-- =============================================================================
-- Do not allow INSERT/UPDATE/DELETE directly on "encrypted_objects/indexes"

CREATE TRIGGER "encrypted_objects_read_only" BEFORE INSERT OR UPDATE OR DELETE
  ON "encrypted_objects" FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();
CREATE TRIGGER "encrypted_indexes_read_only" BEFORE INSERT OR UPDATE OR DELETE
  ON "encrypted_indexes" FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();


-- * ========================================================================= *
-- | * ===================================================================== * |
-- | | DOMAINS (THE ROOT OF ALL EVIL)                                        | |
-- | * ===================================================================== * |
-- * ========================================================================= *

CREATE TABLE "domains" () INHERITS ("encrypted_objects");

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

-- Protect against updates/deletes
CREATE TRIGGER "domains_update" BEFORE UPDATE ON "domains"
  FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();
CREATE TRIGGER "domains_delete" BEFORE DELETE ON "domains"
  FOR EACH ROW EXECUTE PROCEDURE "fn_delete_trigger" ();


-- * ========================================================================= *
-- | * ===================================================================== * |
-- | | POSIX OBJECTS (USERS AND GROUPS)                                     | |
-- | * ===================================================================== * |
-- * ========================================================================= *

CREATE TABLE "posix_objects" () INHERITS ("encrypted_objects");

-- Index our domains
CREATE INDEX "posix_objects_parent_idx" ON "posix_objects" ("parent");

-- Constraints, do we need those?
ALTER TABLE "posix_objects"
  ADD CONSTRAINT "posix_objects_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "posix_objects_domains_uuid_fkey"
      FOREIGN KEY ("parent") REFERENCES "domains" ("uuid"),
  ADD CONSTRAINT "posix_objects_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Do not allow INSERT/UPDATE/DELETE directly on "posix_objects"
CREATE TRIGGER "posix_objects_read_only" BEFORE INSERT OR UPDATE OR DELETE
  ON "posix_objects" FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();

-- =============================================================================

CREATE TABLE "posix_index" () INHERITS ("encrypted_indexes");

-- Index our scopes and owners
CREATE INDEX "posix_index_scope_idx" ON "posix_index" ("scope");
CREATE INDEX "posix_index_owner_idx" ON "posix_index" ("owner");

-- "Foreign key" on either "users" or "groups"
CREATE FUNCTION posix_index_check_owner(uuid) RETURNS boolean AS $$
BEGIN
  PERFORM * FROM users WHERE uuid = $1;
  IF NOT FOUND THEN
    PERFORM * FROM domains WHERE uuid = $1;
  END IF;
  RETURN FOUND;
END;
$$ LANGUAGE 'plpgsql';

-- Constraints
ALTER TABLE "posix_index"
  ADD CONSTRAINT "posix_index_pkey"
      PRIMARY KEY ("value"),
  ADD CONSTRAINT "posix_index_domains_fkey"
      FOREIGN KEY ("scope") REFERENCES "domains" ("uuid"),
  ADD CONSTRAINT "posix_index_owner_check"
      CHECK (posix_index_check_owner(owner));

-- Protect against updates
CREATE TRIGGER "posix_index_update" BEFORE UPDATE ON "posix_index"
  FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();

-- * ========================================================================= *
-- * USERS                                                                     *
-- * ========================================================================= *

CREATE TABLE "users" () INHERITS ("encrypted_objects");

-- Index our domains
CREATE INDEX "users_parent_idx" ON "users" ("parent");

-- Constraints
ALTER TABLE "users"
  ADD CONSTRAINT "users_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "users_domains_uuid_fkey"
      FOREIGN KEY ("parent") REFERENCES "domains" ("uuid"),
  ADD CONSTRAINT "users_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Protect against updates/deletes
CREATE TRIGGER "users_update" BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();
CREATE TRIGGER "users_delete" BEFORE DELETE ON "users"
  FOR EACH ROW EXECUTE PROCEDURE "fn_delete_trigger" ();

-- * ========================================================================= *

CREATE TABLE "users_index" () INHERITS ("encrypted_indexes");

-- Index our scopes and owners
CREATE INDEX "users_index_scope_idx" ON "users_index" ("scope");
CREATE INDEX "users_index_owner_idx" ON "users_index" ("owner");

-- Constraints
ALTER TABLE "users_index"
  ADD CONSTRAINT "users_index_pkey"
      PRIMARY KEY ("value"),
  ADD CONSTRAINT "users_index_scope_check"
      CHECK (scope = uuid_nil()),
  ADD CONSTRAINT "users_index_users_fkey"
      FOREIGN KEY ("owner") REFERENCES "users" ("uuid");

-- Protect against updates
CREATE TRIGGER "users_index_update" BEFORE UPDATE ON "users_index"
  FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();

-- * ========================================================================= *
-- * POSIX ATTRIBUTES INDEX
-- * ========================================================================= *

