ALTER TABLE mobility.quotes DROP CONSTRAINT quotes_currency_check;
ALTER TABLE mobility.quotes ADD CONSTRAINT quotes_currency_check
  CHECK (currency IN ('usd', 'all'));
ALTER TABLE mobility.rides DROP CONSTRAINT rides_currency_check;
ALTER TABLE mobility.rides ADD CONSTRAINT rides_currency_check
  CHECK (currency IN ('usd', 'all'));
ALTER TABLE mobility.fare_policies DROP CONSTRAINT fare_policies_currency_check;
ALTER TABLE mobility.fare_policies ADD CONSTRAINT fare_policies_currency_check
  CHECK (currency IN ('usd', 'all'));
ALTER TABLE mobility.ride_earnings DROP CONSTRAINT ride_earnings_currency_check;
ALTER TABLE mobility.ride_earnings ADD CONSTRAINT ride_earnings_currency_check
  CHECK (currency IN ('usd', 'all'));
ALTER TABLE mobility.earning_entries DROP CONSTRAINT earning_entries_currency_check;
ALTER TABLE mobility.earning_entries ADD CONSTRAINT earning_entries_currency_check
  CHECK (currency IN ('usd', 'all'));

ALTER TABLE mobility.rides
  ADD COLUMN payment_method varchar(12) NOT NULL DEFAULT 'card_online'
    CHECK (payment_method IN ('card_online', 'in_vehicle')),
  ADD COLUMN collection_status varchar(10)
    CHECK (collection_status IN ('pending', 'collected', 'unpaid', 'waived')),
  ADD COLUMN collection_method varchar(10)
    CHECK (collection_method IN ('pos', 'cash')),
  ADD COLUMN collected_at timestamptz,
  ADD COLUMN collection_recorded_by varchar(10)
    CHECK (collection_recorded_by IN ('driver', 'operator')),
  ADD COLUMN collection_operator_id uuid REFERENCES mobility.operators(id),
  ADD COLUMN collection_note varchar(500),
  ADD CONSTRAINT rides_collection_check CHECK (
    (collection_status IS NULL OR payment_method = 'in_vehicle')
    AND ((collection_status = 'collected') = (collection_method IS NOT NULL))
    AND ((collection_status = 'collected') = (collected_at IS NOT NULL)));

CREATE INDEX rides_unpaid_idx ON mobility.rides(user_id)
  WHERE collection_status = 'unpaid';
CREATE INDEX rides_collection_pending_idx ON mobility.rides(completed_at)
  WHERE collection_status = 'pending';

ALTER TABLE mobility.ride_earnings
  ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

ALTER TABLE mobility.earning_entries
  ADD COLUMN funds_held_by varchar(10) NOT NULL DEFAULT 'platform'
    CHECK (funds_held_by IN ('platform', 'driver'));

CREATE TABLE mobility.driver_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  direction varchar(12) NOT NULL CHECK (direction IN ('to_driver', 'from_driver')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency IN ('usd', 'all')),
  method varchar(20) NOT NULL CHECK (method IN ('bank_transfer', 'cash')),
  reference varchar(100),
  note varchar(500),
  operator_id uuid NOT NULL REFERENCES mobility.operators(id),
  idempotency_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE INDEX driver_settlements_driver_idx
  ON mobility.driver_settlements(driver_profile_id, created_at DESC, id);
