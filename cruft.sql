INSERT INTO encryption_keys (encrypted_key) VALUES ('');
INSERT INTO domains (encryption_key, encrypted_data) VALUES ((SELECT uuid FROM encryption_keys LIMIT 1), '');
INSERT INTO users (parent, encryption_key, encrypted_data) ((SELECT uuid, encryption_key,'' FROM domains));
