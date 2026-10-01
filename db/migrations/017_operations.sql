CREATE TABLE mobility.rate_limits (
  key varchar(120) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window_idx ON mobility.rate_limits(window_start);

CREATE TABLE mobility.job_status (
  name varchar(40) PRIMARY KEY,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok_at timestamptz,
  last_error varchar(200),
  runs bigint NOT NULL DEFAULT 0,
  failures bigint NOT NULL DEFAULT 0
);

CREATE INDEX support_requests_user_page_idx
  ON mobility.support_requests(user_id, created_at DESC, id DESC);
