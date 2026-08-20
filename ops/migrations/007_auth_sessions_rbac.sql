-- Session-backed admin authentication and role based access control.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1;
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('viewer','operator','admin','owner'));

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
