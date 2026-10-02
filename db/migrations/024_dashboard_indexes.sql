CREATE INDEX rides_requested_at_idx ON mobility.rides(requested_at)
  WHERE requested_at IS NOT NULL;
CREATE INDEX rides_paid_at_idx ON mobility.rides(paid_at)
  WHERE paid_at IS NOT NULL;
CREATE INDEX rides_active_status_idx ON mobility.rides(status)
  WHERE status IN ('awaiting_payment', 'requested', 'offered', 'accepted',
                   'arriving', 'arrived', 'in_progress');
CREATE INDEX earning_entries_occurred_idx ON mobility.earning_entries(occurred_at);
CREATE INDEX tips_paid_at_idx ON mobility.tips(paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX refunds_succeeded_idx ON mobility.refunds(updated_at)
  WHERE status = 'succeeded';
