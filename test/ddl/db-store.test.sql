CREATE TABLE "test_store" (
  "uuid"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
  "parent"         UUID                     NOT NULL,
  "encryption_key" UUID                     NOT NULL,
  "encrypted_data" BYTEA                    NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deleted_at"     TIMESTAMP WITH TIME ZONE          DEFAULT NULL
);

ALTER TABLE "test_store"
  ADD CONSTRAINT "test_store_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "test_store_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Protect against updates
CREATE TRIGGER "test_store_update" BEFORE UPDATE ON "test_store"
  FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();

-- Turn DELETE into UPDATE (deleted_at)
CREATE RULE "test_store_delete" AS ON DELETE TO "test_store" DO INSTEAD
  UPDATE "test_store"
     SET deleted_at=NOW()
   WHERE uuid=OLD.uuid
     AND deleted_at IS NULL;
