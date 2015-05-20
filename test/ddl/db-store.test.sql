CREATE TABLE "test_store" () INHERITS ("encrypted_objects");

ALTER TABLE "test_store"
  ADD CONSTRAINT "test_store_pkey"
      PRIMARY KEY ("uuid"),
  ADD CONSTRAINT "test_store_encryption_keys_uuid_fkey"
      FOREIGN KEY ("encryption_key") REFERENCES "encryption_keys" ("uuid");

-- Protect against updates/deletes
CREATE TRIGGER "test_store_update" BEFORE UPDATE ON "test_store"
  FOR EACH ROW EXECUTE PROCEDURE "fn_update_trigger" ();
CREATE TRIGGER "test_store_delete" BEFORE DELETE ON "test_store"
  FOR EACH ROW EXECUTE PROCEDURE "fn_delete_trigger" ();
