ALTER TABLE mobility.driver_documents
  ADD COLUMN upload_key varchar(200) UNIQUE,
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN etag varchar(200);

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'mobility.driver_documents'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%storage_key IS NULL%'
  LOOP
    EXECUTE format('ALTER TABLE mobility.driver_documents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

UPDATE mobility.driver_documents
   SET upload_key = storage_key, storage_key = NULL,
       upload_expires_at = created_at + interval '5 minutes'
 WHERE status = 'pending_upload';

UPDATE mobility.driver_documents
   SET status = 'deleted', deleted_at = COALESCE(deleted_at, updated_at), storage_key = NULL
 WHERE status = 'invalid';

ALTER TABLE mobility.driver_documents
  ADD CONSTRAINT driver_documents_stored_file_check
  CHECK ((status IN ('uploaded', 'accepted', 'rejected', 'replaced')) = (storage_key IS NOT NULL));

CREATE TABLE mobility.storage_deletions (
  key varchar(200) PRIMARY KEY,
  not_before timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(200),
  created_at timestamptz NOT NULL
);
CREATE INDEX storage_deletions_due_idx ON mobility.storage_deletions(not_before);

INSERT INTO mobility.storage_deletions (key, not_before, created_at)
SELECT upload_key, upload_expires_at + interval '10 minutes', now()
  FROM mobility.driver_documents
 WHERE upload_key IS NOT NULL
ON CONFLICT (key) DO NOTHING;
