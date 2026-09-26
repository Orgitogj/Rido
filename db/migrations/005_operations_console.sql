CREATE TABLE mobility.operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES mobility.users(id),
  display_name varchar(100) NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_support boolean NOT NULL DEFAULT false,
  can_refund boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  granted_by varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (NOT (can_support OR can_refund) OR can_view),
  CHECK (active = (revoked_at IS NULL))
);

CREATE TABLE mobility.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id uuid REFERENCES mobility.operators(id),
  actor varchar(120) NOT NULL,
  action varchar(60) NOT NULL,
  target_type varchar(30) NOT NULL,
  target_id varchar(100),
  reason varchar(500),
  result varchar(20) NOT NULL CHECK (result IN ('succeeded', 'failed', 'denied', 'pending')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target_idx ON mobility.audit_log(target_type, target_id, id);
CREATE INDEX audit_log_operator_idx ON mobility.audit_log(operator_id, id);

ALTER TABLE mobility.support_requests DROP CONSTRAINT support_requests_status_check;
ALTER TABLE mobility.support_requests ADD CONSTRAINT support_requests_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved'));
ALTER TABLE mobility.support_requests
  ADD COLUMN assigned_operator_id uuid REFERENCES mobility.operators(id),
  ADD COLUMN resolved_by uuid REFERENCES mobility.operators(id),
  ADD COLUMN resolution_message varchar(1000),
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT support_requests_resolution_check
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL));
CREATE INDEX support_requests_status_idx ON mobility.support_requests(status, created_at DESC, id);
CREATE INDEX support_requests_user_idx ON mobility.support_requests(user_id, created_at DESC);

CREATE TABLE mobility.support_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  support_request_id uuid NOT NULL REFERENCES mobility.support_requests(id),
  operator_id uuid NOT NULL REFERENCES mobility.operators(id),
  note varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_notes_request_idx ON mobility.support_notes(support_request_id, id);

CREATE TABLE mobility.support_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  support_request_id uuid NOT NULL REFERENCES mobility.support_requests(id),
  operator_id uuid REFERENCES mobility.operators(id),
  action varchar(30) NOT NULL
    CHECK (action IN ('created', 'assigned', 'unassigned', 'resolved', 'reopened', 'note_added')),
  from_status varchar(20),
  to_status varchar(20),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_events_request_idx ON mobility.support_events(support_request_id, id);

INSERT INTO mobility.support_events (support_request_id, action, to_status, created_at)
SELECT id, 'created', status, created_at FROM mobility.support_requests;

ALTER TABLE mobility.rides
  ADD COLUMN review_resolved_at timestamptz,
  ADD COLUMN review_resolved_by uuid REFERENCES mobility.operators(id),
  ADD COLUMN review_note varchar(1000);
CREATE INDEX rides_open_review_idx ON mobility.rides(updated_at DESC, id)
  WHERE needs_review AND review_resolved_at IS NULL;
CREATE INDEX rides_created_idx ON mobility.rides(created_at DESC, id);

ALTER TABLE mobility.refunds
  ADD COLUMN operator_id uuid REFERENCES mobility.operators(id);
