ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS xray_iran_usage_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS xray_iran_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE usage_hourly ADD COLUMN IF NOT EXISTS xray_iran_bytes bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS xray_iran_usage_snapshots (
  user_id uuid PRIMARY KEY REFERENCES vpn_users(id) ON DELETE CASCADE,
  epoch text NOT NULL, uplink bigint NOT NULL DEFAULT 0, downlink bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
