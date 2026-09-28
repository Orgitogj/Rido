CREATE TABLE mobility.ride_earnings (
  ride_id uuid PRIMARY KEY REFERENCES mobility.rides(id),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  currency char(3) NOT NULL CHECK (currency = 'usd'),
  fare_cents integer NOT NULL CHECK (fare_cents > 0),
  commission_policy_version varchar(40) NOT NULL,
  commission_rate_bps integer NOT NULL CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  commission_cents integer NOT NULL CHECK (commission_cents >= 0),
  driver_share_cents integer NOT NULL CHECK (driver_share_cents >= 0),
  stripe_payment_intent_id varchar(100) NOT NULL,
  earned_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (commission_cents + driver_share_cents = fare_cents)
);
CREATE INDEX ride_earnings_driver_idx
  ON mobility.ride_earnings(driver_profile_id, earned_at DESC, ride_id);

CREATE TABLE mobility.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'usd'),
  status varchar(20) NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'requires_action', 'processing',
                      'failed', 'succeeded', 'canceled')),
  idempotency_key uuid NOT NULL UNIQUE,
  stripe_payment_intent_id varchar(100) UNIQUE,
  refunded_cents integer NOT NULL DEFAULT 0,
  last_error varchar(200),
  paid_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  CHECK ((status = 'succeeded') = (paid_at IS NOT NULL))
);
CREATE UNIQUE INDEX tips_one_active_per_ride
  ON mobility.tips(ride_id) WHERE status <> 'canceled';
CREATE INDEX tips_open_idx ON mobility.tips(updated_at)
  WHERE status IN ('creating', 'pending', 'requires_action', 'processing', 'failed');

CREATE TABLE mobility.earning_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  tip_id uuid REFERENCES mobility.tips(id),
  kind varchar(30) NOT NULL CHECK (kind IN (
    'ride_earning', 'tip', 'fare_refund_adjustment', 'tip_refund_adjustment')),
  currency char(3) NOT NULL CHECK (currency = 'usd'),
  gross_cents integer NOT NULL,
  commission_cents integer NOT NULL,
  driver_amount_cents integer NOT NULL,
  policy_version varchar(40) NOT NULL,
  source_key varchar(120) NOT NULL UNIQUE,
  stripe_object_id varchar(100),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (gross_cents = commission_cents + driver_amount_cents),
  CHECK ((kind IN ('ride_earning', 'tip')) = (gross_cents > 0))
);
CREATE INDEX earning_entries_driver_idx
  ON mobility.earning_entries(driver_profile_id, occurred_at DESC, id);
CREATE INDEX earning_entries_ride_idx ON mobility.earning_entries(ride_id, id);
