ALTER TABLE mobility.notifications
  ADD COLUMN category varchar(20) NOT NULL DEFAULT 'ride'
    CHECK (category IN ('ride', 'chat', 'offer', 'account', 'support', 'safety')),
  ADD COLUMN inbox boolean NOT NULL DEFAULT true,
  ADD COLUMN read_at timestamptz;

UPDATE mobility.notifications
   SET category = CASE kind WHEN 'offer' THEN 'offer' WHEN 'chat_message' THEN 'chat' ELSE 'ride' END,
       inbox = kind NOT IN ('offer', 'chat_message');

CREATE INDEX notifications_inbox_idx
  ON mobility.notifications(user_id, id DESC) WHERE inbox;
CREATE INDEX notifications_unread_idx
  ON mobility.notifications(user_id) WHERE inbox AND read_at IS NULL;

CREATE TABLE mobility.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES mobility.users(id),
  ride_updates boolean NOT NULL DEFAULT true,
  chat_messages boolean NOT NULL DEFAULT true,
  ride_offers boolean NOT NULL DEFAULT true,
  account_updates boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);
