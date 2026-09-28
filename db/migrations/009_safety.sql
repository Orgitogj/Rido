CREATE TABLE mobility.safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  reporter_user_id uuid NOT NULL REFERENCES mobility.users(id),
  reporter_role varchar(10) NOT NULL CHECK (reporter_role IN ('passenger', 'driver')),
  reporter_driver_profile_id uuid REFERENCES mobility.driver_profiles(id),
  client_report_id uuid NOT NULL,
  category varchar(30) NOT NULL CHECK (category IN (
    'unsafe_driving', 'harassment', 'vehicle_mismatch', 'accident', 'other')),
  description varchar(2000) NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  status varchar(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  assigned_operator_id uuid REFERENCES mobility.operators(id),
  resolution_note varchar(1000),
  version integer NOT NULL DEFAULT 1,
  evidence_retained_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz,
  UNIQUE (reporter_user_id, client_report_id),
  CHECK ((reporter_role = 'driver') = (reporter_driver_profile_id IS NOT NULL)),
  CHECK ((status IN ('resolved', 'dismissed')) = (closed_at IS NOT NULL)),
  CHECK (status NOT IN ('resolved', 'dismissed') OR evidence_retained_until IS NOT NULL)
);
CREATE INDEX safety_reports_ride_idx ON mobility.safety_reports(ride_id, created_at);
CREATE INDEX safety_reports_reporter_idx ON mobility.safety_reports(reporter_user_id, created_at DESC);
CREATE INDEX safety_reports_queue_idx ON mobility.safety_reports(status, created_at DESC, id);

CREATE TABLE mobility.safety_report_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES mobility.safety_reports(id),
  actor varchar(10) NOT NULL CHECK (actor IN ('reporter', 'operator', 'system')),
  operator_id uuid REFERENCES mobility.operators(id),
  action varchar(30) NOT NULL CHECK (action IN (
    'created', 'message_attached', 'assigned', 'status_changed', 'note_added',
    'evidence_redacted')),
  from_status varchar(20),
  to_status varchar(20),
  note varchar(1000),
  created_at timestamptz NOT NULL,
  CHECK ((actor = 'operator') = (operator_id IS NOT NULL))
);
CREATE INDEX safety_report_events_report_idx ON mobility.safety_report_events(report_id, id);

CREATE TABLE mobility.safety_report_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES mobility.safety_reports(id),
  message_id uuid NOT NULL,
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  message_seq integer NOT NULL,
  sender_role varchar(10) NOT NULL CHECK (sender_role IN ('passenger', 'driver')),
  snapshot_body varchar(500),
  message_created_at timestamptz NOT NULL,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (report_id, message_id),
  CHECK ((snapshot_body IS NULL) = (redacted_at IS NOT NULL))
);
CREATE INDEX safety_report_messages_message_idx ON mobility.safety_report_messages(message_id);

CREATE TABLE mobility.trip_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  created_by uuid NOT NULL REFERENCES mobility.users(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX trip_shares_ride_idx ON mobility.trip_shares(ride_id, created_at);
