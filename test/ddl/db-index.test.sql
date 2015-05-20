CREATE TABLE "test_index" () INHERITS ("encrypted_indexes");

ALTER TABLE "test_index"
  ADD CONSTRAINT "test_index_pkey"
      PRIMARY KEY ("value");
