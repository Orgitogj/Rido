CREATE TABLE mobility.vehicle_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name varchar(60) NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description varchar(300) NOT NULL DEFAULT '',
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 8),
  status varchar(10) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  is_development boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX vehicle_categories_one_default
  ON mobility.vehicle_categories(is_default) WHERE is_default;

CREATE TABLE mobility.vehicle_category_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_category_id uuid NOT NULL REFERENCES mobility.vehicle_categories(id),
  actor varchar(10) NOT NULL CHECK (actor IN ('operator', 'cli', 'system')),
  operator_id uuid REFERENCES mobility.operators(id),
  action varchar(40) NOT NULL,
  reason varchar(500),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK ((actor = 'operator') = (operator_id IS NOT NULL))
);
CREATE INDEX vehicle_category_events_idx
  ON mobility.vehicle_category_events(vehicle_category_id, id);

INSERT INTO mobility.vehicle_categories
  (id, code, name, description, capacity, status, is_development, is_default, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'general', 'Standard',
   'Created when vehicle categories were introduced. Every vehicle approved before then is in this category. Rename it or adjust it in the operations console.',
   4, 'active', false, true, now(), now());

INSERT INTO mobility.vehicle_category_events
  (vehicle_category_id, actor, action, reason, snapshot, created_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'system', 'created_by_migration',
   'Default category for vehicles and fare policies that existed before categories.',
   '{"code": "general"}'::jsonb, now());

CREATE TABLE mobility.driver_vehicle_categories (
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  vehicle_category_id uuid NOT NULL REFERENCES mobility.vehicle_categories(id),
  source varchar(10) NOT NULL CHECK (source IN ('operator', 'cli', 'migration')),
  granted_by uuid REFERENCES mobility.operators(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (driver_profile_id, vehicle_category_id),
  CHECK ((source = 'operator') = (granted_by IS NOT NULL))
);
CREATE INDEX driver_vehicle_categories_category_idx
  ON mobility.driver_vehicle_categories(vehicle_category_id, driver_profile_id);

INSERT INTO mobility.driver_vehicle_categories
  (driver_profile_id, vehicle_category_id, source, created_at)
SELECT dp.id, '00000000-0000-4000-8000-000000000001', 'migration', now()
  FROM mobility.driver_profiles dp
 WHERE dp.status IN ('approved', 'suspended') AND dp.deleted_at IS NULL;

INSERT INTO mobility.driver_review_events
  (driver_profile_id, actor, action, reason, created_at)
SELECT dp.id, 'system', 'categories_migrated',
       'Placed in the default vehicle category when categories were introduced.', now()
  FROM mobility.driver_profiles dp
 WHERE dp.status IN ('approved', 'suspended') AND dp.deleted_at IS NULL;

ALTER TABLE mobility.fare_policies
  ADD COLUMN vehicle_category_id uuid NOT NULL
    DEFAULT '00000000-0000-4000-8000-000000000001'
    REFERENCES mobility.vehicle_categories(id);
DROP INDEX mobility.fare_policies_effective_idx;
CREATE INDEX fare_policies_effective_idx
  ON mobility.fare_policies(service_area_id, vehicle_category_id, effective_from DESC)
  WHERE status = 'scheduled';

ALTER TABLE mobility.quotes
  ADD COLUMN vehicle_category_id uuid REFERENCES mobility.vehicle_categories(id),
  ADD COLUMN vehicle_category_name varchar(60),
  ADD COLUMN passenger_count integer NOT NULL DEFAULT 1 CHECK (passenger_count BETWEEN 1 AND 8);

ALTER TABLE mobility.rides
  ADD COLUMN vehicle_category_id uuid REFERENCES mobility.vehicle_categories(id),
  ADD COLUMN vehicle_category_name varchar(60),
  ADD COLUMN passenger_count integer NOT NULL DEFAULT 1 CHECK (passenger_count BETWEEN 1 AND 8);
