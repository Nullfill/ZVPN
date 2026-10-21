-- Defaults for a fresh install; upgrades and restores preserve the chosen relay.
INSERT INTO panel_settings(key, value)
VALUES ('netlify', '{"enabled":false,"hostname":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
