ALTER TABLE mobility.drivers RENAME TO demo_drivers;
ALTER TABLE mobility.quotes RENAME COLUMN driver_id TO demo_driver_id;
ALTER TABLE mobility.quotes ALTER COLUMN demo_driver_id DROP NOT NULL;
ALTER TABLE mobility.quotes ALTER COLUMN pickup_eta_seconds DROP NOT NULL;
ALTER TABLE mobility.rides RENAME COLUMN driver_id TO demo_driver_id;
ALTER TABLE mobility.rides ALTER COLUMN demo_driver_id DROP NOT NULL;

CREATE TABLE mobility.driver_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES mobility.users(id),
  display_name varchar(100) NOT NULL,
  vehicle_make varchar(60) NOT NULL,
  vehicle_model varchar(60) NOT NULL,
  vehicle_plate varchar(20) NOT NULL,
  vehicle_seats integer NOT NULL CHECK (vehicle_seats BETWEEN 1 AND 8),
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended')),
  online boolean NOT NULL DEFAULT false,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  location_updated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT online OR (status = 'approved' AND latitude IS NOT NULL AND longitude IS NOT NULL))
);
CREATE INDEX driver_profiles_online_idx ON mobility.driver_profiles(last_seen_at)
  WHERE online AND status = 'approved';

ALTER TABLE mobility.rides ADD COLUMN status varchar(20);
UPDATE mobility.rides SET status = 'legacy';
ALTER TABLE mobility.rides
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'awaiting_payment',
  ADD CONSTRAINT rides_status_check CHECK (status IN (
    'awaiting_payment', 'requested', 'offered', 'accepted', 'arriving',
    'arrived', 'in_progress', 'completed', 'cancelled', 'no_driver', 'legacy'));

ALTER TABLE mobility.rides
  ADD COLUMN driver_profile_id uuid REFERENCES mobility.driver_profiles(id),
  ADD COLUMN distance_meters integer,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN authorized_at timestamptz,
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN search_deadline timestamptz,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN arriving_at timestamptz,
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by varchar(20) CHECK (cancelled_by IN ('passenger', 'driver', 'system')),
  ADD COLUMN cancel_reason varchar(40),
  ADD CONSTRAINT rides_driver_assigned_check CHECK (
    status NOT IN ('accepted', 'arriving', 'arrived', 'in_progress', 'completed')
    OR driver_profile_id IS NOT NULL);

ALTER TABLE mobility.rides DROP CONSTRAINT rides_payment_status_check;
ALTER TABLE mobility.rides ADD CONSTRAINT rides_payment_status_check CHECK (payment_status IN
  ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed', 'cancelled'));

CREATE UNIQUE INDEX rides_one_active_per_driver ON mobility.rides(driver_profile_id)
  WHERE status IN ('accepted', 'arriving', 'arrived', 'in_progress');
CREATE UNIQUE INDEX rides_one_active_per_passenger ON mobility.rides(user_id)
  WHERE status IN ('requested', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress');
CREATE INDEX rides_matching_idx ON mobility.rides(requested_at)
  WHERE status IN ('requested', 'offered');
CREATE INDEX rides_driver_history_idx ON mobility.rides(driver_profile_id, created_at DESC);

CREATE TABLE mobility.ride_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  distance_meters integer NOT NULL CHECK (distance_meters >= 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (ride_id, driver_profile_id),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX ride_offers_one_pending_per_ride ON mobility.ride_offers(ride_id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX ride_offers_one_pending_per_driver ON mobility.ride_offers(driver_profile_id)
  WHERE status = 'pending';

CREATE TABLE mobility.ride_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  from_status varchar(20) NOT NULL,
  to_status varchar(20) NOT NULL,
  actor varchar(20) NOT NULL CHECK (actor IN ('passenger', 'driver', 'system')),
  actor_user_id uuid REFERENCES mobility.users(id),
  reason varchar(40),
  created_at timestamptz NOT NULL
);
CREATE INDEX ride_events_ride_idx ON mobility.ride_events(ride_id, id);
