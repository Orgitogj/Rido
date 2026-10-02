ALTER TABLE mobility.rides
  ADD COLUMN pin_nonce varchar(64),
  ADD COLUMN pin_failed_attempts integer NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  ADD COLUMN pin_lockouts integer NOT NULL DEFAULT 0 CHECK (pin_lockouts >= 0),
  ADD COLUMN pin_locked_until timestamptz,
  ADD COLUMN pin_verified_at timestamptz,
  ADD COLUMN pin_waived_at timestamptz,
  ADD COLUMN pin_waived_by uuid REFERENCES mobility.operators(id),
  ADD CONSTRAINT rides_pin_waiver_check
    CHECK ((pin_waived_at IS NULL) = (pin_waived_by IS NULL));
