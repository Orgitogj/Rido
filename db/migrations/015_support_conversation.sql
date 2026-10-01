CREATE TABLE mobility.support_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  support_request_id uuid NOT NULL REFERENCES mobility.support_requests(id),
  author varchar(10) NOT NULL CHECK (author IN ('user', 'operator')),
  user_id uuid REFERENCES mobility.users(id),
  operator_id uuid REFERENCES mobility.operators(id),
  body varchar(1000) NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  client_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (support_request_id, client_message_id),
  CHECK ((author = 'user') = (user_id IS NOT NULL)),
  CHECK ((author = 'operator') = (operator_id IS NOT NULL))
);
CREATE INDEX support_messages_request_idx
  ON mobility.support_messages(support_request_id, id);

ALTER TABLE mobility.support_requests
  ADD COLUMN user_read_at timestamptz,
  ADD COLUMN last_operator_message_at timestamptz,
  ADD COLUMN last_user_message_at timestamptz;

ALTER TABLE mobility.support_events DROP CONSTRAINT support_events_action_check;
ALTER TABLE mobility.support_events ADD CONSTRAINT support_events_action_check
  CHECK (action IN ('created', 'assigned', 'unassigned', 'resolved', 'reopened', 'note_added',
                    'user_message', 'operator_message'));
