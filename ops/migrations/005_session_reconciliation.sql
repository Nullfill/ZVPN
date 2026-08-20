-- Durable grace-period state for the max-devices reconciler.  Keeping the
-- timestamp in PostgreSQL prevents a panel restart from either terminating a
-- brand-new reconnect immediately or leaving an over-limit account forever.
CREATE TABLE IF NOT EXISTS session_reconcile_state (
  username text PRIMARY KEY REFERENCES vpn_users(username) ON DELETE CASCADE,
  over_limit_since timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_reconcile_state_seen
  ON session_reconcile_state(last_seen_at);
