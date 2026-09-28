ALTER TABLE mobility.refunds
  ADD COLUMN source varchar(20) NOT NULL DEFAULT 'operator'
    CHECK (source IN ('operator', 'stripe'));
DROP INDEX mobility.refunds_one_in_flight_per_ride;
CREATE UNIQUE INDEX refunds_one_in_flight_per_ride ON mobility.refunds(ride_id)
  WHERE status IN ('creating', 'pending', 'requires_action') AND source = 'operator';

CREATE TABLE mobility.tip_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id uuid NOT NULL REFERENCES mobility.tips(id),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  status varchar(20) NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  source varchar(20) NOT NULL CHECK (source IN ('operator', 'stripe')),
  reason varchar(200) NOT NULL,
  operator_id uuid REFERENCES mobility.operators(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  stripe_refund_id varchar(100) UNIQUE,
  last_error varchar(200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((source = 'operator') = (operator_id IS NOT NULL))
);
CREATE UNIQUE INDEX tip_refunds_one_in_flight ON mobility.tip_refunds(tip_id)
  WHERE status IN ('creating', 'pending', 'requires_action') AND source = 'operator';
CREATE INDEX tip_refunds_tip_idx ON mobility.tip_refunds(tip_id, created_at);

CREATE TABLE mobility.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id varchar(100) NOT NULL UNIQUE,
  subject varchar(10) NOT NULL CHECK (subject IN ('fare', 'tip', 'unknown')),
  ride_id uuid REFERENCES mobility.rides(id),
  tip_id uuid REFERENCES mobility.tips(id),
  stripe_payment_intent_id varchar(100),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency varchar(3) NOT NULL,
  status varchar(30) NOT NULL,
  reason varchar(60),
  funds_withdrawn_cents integer NOT NULL DEFAULT 0 CHECK (funds_withdrawn_cents >= 0),
  funds_reinstated_cents integer NOT NULL DEFAULT 0 CHECK (funds_reinstated_cents >= 0),
  needs_review boolean NOT NULL DEFAULT false,
  review_note varchar(300),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz,
  CHECK ((subject = 'tip') = (tip_id IS NOT NULL)),
  CHECK (subject = 'unknown' OR ride_id IS NOT NULL)
);
CREATE INDEX disputes_ride_idx ON mobility.disputes(ride_id, created_at);
CREATE INDEX disputes_open_idx ON mobility.disputes(updated_at)
  WHERE closed_at IS NULL;

ALTER TABLE mobility.earning_entries
  ADD COLUMN dispute_id uuid REFERENCES mobility.disputes(id);
ALTER TABLE mobility.earning_entries DROP CONSTRAINT earning_entries_kind_check;
ALTER TABLE mobility.earning_entries ADD CONSTRAINT earning_entries_kind_check
  CHECK (kind IN ('ride_earning', 'tip', 'fare_refund_adjustment', 'tip_refund_adjustment',
                  'dispute_withdrawal', 'dispute_reinstatement'));
ALTER TABLE mobility.earning_entries DROP CONSTRAINT earning_entries_check1;
ALTER TABLE mobility.earning_entries ADD CONSTRAINT earning_entries_sign_check
  CHECK ((kind IN ('ride_earning', 'tip', 'dispute_reinstatement')) = (gross_cents > 0));
ALTER TABLE mobility.earning_entries ADD CONSTRAINT earning_entries_dispute_check
  CHECK ((kind IN ('dispute_withdrawal', 'dispute_reinstatement')) = (dispute_id IS NOT NULL));
CREATE INDEX earning_entries_dispute_idx ON mobility.earning_entries(dispute_id)
  WHERE dispute_id IS NOT NULL;
