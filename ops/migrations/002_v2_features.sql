-- ZVPN v2.0.0 features (backward-safe)
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS duration_days integer;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS first_connected_at timestamptz;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS activation_status text NOT NULL DEFAULT 'activated';
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'active';
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS provisioning_error text;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS upload_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS download_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS download_token_revoked boolean NOT NULL DEFAULT false;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS unlimited_traffic boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS panel_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connection_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  public_ip inet,
  virtual_ip inet,
  bytes_in bigint NOT NULL DEFAULT 0,
  bytes_out bigint NOT NULL DEFAULT 0,
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  duration_seconds integer
);

CREATE TABLE IF NOT EXISTS usage_hourly (
  user_id uuid NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  hour_ts timestamptz NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, hour_ts)
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip inet;
ALTER TABLE sa_snapshots ADD COLUMN IF NOT EXISTS last_bytes_in bigint NOT NULL DEFAULT 0;
ALTER TABLE sa_snapshots ADD COLUMN IF NOT EXISTS last_bytes_out bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_vpn_users_activation ON vpn_users(activation_status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_hourly_user ON usage_hourly(user_id, hour_ts DESC);

INSERT INTO panel_settings(key, value) VALUES
  ('general', '{"panelName":"ZVPN Panel","timezone":"Asia/Tehran"}'),
  ('vpn', '{"maxDevicesPolicy":"disconnect_oldest","serverAddress":"","remoteId":""}'),
  ('appearance', '{"theme":"dark","animations":true}'),
  ('download', '{"tokenDays":30}')
ON CONFLICT (key) DO NOTHING;
