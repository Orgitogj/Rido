ALTER TABLE mobility.driver_profiles DROP CONSTRAINT driver_profiles_status_check;
UPDATE mobility.driver_profiles SET status = 'submitted' WHERE status = 'pending';
ALTER TABLE mobility.driver_profiles ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE mobility.driver_profiles ADD CONSTRAINT driver_profiles_status_check
  CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'suspended'));

ALTER TABLE mobility.operators
  ADD COLUMN can_verify boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT operators_verify_requires_view CHECK (NOT can_verify OR can_view);

ALTER TABLE mobility.driver_profiles
  ADD COLUMN vehicle_color varchar(30),
  ADD COLUMN vehicle_year integer CHECK (vehicle_year BETWEEN 1980 AND 2100),
  ADD COLUMN review_version integer NOT NULL DEFAULT 1,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES mobility.operators(id),
  ADD COLUMN approval_expires_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN applicant_message varchar(1000),
  ADD COLUMN documents_waived boolean NOT NULL DEFAULT false,
  ADD COLUMN waiver_note varchar(200),
  ADD CONSTRAINT driver_profiles_waiver_note_check
    CHECK (NOT documents_waived OR waiver_note IS NOT NULL);

UPDATE mobility.driver_profiles
   SET documents_waived = true,
       waiver_note = 'Approved before document verification existed',
       approved_at = COALESCE(approved_at, updated_at)
 WHERE status IN ('approved', 'suspended');

CREATE TABLE mobility.driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  kind varchar(30) NOT NULL CHECK (kind IN (
    'identity', 'driving_license', 'vehicle_registration', 'insurance')),
  status varchar(20) NOT NULL DEFAULT 'pending_upload' CHECK (status IN (
    'pending_upload', 'uploaded', 'accepted', 'rejected', 'replaced', 'invalid', 'deleted')),
  storage_key varchar(200) UNIQUE,
  content_type varchar(50) NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  expires_on date,
  uploaded_at timestamptz,
  reviewed_by uuid REFERENCES mobility.operators(id),
  reviewed_at timestamptz,
  review_note varchar(500),
  delete_after timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK ((status = 'deleted') = (storage_key IS NULL))
);
CREATE UNIQUE INDEX driver_documents_one_accepted
  ON mobility.driver_documents(driver_profile_id, kind) WHERE status = 'accepted';
CREATE UNIQUE INDEX driver_documents_one_open
  ON mobility.driver_documents(driver_profile_id, kind)
  WHERE status IN ('pending_upload', 'uploaded', 'rejected');
CREATE INDEX driver_documents_cleanup_idx
  ON mobility.driver_documents(delete_after) WHERE status <> 'deleted';

CREATE TABLE mobility.driver_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  actor varchar(10) NOT NULL CHECK (actor IN ('applicant', 'operator', 'system', 'cli')),
  operator_id uuid REFERENCES mobility.operators(id),
  action varchar(40) NOT NULL,
  from_status varchar(20),
  to_status varchar(20),
  reason varchar(1000),
  applicant_message varchar(1000),
  document_id uuid REFERENCES mobility.driver_documents(id),
  created_at timestamptz NOT NULL,
  CHECK ((actor = 'operator') = (operator_id IS NOT NULL))
);
CREATE INDEX driver_review_events_profile_idx ON mobility.driver_review_events(driver_profile_id, id);
CREATE INDEX driver_profiles_review_queue_idx
  ON mobility.driver_profiles(submitted_at, id) WHERE status = 'submitted';
