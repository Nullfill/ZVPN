-- Preserve per-CHILD cursors across polls and distinguish reused IKE IDs.
-- Existing balances and cursors are intentionally left unchanged.
ALTER TABLE sa_snapshots ADD COLUMN IF NOT EXISTS session_identity text;
ALTER TABLE sa_snapshots ADD COLUMN IF NOT EXISTS child_counters jsonb;
