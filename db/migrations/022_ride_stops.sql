ALTER TABLE mobility.quotes
  ADD COLUMN stops jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(stops) = 'array' AND jsonb_array_length(stops) <= 2);

ALTER TABLE mobility.rides
  ADD COLUMN stops jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(stops) = 'array' AND jsonb_array_length(stops) <= 2),
  ADD COLUMN stops_completed integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT rides_stops_completed_check
    CHECK (stops_completed >= 0 AND stops_completed <= jsonb_array_length(stops));
