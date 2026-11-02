-- Expand only the unchanged Gemini preset. Custom lists remain administrator-owned.
-- Excluded parent domains also prevent adding their helper subdomains.
UPDATE panel_settings AS s
SET value=jsonb_set(value, '{domains}', (value->'domains') || (
      SELECT COALESCE(jsonb_agg(d.domain ORDER BY d.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements_text(
        '["clients4.google.com","clients6.google.com","play.google.com","safebrowsing.google.com"]'::jsonb
      ) WITH ORDINALITY AS d(domain, ordinality)
      WHERE NOT (s.value->'domains' ? d.domain)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.value->'excludedDomains','[]'::jsonb)) AS e(domain)
          WHERE d.domain=e.domain OR right(d.domain, length(e.domain)+1)='.' || e.domain
        )
    )), updated_at=now()
WHERE key='warp'
  AND jsonb_typeof(value->'domains')='array'
  AND jsonb_array_length(value->'domains')=19
  AND value->'domains' @> '["gemini.google.com","gemini.google","bard.google.com","aistudio.google.com","makersuite.google.com","ai.google.dev","alkalicore-pa.clients6.google.com","alkalimakersuite-pa.clients6.google.com","webchannel-alkalimakersuite-pa.clients6.google.com","geminiweb-pa.clients.google.com","geminiweb-pa.clients6.google.com","accounts.google.com","apis.google.com","ogs.google.com","googleapis.com","googleusercontent.com","gstatic.com","www.google.com","recaptcha.net"]'::jsonb;
