INSERT INTO encryption_keys (uuid, encrypted_key) VALUES ('e97296d6-6143-40bd-8f29-9b5c71d6b4ee', '');

INSERT INTO objects(uuid, parent, kind, encryption_key, encrypted_data)
    VALUES ('125036e8-d182-41a4-ad65-2a06180e7fe0', '125036e8-d182-41a4-ad65-2a06180e7fe0', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
           ('4656dada-b495-43e8-bdce-27f3aa2096e8', '4656dada-b495-43e8-bdce-27f3aa2096e8', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
           ('b2b3cbc4-dc28-464f-a087-20bead5daf2f', '125036e8-d182-41a4-ad65-2a06180e7fe0', 'user',   'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
           ('387d0c2e-554c-4063-a4fe-f829bdb7e8f8', '4656dada-b495-43e8-bdce-27f3aa2096e8', 'user',   'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', '');
