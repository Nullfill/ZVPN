-- Only existing Muse opt-ins receive the observed sign-in companions.
-- Preserve unrelated custom domains, provider/scope, and explicit parent exclusions.
UPDATE panel_settings AS s
SET value=jsonb_set(value, '{domains}', (value->'domains') || (
  SELECT COALESCE(jsonb_agg(d.domain ORDER BY d.ordinality), '[]'::jsonb)
  FROM jsonb_array_elements_text('["auth.meta.com","www.facebook.com","static.xx.fbcdn.net"]'::jsonb)
    WITH ORDINALITY AS d(domain, ordinality)
  WHERE NOT (s.value->'domains' ? d.domain)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.value->'excludedDomains','[]'::jsonb)) AS e(domain)
      WHERE d.domain=e.domain OR right(d.domain,length(e.domain)+1)='.' || e.domain
    )
)), updated_at=now()
WHERE key='warp' AND jsonb_typeof(value->'domains')='array'
  AND value->'domains' ? 'muse.ai' AND jsonb_array_length(value->'domains')<=197;
