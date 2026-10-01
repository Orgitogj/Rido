ALTER TABLE mobility.rides
  ADD COLUMN passenger_name varchar(100);

UPDATE mobility.rides r
   SET passenger_name = u.name
  FROM mobility.users u
 WHERE u.id = r.user_id AND r.passenger_name IS NULL;

ALTER TABLE mobility.users
  ADD COLUMN language varchar(5) CHECK (language IS NULL OR language IN ('en', 'sq'));

CREATE TABLE mobility.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  kind varchar(10) NOT NULL CHECK (kind IN ('home', 'work', 'custom')),
  label varchar(40),
  address varchar(300) NOT NULL CHECK (char_length(address) BETWEEN 1 AND 300),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  provider_place_id varchar(300),
  client_place_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((kind = 'custom') = (label IS NOT NULL)),
  UNIQUE (user_id, client_place_id)
);
CREATE UNIQUE INDEX saved_places_one_home_work
  ON mobility.saved_places(user_id, kind) WHERE kind IN ('home', 'work');
CREATE INDEX saved_places_user_idx ON mobility.saved_places(user_id, created_at);
