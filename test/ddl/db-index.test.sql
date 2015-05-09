CREATE TABLE "test_index" (
  "scope"      UUID                     NOT NULL,
  "owner"      UUID                     NOT NULL,
  "value"      UUID                     NOT NULL,
  "indexed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE "test_index"
  ADD CONSTRAINT "test_index_pkey"
      PRIMARY KEY ("value");
