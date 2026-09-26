CREATE SCHEMA IF NOT EXISTS mobility;

CREATE TABLE mobility.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id varchar(100) NOT NULL UNIQUE,
  name varchar(100),
  stripe_customer_id varchar(100) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mobility.drivers (
  id integer PRIMARY KEY,
  first_name varchar(60) NOT NULL,
  last_name varchar(60) NOT NULL,
  profile_image_url text,
  car_image_url text,
  car_seats integer NOT NULL CHECK (car_seats BETWEEN 1 AND 8),
  rating numeric(2, 1) NOT NULL CHECK (rating BETWEEN 0 AND 5),
  fare_multiplier_bp integer NOT NULL DEFAULT 10000 CHECK (fare_multiplier_bp BETWEEN 5000 AND 30000),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE mobility.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  driver_id integer NOT NULL REFERENCES mobility.drivers(id),
  pickup_address varchar(300) NOT NULL,
  pickup_latitude double precision NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude double precision NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  destination_address varchar(300) NOT NULL,
  destination_latitude double precision NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude double precision NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  distance_meters integer NOT NULL CHECK (distance_meters > 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  pickup_eta_seconds integer NOT NULL CHECK (pickup_eta_seconds >= 0),
  fare_cents integer NOT NULL CHECK (fare_cents > 0),
  currency char(3) NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  pricing_version varchar(20) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_user_idx ON mobility.quotes(user_id, created_at DESC);

CREATE TABLE mobility.rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL UNIQUE REFERENCES mobility.quotes(id),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  driver_id integer NOT NULL REFERENCES mobility.drivers(id),
  origin_address varchar(300) NOT NULL,
  origin_latitude double precision NOT NULL,
  origin_longitude double precision NOT NULL,
  destination_address varchar(300) NOT NULL,
  destination_latitude double precision NOT NULL,
  destination_longitude double precision NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  fare_cents integer NOT NULL CHECK (fare_cents > 0),
  currency char(3) NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  payment_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN
    ('pending', 'requires_action', 'processing', 'paid', 'failed', 'cancelled')),
  stripe_payment_intent_id varchar(100) UNIQUE,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX rides_user_history_idx ON mobility.rides(user_id, created_at DESC);

CREATE TABLE mobility.stripe_events (
  event_id varchar(100) PRIMARY KEY,
  type varchar(100) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
