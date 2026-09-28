CREATE TABLE mobility.ride_chats (
  ride_id uuid PRIMARY KEY REFERENCES mobility.rides(id),
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  passenger_read_seq integer NOT NULL DEFAULT 0 CHECK (passenger_read_seq >= 0),
  driver_read_seq integer NOT NULL DEFAULT 0 CHECK (driver_read_seq >= 0),
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mobility.ride_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  seq integer NOT NULL CHECK (seq > 0),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  sender_role varchar(10) NOT NULL CHECK (sender_role IN ('passenger', 'driver')),
  sender_user_id uuid NOT NULL REFERENCES mobility.users(id),
  client_message_id uuid NOT NULL,
  body varchar(500) NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL,
  UNIQUE (ride_id, seq),
  UNIQUE (sender_user_id, client_message_id)
);
CREATE INDEX ride_messages_assignment_idx
  ON mobility.ride_messages(ride_id, driver_profile_id, seq);
CREATE INDEX ride_messages_sender_idx
  ON mobility.ride_messages(sender_user_id, ride_id, created_at);

CREATE TABLE mobility.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES mobility.rides(id),
  rater_role varchar(10) NOT NULL CHECK (rater_role IN ('passenger', 'driver')),
  rater_user_id uuid NOT NULL REFERENCES mobility.users(id),
  ratee_user_id uuid NOT NULL REFERENCES mobility.users(id),
  driver_profile_id uuid NOT NULL REFERENCES mobility.driver_profiles(id),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment varchar(300),
  edit_count integer NOT NULL DEFAULT 0 CHECK (edit_count >= 0),
  moderation_status varchar(10) NOT NULL DEFAULT 'none'
    CHECK (moderation_status IN ('none', 'pending', 'reviewed', 'removed')),
  moderated_by uuid REFERENCES mobility.operators(id),
  moderated_at timestamptz,
  moderation_note varchar(500),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (ride_id, rater_role),
  CHECK (rater_user_id <> ratee_user_id)
);
CREATE INDEX ratings_ratee_idx
  ON mobility.ratings(ratee_user_id, rater_role, created_at)
  WHERE moderation_status <> 'removed';
CREATE INDEX ratings_moderation_idx
  ON mobility.ratings(moderation_status, created_at DESC, id);
