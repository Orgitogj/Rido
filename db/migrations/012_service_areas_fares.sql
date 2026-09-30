ALTER TABLE mobility.operators
  ADD COLUMN can_configure boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT operators_configure_requires_view CHECK (NOT can_configure OR can_view);

CREATE TABLE mobility.service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name varchar(80) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  boundary jsonb NOT NULL CHECK (
    jsonb_typeof(boundary) = 'array'
    AND jsonb_array_length(boundary) BETWEEN 3 AND 100),
  min_latitude double precision NOT NULL,
  max_latitude double precision NOT NULL,
  min_longitude double precision NOT NULL,
  max_longitude double precision NOT NULL,
  dropoff_rule varchar(20) NOT NULL DEFAULT 'inside_area'
    CHECK (dropoff_rule IN ('inside_area', 'anywhere')),
  is_development boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES mobility.operators(id),
  updated_by uuid REFERENCES mobility.operators(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (min_latitude <= max_latitude AND min_longitude <= max_longitude)
);
CREATE INDEX service_areas_active_bbox_idx
  ON mobility.service_areas(min_latitude, max_latitude, min_longitude, max_longitude)
  WHERE status = 'active';

CREATE TABLE mobility.service_area_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_area_id uuid NOT NULL REFERENCES mobility.service_areas(id),
  actor varchar(10) NOT NULL CHECK (actor IN ('operator', 'cli', 'system')),
  operator_id uuid REFERENCES mobility.operators(id),
  action varchar(40) NOT NULL,
  reason varchar(500),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK ((actor = 'operator') = (operator_id IS NOT NULL))
);
CREATE INDEX service_area_events_area_idx ON mobility.service_area_events(service_area_id, id);

CREATE TABLE mobility.fare_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_area_id uuid NOT NULL REFERENCES mobility.service_areas(id),
  version integer NOT NULL CHECK (version > 0),
  label varchar(80) NOT NULL,
  is_development boolean NOT NULL DEFAULT true,
  currency char(3) NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  base_cents integer NOT NULL CHECK (base_cents BETWEEN 0 AND 100000),
  per_km_cents integer NOT NULL CHECK (per_km_cents BETWEEN 0 AND 100000),
  per_minute_cents integer NOT NULL CHECK (per_minute_cents BETWEEN 0 AND 100000),
  minimum_fare_cents integer NOT NULL CHECK (minimum_fare_cents BETWEEN 50 AND 1000000),
  effective_from timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  reason varchar(500) NOT NULL,
  created_by uuid REFERENCES mobility.operators(id),
  created_at timestamptz NOT NULL,
  cancelled_by uuid REFERENCES mobility.operators(id),
  cancelled_at timestamptz,
  cancel_reason varchar(500),
  UNIQUE (service_area_id, version),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX fare_policies_effective_idx
  ON mobility.fare_policies(service_area_id, effective_from DESC) WHERE status = 'scheduled';

ALTER TABLE mobility.quotes
  ALTER COLUMN pricing_version TYPE varchar(60),
  ADD COLUMN service_area_id uuid REFERENCES mobility.service_areas(id),
  ADD COLUMN fare_policy_id uuid REFERENCES mobility.fare_policies(id),
  ADD COLUMN route_source varchar(20),
  ADD COLUMN base_cents integer,
  ADD COLUMN distance_cents integer,
  ADD COLUMN time_cents integer,
  ADD COLUMN minimum_applied boolean,
  ADD CONSTRAINT quotes_route_source_check
    CHECK (route_source IS NULL OR route_source IN ('google_routes', 'test_provider')),
  ADD CONSTRAINT quotes_policy_complete_check
    CHECK ((fare_policy_id IS NULL) = (route_source IS NULL)
       AND (fare_policy_id IS NULL) = (base_cents IS NULL));
CREATE INDEX quotes_user_recent_idx ON mobility.quotes(user_id, created_at DESC);

ALTER TABLE mobility.rides
  ADD COLUMN pricing_version varchar(60),
  ADD COLUMN service_area_id uuid REFERENCES mobility.service_areas(id),
  ADD COLUMN fare_policy_id uuid REFERENCES mobility.fare_policies(id),
  ADD COLUMN route_source varchar(20),
  ADD COLUMN ranking_computed_at timestamptz,
  ADD COLUMN ranking_claimed_at timestamptz,
  ADD COLUMN ranking_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN ranking_retry_at timestamptz;

UPDATE mobility.rides r
   SET pricing_version = q.pricing_version
  FROM mobility.quotes q
 WHERE q.id = r.quote_id AND r.pricing_version IS NULL;

CREATE TABLE mobility.match_rankings (
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  straight_meters integer NOT NULL CHECK (straight_meters >= 0),
  road_duration_seconds integer CHECK (road_duration_seconds >= 0),
  road_distance_meters integer CHECK (road_distance_meters >= 0),
  reachable boolean NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (ride_id, driver_profile_id),
  CHECK (reachable OR road_duration_seconds IS NULL)
);

ALTER TABLE mobility.ride_offers
  ADD COLUMN road_duration_seconds integer CHECK (road_duration_seconds >= 0),
  ADD COLUMN ranking_source varchar(20)
    CHECK (ranking_source IS NULL OR ranking_source IN ('road', 'straight_line'));

CREATE TABLE mobility.routing_usage (
  api varchar(20) NOT NULL CHECK (api IN ('routes', 'route_matrix')),
  minute timestamptz NOT NULL,
  units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (api, minute)
);
