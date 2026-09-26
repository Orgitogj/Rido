ALTER TABLE mobility.rides DROP CONSTRAINT rides_status_check;
ALTER TABLE mobility.rides ADD CONSTRAINT rides_status_check CHECK (status IN (
  'awaiting_payment', 'requested', 'offered', 'accepted', 'arriving',
  'arrived', 'in_progress', 'completed', 'cancelled', 'no_driver',
  'interrupted', 'legacy'));

ALTER TABLE mobility.rides DROP CONSTRAINT rides_payment_status_check;
ALTER TABLE mobility.rides ADD CONSTRAINT rides_payment_status_check CHECK (payment_status IN
  ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
   'cancelled', 'expired'));

ALTER TABLE mobility.rides
  ADD COLUMN rematch_count integer NOT NULL DEFAULT 0 CHECK (rematch_count >= 0),
  ADD COLUMN interrupted_at timestamptz,
  ADD COLUMN captured_cents integer CHECK (captured_cents >= 0),
  ADD COLUMN refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  ADD COLUMN authorization_expires_at timestamptz,
  ADD COLUMN settled_at timestamptz,
  ADD COLUMN settlement_attempts integer NOT NULL DEFAULT 0 CHECK (settlement_attempts >= 0),
  ADD COLUMN settlement_error varchar(100),
  ADD COLUMN next_settlement_at timestamptz,
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN review_reason varchar(60),
  ADD CONSTRAINT rides_refund_within_capture_check
    CHECK (refunded_cents <= COALESCE(captured_cents, 0) OR status = 'legacy');

UPDATE mobility.rides SET captured_cents = fare_cents
 WHERE payment_status = 'paid' AND captured_cents IS NULL;

CREATE INDEX rides_settlement_due_idx ON mobility.rides(next_settlement_at)
  WHERE settled_at IS NULL AND status IN ('completed', 'cancelled', 'no_driver', 'interrupted');
CREATE INDEX rides_review_idx ON mobility.rides(created_at) WHERE needs_review;

ALTER TABLE mobility.ride_offers DROP CONSTRAINT ride_offers_status_check;
ALTER TABLE mobility.ride_offers ADD CONSTRAINT ride_offers_status_check CHECK (status IN
  ('pending', 'accepted', 'declined', 'expired', 'cancelled', 'withdrawn'));

ALTER TABLE mobility.ride_events DROP CONSTRAINT ride_events_actor_check;
ALTER TABLE mobility.ride_events ADD CONSTRAINT ride_events_actor_check
  CHECK (actor IN ('passenger', 'driver', 'system', 'operator'));

CREATE TABLE mobility.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  user_id uuid NOT NULL REFERENCES mobility.users(id),
  category varchar(30) NOT NULL
    CHECK (category IN ('charge_question', 'trip_problem', 'driver_issue', 'other')),
  message varchar(1000) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX support_requests_open_idx ON mobility.support_requests(created_at)
  WHERE status = 'open';

CREATE TABLE mobility.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  status varchar(20) NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  reason varchar(200) NOT NULL,
  operator varchar(100) NOT NULL,
  support_request_id uuid REFERENCES mobility.support_requests(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  stripe_refund_id varchar(100) UNIQUE,
  last_error varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refunds_one_in_flight_per_ride ON mobility.refunds(ride_id)
  WHERE status IN ('creating', 'pending', 'requires_action');
CREATE INDEX refunds_ride_idx ON mobility.refunds(ride_id, created_at);

CREATE TABLE mobility.payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  kind varchar(30) NOT NULL CHECK (kind IN (
    'authorized', 'captured', 'released', 'expired', 'refund_requested',
    'refund_succeeded', 'refund_failed', 'settlement_failed', 'capture_skipped_expired')),
  amount_cents integer CHECK (amount_cents >= 0),
  stripe_object_id varchar(100),
  actor varchar(100) NOT NULL,
  detail varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_ride_idx ON mobility.payment_events(ride_id, id);
