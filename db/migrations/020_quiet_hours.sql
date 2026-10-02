ALTER TABLE mobility.notification_preferences
  ADD COLUMN quiet_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN quiet_start_minute smallint CHECK (quiet_start_minute BETWEEN 0 AND 1439),
  ADD COLUMN quiet_end_minute smallint CHECK (quiet_end_minute BETWEEN 0 AND 1439),
  ADD COLUMN quiet_timezone varchar(64),
  ADD CONSTRAINT notification_preferences_quiet_check CHECK (
    (quiet_start_minute IS NULL) = (quiet_end_minute IS NULL)
    AND (quiet_start_minute IS NULL) = (quiet_timezone IS NULL)
    AND (NOT quiet_enabled OR quiet_start_minute IS NOT NULL)
    AND (quiet_start_minute IS NULL OR quiet_start_minute <> quiet_end_minute));
