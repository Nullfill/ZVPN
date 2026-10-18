-- Unique accounts observed per local day. Keep anonymous IDs after user deletion.
CREATE TABLE IF NOT EXISTS user_activity_daily (
  activity_date date NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (activity_date,user_id)
);
INSERT INTO user_activity_daily(activity_date,user_id)
SELECT usage_date,user_id FROM usage_daily WHERE bytes>0 ON CONFLICT DO NOTHING;

ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS traffic_exhausted_at timestamptz;
-- Use recorded quota events only; do not invent dates for older exhausted accounts.
UPDATE vpn_users u SET traffic_exhausted_at=(
  SELECT max(e.created_at) FROM system_events e
  WHERE e.user_id=u.id AND e.event='vpn.quota_blocked'
    AND e.metadata->>'reason'='total_quota'
) WHERE NOT u.unlimited_traffic AND u.total_limit_bytes>0
  AND u.usage_total>=u.total_limit_bytes AND u.traffic_exhausted_at IS NULL;

CREATE OR REPLACE FUNCTION track_traffic_exhaustion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.unlimited_traffic AND NEW.total_limit_bytes>0 AND NEW.usage_total>=NEW.total_limit_bytes THEN
    IF TG_OP='INSERT' THEN NEW.traffic_exhausted_at=now();
    ELSIF OLD.unlimited_traffic OR OLD.total_limit_bytes IS NULL OR OLD.total_limit_bytes=0 OR OLD.usage_total<OLD.total_limit_bytes THEN
      NEW.traffic_exhausted_at=now();
    ELSE NEW.traffic_exhausted_at=OLD.traffic_exhausted_at;
    END IF;
  ELSE NEW.traffic_exhausted_at=NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vpn_users_traffic_exhaustion ON vpn_users;
CREATE TRIGGER vpn_users_traffic_exhaustion BEFORE INSERT OR UPDATE OF usage_total,total_limit_bytes,unlimited_traffic
ON vpn_users FOR EACH ROW EXECUTE FUNCTION track_traffic_exhaustion();
