CREATE TABLE IF NOT EXISTS system_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('error','warn','info','debug')),
  event text NOT NULL,
  action text,
  status text NOT NULL DEFAULT 'success',
  admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  user_id uuid REFERENCES vpn_users(id) ON DELETE SET NULL,
  request_id text,
  source text NOT NULL DEFAULT 'zvpn-panel',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_level ON system_events(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_action ON system_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_status ON system_events(status, created_at DESC);
