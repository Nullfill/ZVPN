ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS netlify_usage_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS xray_legacy_usage_bytes bigint;
-- Preserve old combined Xray/Netlify usage without inventing a historical split.
UPDATE vpn_users SET xray_legacy_usage_bytes=xray_usage_bytes WHERE xray_legacy_usage_bytes IS NULL;
ALTER TABLE vpn_users ALTER COLUMN xray_legacy_usage_bytes SET DEFAULT 0;
ALTER TABLE vpn_users ALTER COLUMN xray_legacy_usage_bytes SET NOT NULL;
CREATE TABLE IF NOT EXISTS netlify_usage_snapshots (
  user_id uuid PRIMARY KEY REFERENCES vpn_users(id) ON DELETE CASCADE,
  epoch text NOT NULL, uplink bigint NOT NULL DEFAULT 0, downlink bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
