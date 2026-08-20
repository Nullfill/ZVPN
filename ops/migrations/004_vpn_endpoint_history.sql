CREATE TABLE IF NOT EXISTS vpn_endpoint_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_endpoint text NOT NULL,
  new_endpoint text NOT NULL,
  old_certificate jsonb,
  new_certificate jsonb,
  backup_path text,
  status text NOT NULL DEFAULT 'applied',
  error_message text,
  changed_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vpn_endpoint_history_created ON vpn_endpoint_history(created_at DESC);
