ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS xray_uuid uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_vpn_users_xray_uuid ON vpn_users(xray_uuid);
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS xray_usage_bytes bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS xray_usage_snapshots (
  user_id uuid PRIMARY KEY REFERENCES vpn_users(id) ON DELETE CASCADE,
  epoch text NOT NULL,
  uplink bigint NOT NULL DEFAULT 0,
  downlink bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO panel_settings(key,value) VALUES ('xray','{"enabled":true,"path":"/zvpn-xhttp/"}') ON CONFLICT(key) DO NOTHING;
