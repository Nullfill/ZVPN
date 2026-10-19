-- Update only the unchanged original Gemini preset. Respect custom domain lists
-- and exclusions chosen by administrators.
UPDATE panel_settings
SET value=jsonb_set(value, '{domains}', (value->'domains') || '["www.google.com","recaptcha.net"]'::jsonb),
    updated_at=now()
WHERE key='warp'
  AND jsonb_typeof(value->'domains')='array'
  AND jsonb_array_length(value->'domains')=17
  AND value->'domains' @> '["gemini.google.com","gemini.google","bard.google.com","aistudio.google.com","makersuite.google.com","ai.google.dev","alkalicore-pa.clients6.google.com","alkalimakersuite-pa.clients6.google.com","webchannel-alkalimakersuite-pa.clients6.google.com","geminiweb-pa.clients.google.com","geminiweb-pa.clients6.google.com","accounts.google.com","apis.google.com","ogs.google.com","googleapis.com","googleusercontent.com","gstatic.com"]'::jsonb
  AND NOT (COALESCE(value->'excludedDomains','[]'::jsonb) ?| ARRAY['www.google.com','google.com','recaptcha.net']);
