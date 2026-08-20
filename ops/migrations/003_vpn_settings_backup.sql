-- v2.1.0: VPN server address in panel settings + backup metadata
UPDATE panel_settings SET value = value || '{"serverAddress":"","remoteId":""}'::jsonb
WHERE key = 'vpn' AND NOT (value ? 'serverAddress');

INSERT INTO panel_settings(key, value) VALUES
  ('vpn', '{"maxDevicesPolicy":"disconnect_oldest","serverAddress":"","remoteId":"","dns":""}')
ON CONFLICT (key) DO NOTHING;
