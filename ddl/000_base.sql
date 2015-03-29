-- * ========================================================================= *
-- * GENERIC/SHARED ACROSS ALL TABLES                                          *
-- * ========================================================================= *

-- Load our extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Trigger function for updating the "updated_at" on every call
CREATE OR REPLACE FUNCTION "fn_update_trigger" () RETURNS TRIGGER AS $$
BEGIN
  -- Raise exception if attempting to update "uuid"
  IF OLD.uuid <> NEW.uuid THEN
    RAISE EXCEPTION 'Attempting to update "%" table''s "uuid" column from "%" to "%"', TG_TABLE_NAME, OLD.uuid, NEW.uuid;
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
