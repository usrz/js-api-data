-- * ========================================================================= *
-- * DB INITIALIZATION                                                         *
-- * ========================================================================= *

-- Load our extensions
CREATE EXTENSION "uuid-ossp";

-- A simple trigger preventing whatever it's associated to...
CREATE FUNCTION "fn_prevent_trigger" () RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Preventing "%" on "%"', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE 'plpgsql';


-- =============================================================================
-- Our object kinds and their hierarchy
--
CREATE TYPE "kind" AS ENUM ('domain', 'user', 'group', 'credentials');

-- Hierarchy for objects insert
CREATE TABLE "kinds_hierarchy" (
  "parent" KIND NOT NULL,
  "child"  KIND NOT NULL,
  UNIQUE("parent", "child"),
  PRIMARY KEY ("child")
);

-- Index for quick selects
CREATE INDEX "kinds_hierarchy_parent_ids" ON "kinds_hierarchy" ("parent");

-- Values for our kinds
INSERT INTO "kinds_hierarchy"
           ("parent" , "child"      ) VALUES
           ('domain' , 'user'       ),
           ('domain' , 'group'      ),
           ('user'   , 'credentials');

-- No updates, deletions, or even inserts...
CREATE TRIGGER "kinds_hierarchy_protect" BEFORE INSERT OR UPDATE OR DELETE ON "kinds_hierarchy"
  FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();



-- * ========================================================================= *
-- | * ===================================================================== * |
-- | | ENCRYPTION KEYS                                                       | |
-- | * ===================================================================== * |
-- * ========================================================================= *

-- We keep a number of encryption keys around, so that we can periodically
-- rotate them. The "deleted_at" flags indicates keys which can still be used
-- for decryption of old data, but must not be used for encryption of new data.

CREATE TABLE "encryption_keys" (

  -- Basic structure
  "uuid"          UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "encrypted_key" BYTEA                    NOT NULL,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"    TIMESTAMP WITH TIME ZONE          DEFAULT NULL,

  -- Constraints and idexes
  PRIMARY KEY ("uuid")
);

-- Create a function that will protect us from updates
CREATE FUNCTION "fn_encryption_keys_update_trigger" () RETURNS TRIGGER AS $$
BEGIN
  -- Raise exception if attempting to update anything BUT "deleted_at" as
  -- we do soft deletes. NULLs are ok, as none of the fields below is nullable
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

-- Very little updates
CREATE TRIGGER "encryption_keys_update" BEFORE UPDATE ON "encryption_keys"
  FOR EACH ROW EXECUTE PROCEDURE "fn_encryption_keys_update_trigger" ();

-- Use a rule to turn DELETE into UPDATE (deleted_at)
CREATE RULE "encryption_keys_delete" AS ON DELETE TO "encryption_keys" DO INSTEAD
  UPDATE "encryption_keys"
     SET deleted_at = NOW()
   WHERE deleted_at IS NULL
     AND uuid = OLD.uuid;



-- * ========================================================================= *
-- | * ===================================================================== * |
-- | | OBJECTS TABLE(s)                                                      | |
-- | * ===================================================================== * |
-- * ========================================================================= *

-- This is the basic objects table, containing all the encrypted JSONs
--
-- * uuid           -> basic UUID of the object (primary key)
-- * kind           -> the kind of the object (basically data it holds)
-- * parent         -> reference to the parent, domains reference themselves
-- * encryption_key -> fk to encryption_keys table identifying the key
-- * encrypted_data -> encrypted json
-- * created_at     -> when the row was created
-- * updated_at     -> the last time the row was saved
--
CREATE TABLE "objects" (

  -- Basic structure
  "uuid"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "kind"           KIND                     NOT NULL,
  "parent"         UUID                     NOT NULL,
  "encryption_key" UUID                     NOT NULL,
  "encrypted_data" BYTEA                    NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Constraints and idexes, parent deletion triggers child deletion
  FOREIGN KEY ("parent") REFERENCES "objects" ("uuid") ON DELETE CASCADE,
  FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys"   ("uuid"),
  PRIMARY KEY ("uuid")
);

-- Hack-a-majig: We want "domains" reference themselves as a parent, while any
-- other object must properly refer to a known parent kind
--
CREATE FUNCTION "fn_objects_insert_trigger" () RETURNS TRIGGER AS $$
BEGIN

  -- When inserting domains, check the parent UUID (must be null, defaults)
  -- to the same UUID or must definitely be the same
  IF (NEW.kind = 'domain') THEN
    IF (NEW.parent IS NULL) THEN
      NEW.parent = NEW.uuid;
    ELSIF (NEW.parent != NEW.uuid) THEN
      RAISE EXCEPTION 'Object of kind "domain" must have a NULL parent (or self)';
    END IF;

  -- When inserting any non-domain, the parent must not be self
  ELSIF (NEW.parent = NEW.uuid) THEN
    RAISE EXCEPTION 'Object of kind "%" must not have self as a parent', NEW.kind;

  -- Otherwise check the parent kind is hierarchically valid
  ELSE
    PERFORM TRUE FROM objects, kinds_hierarchy
                WHERE objects.uuid = NEW.parent
                  AND objects.kind = kinds_hierarchy.parent
                  AND kinds_hierarchy.child = NEW.kind;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent "%" can not have children of kind "%"', NEW.parent, NEW.kind;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Allow modifications *only*
--
CREATE FUNCTION "fn_objects_update_trigger" () RETURNS TRIGGER AS $$
BEGIN

  -- Raise exception if attempting to update: encryption key ok for rekeying
  -- and NULLs for new will be caught by the "NOT NULL" constraints
  IF (OLD.uuid       != NEW.uuid)       OR
     (OLD.kind       != NEW.kind)       OR
     (OLD.parent     != NEW.parent)     OR
     (OLD.created_at != NEW.created_at) OR
     (OLD.updated_at != NEW.updated_at)
  THEN
    RAISE EXCEPTION 'Attempting to update protected object values for key "%"', OLD.uuid;
  END IF;

  -- Raise exception if attempting to update key but no data (not rekeying?)
  IF (OLD.encryption_key != NEW.encryption_key) AND
     (OLD.encrypted_data =  NEW.encrypted_data)
  THEN
    RAISE EXCEPTION 'Attempting to update encryption key but not data for key "%"', OLD.uuid;
  END IF;

  -- Enforce "updated_at" to be now()
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Triggers for inserts and updates (DELETE has a rule)
CREATE TRIGGER "objects_insert" BEFORE INSERT ON "objects"
  FOR EACH ROW EXECUTE PROCEDURE "fn_objects_insert_trigger" ();
CREATE TRIGGER "objects_update" BEFORE UPDATE ON "objects"
  FOR EACH ROW EXECUTE PROCEDURE "fn_objects_update_trigger" ();

-- =============================================================================
-- A clone of the "objects" holding "soft-deleted" objects plus
-- or minus a few other goodies and/or modifications:
--
-- * No "parent" foreign key (the parent might still be valid)
-- * Added non-null "deleted_at" column, identifying the "NOW()" of insert
-- * No whatsoever update and/or delete permitted
--
CREATE TABLE "deleted_objects" (
  LIKE "objects" INCLUDING CONSTRAINTS INCLUDING INDEXES,

  -- Enforce a "deleted_at" column not null
  "deleted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Foreign key constraints (primary key copied)
  FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid")
);

-- No updates, or deletions, never!
CREATE TRIGGER "encryption_keys_protect" BEFORE UPDATE OR DELETE ON "deleted_objects"
  FOR EACH ROW EXECUTE PROCEDURE "fn_prevent_trigger" ();

-- =============================================================================
-- Link "objects" and "deleted_objects" and perform sof deletions
-- using a simple rule, but *DO CHECK* and *NEVER SAVE* old credentials.
--
CREATE RULE "objects_delete" AS ON DELETE TO "objects" DO ALSO
  INSERT INTO "deleted_objects"
       SELECT * FROM "objects"
        WHERE uuid = OLD.uuid
          AND kind != 'credentials';

-- =============================================================================
-- Create a view able to return both normal AND deleted objects.
--
CREATE VIEW available_objects AS
  SELECT * FROM deleted_objects UNION
  SELECT *, NULL AS deleted_at FROM objects;


-- * ========================================================================= *
-- | * ===================================================================== * |
-- | | INDEX TABLES                                                          | |
-- | * ===================================================================== * |
-- * ========================================================================= *

-- Index table, holding (unique) attribute values for each owner
--
-- scope      -> the key that groups all hashed values together (eg. domain)
--               or "NULL" if this is a global (unscoped) attribute.
-- owner      -> owner of the indexed value (eg. a user in the scoped domain)
-- value      -> UUIDv5 (hashed) from the scope UUID and "key:value" (string)
-- indexed_at -> when the value was indexed.
--
CREATE TABLE "objects_index" (
  "scope"      UUID, -- Remember, this is NULL-able!
  "owner"      UUID                     NOT NULL,
  "keyid"      UUID                   ,--  NOT NULL,
  "value"      UUID                     NOT NULL,
  "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Foreign key references
  FOREIGN KEY ("scope") REFERENCES "objects" ("uuid") ON DELETE CASCADE,
  FOREIGN KEY ("owner") REFERENCES "objects" ("uuid") ON DELETE CASCADE
);

-- Unique constraint for scope -> value
CREATE UNIQUE INDEX ON "objects_index" (value)        WHERE "scope" IS     NULL;
CREATE UNIQUE INDEX ON "objects_index" (value, scope) WHERE "scope" IS NOT NULL;
