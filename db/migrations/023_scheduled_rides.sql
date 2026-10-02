ALTER TABLE mobility.service_areas
  ADD COLUMN timezone varchar(64) NOT NULL DEFAULT 'UTC';

CREATE TABLE mobility.scheduled_rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  client_request_id uuid NOT NULL,
  pickup_address varchar(300) NOT NULL,
  pickup_latitude double precision NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude double precision NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  destination_address varchar(300) NOT NULL,
  destination_latitude double precision NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude double precision NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  stops jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(stops) = 'array' AND jsonb_array_length(stops) <= 2),
  vehicle_category_id uuid REFERENCES mobility.vehicle_categories(id),
  passenger_count integer NOT NULL DEFAULT 1 CHECK (passenger_count BETWEEN 1 AND 8),
  service_area_id uuid NOT NULL REFERENCES mobility.service_areas(id),
  timezone varchar(64) NOT NULL,
  local_time varchar(16) NOT NULL CHECK (local_time ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  pickup_at timestamptz NOT NULL,
  confirm_opens_at timestamptz NOT NULL,
  confirm_deadline timestamptz NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'scheduled' CHECK (status IN
    ('scheduled', 'awaiting_confirmation', 'confirmed', 'cancelled', 'expired')),
  end_reason varchar(40),
  ride_id uuid UNIQUE REFERENCES mobility.rides(id),
  notified_at timestamptz,
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, client_request_id),
  CHECK (confirm_opens_at < pickup_at AND pickup_at <= confirm_deadline),
  CHECK ((status IN ('cancelled', 'expired')) = (ended_at IS NOT NULL)),
  CHECK (status <> 'confirmed' OR ride_id IS NOT NULL)
);
CREATE INDEX scheduled_rides_open_idx
  ON mobility.scheduled_rides(confirm_opens_at) WHERE status = 'scheduled';
CREATE INDEX scheduled_rides_awaiting_idx
  ON mobility.scheduled_rides(confirm_deadline) WHERE status = 'awaiting_confirmation';
CREATE INDEX scheduled_rides_user_idx
  ON mobility.scheduled_rides(user_id, pickup_at DESC, id DESC);

ALTER TABLE mobility.quotes
  ADD COLUMN scheduled_ride_id uuid REFERENCES mobility.scheduled_rides(id);
