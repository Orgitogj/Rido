ALTER TABLE mobility.driver_profiles
  ADD COLUMN location_accuracy_m real CHECK (location_accuracy_m >= 0),
  ADD COLUMN location_heading real CHECK (location_heading >= 0 AND location_heading < 360),
  ADD COLUMN location_speed_mps real CHECK (location_speed_mps >= 0),
  ADD COLUMN location_received_at timestamptz,
  ADD COLUMN location_seq bigint NOT NULL DEFAULT 0;

CREATE TABLE mobility.ride_routes (
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  leg varchar(20) NOT NULL CHECK (leg IN ('pickup', 'destination')),
  origin_latitude double precision NOT NULL CHECK (origin_latitude BETWEEN -90 AND 90),
  origin_longitude double precision NOT NULL CHECK (origin_longitude BETWEEN -180 AND 180),
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  distance_meters integer NOT NULL CHECK (distance_meters >= 0),
  polyline text,
  source varchar(20) NOT NULL CHECK (source IN ('routed', 'estimate')),
  computed_at timestamptz NOT NULL,
  refreshing_until timestamptz,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ride_id, leg)
);

CREATE TABLE mobility.push_tokens (
  token varchar(200) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  platform varchar(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  disabled_reason varchar(40)
);
CREATE INDEX push_tokens_active_user_idx ON mobility.push_tokens(user_id)
  WHERE disabled_at IS NULL;

CREATE TABLE mobility.notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  ride_id uuid REFERENCES mobility.rides(id),
  kind varchar(30) NOT NULL,
  dedupe_key varchar(200) NOT NULL UNIQUE,
  title varchar(100) NOT NULL,
  body varchar(200) NOT NULL,
  data jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error varchar(100)
);
CREATE INDEX notifications_due_idx ON mobility.notifications(id)
  WHERE status IN ('pending', 'sending');

CREATE TABLE mobility.push_tickets (
  ticket_id varchar(100) PRIMARY KEY,
  notification_id bigint NOT NULL REFERENCES mobility.notifications(id),
  token varchar(200) NOT NULL,
  created_at timestamptz NOT NULL,
  checked_at timestamptz
);
CREATE INDEX push_tickets_unchecked_idx ON mobility.push_tickets(created_at)
  WHERE checked_at IS NULL;
