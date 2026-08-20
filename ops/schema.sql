-- Baseline schema (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vpn_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL CHECK (username ~ '^[A-Za-z0-9_.@-]{3,64}$'),
  secret_enc text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  quota_blocked boolean NOT NULL DEFAULT false,
  quota_reason text,
  expires_at timestamptz,
  daily_limit_bytes bigint,
  total_limit_bytes bigint,
  max_devices integer NOT NULL DEFAULT 1 CHECK (max_devices BETWEEN 1 AND 10),
  usage_total bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  last_public_ip inet,
  last_virtual_ip inet,
  download_token text UNIQUE NOT NULL,
  download_token_expires_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id uuid NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS sa_snapshots (
  ike_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  last_bytes bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vpn_users_enabled ON vpn_users(enabled);
CREATE INDEX IF NOT EXISTS idx_vpn_users_expires ON vpn_users(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
