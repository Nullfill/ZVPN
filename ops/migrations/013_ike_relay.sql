ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS ike_relay_usage_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS ike_relay_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE usage_hourly ADD COLUMN IF NOT EXISTS ike_relay_bytes bigint NOT NULL DEFAULT 0;
-- Compact VICI events previously selected the CHILD ID when the first IKE
-- uniqueid immediately followed '{'. Rebaseline cursors, never user balances.
DELETE FROM sa_snapshots;
