ALTER TABLE mobility.users
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE mobility.driver_profiles
  ADD COLUMN deleted_at timestamptz;

CREATE TABLE mobility.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES mobility.users(id),
  clerk_id_hash char(64) NOT NULL UNIQUE,
  clerk_id varchar(100),
  stripe_customer_id varchar(100),
  requested_at timestamptz NOT NULL,
  identity_deleted_at timestamptz,
  payments_deleted_at timestamptz,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_error varchar(200),
  CHECK ((identity_deleted_at IS NULL) = (clerk_id IS NOT NULL)),
  CHECK (completed_at IS NULL OR identity_deleted_at IS NOT NULL)
);
CREATE INDEX account_deletions_due_idx
  ON mobility.account_deletions(next_attempt_at) WHERE completed_at IS NULL;
