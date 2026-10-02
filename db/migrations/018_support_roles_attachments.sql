ALTER TABLE mobility.support_requests
  ALTER COLUMN ride_id DROP NOT NULL,
  ADD COLUMN requester_role varchar(10) NOT NULL DEFAULT 'passenger'
    CHECK (requester_role IN ('passenger', 'driver')),
  ADD COLUMN driver_profile_id uuid REFERENCES mobility.driver_profiles(id),
  ADD COLUMN client_request_id uuid,
  ADD CONSTRAINT support_requests_driver_role_check
    CHECK ((requester_role = 'driver') = (driver_profile_id IS NOT NULL));

ALTER TABLE mobility.support_requests DROP CONSTRAINT support_requests_category_check;
ALTER TABLE mobility.support_requests ADD CONSTRAINT support_requests_category_check
  CHECK (category IN ('charge_question', 'trip_problem', 'driver_issue', 'other',
                      'account_issue', 'passenger_issue', 'earnings_question',
                      'application_question'));

CREATE UNIQUE INDEX support_requests_client_request_idx
  ON mobility.support_requests(user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE mobility.support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  support_request_id uuid REFERENCES mobility.support_requests(id),
  support_message_id bigint REFERENCES mobility.support_messages(id),
  status varchar(20) NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'ready', 'attached', 'deleted')),
  upload_key varchar(200) UNIQUE,
  upload_expires_at timestamptz,
  storage_key varchar(200) UNIQUE,
  etag varchar(200),
  content_type varchar(50) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  delete_after timestamptz,
  deleted_at timestamptz,
  CHECK ((status IN ('ready', 'attached')) = (storage_key IS NOT NULL)),
  CHECK (status <> 'attached' OR support_request_id IS NOT NULL),
  CHECK (status NOT IN ('pending_upload', 'ready') OR support_request_id IS NULL),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (support_message_id IS NULL OR support_request_id IS NOT NULL)
);
CREATE INDEX support_attachments_request_idx
  ON mobility.support_attachments(support_request_id, created_at)
  WHERE status = 'attached';
CREATE INDEX support_attachments_owner_idx
  ON mobility.support_attachments(user_id, created_at)
  WHERE status IN ('pending_upload', 'ready');
CREATE INDEX support_attachments_cleanup_idx
  ON mobility.support_attachments(created_at) WHERE status <> 'deleted';
