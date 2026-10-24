import { getSetting } from '../src/services/settings.js';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import { netlifyLink } from '../src/services/netlifyConfig.js';

try {
  const policy = await getSetting('netlify');
  if (policy.enabled) {
    // Validate without disclosing an actual user's identity or access link.
    netlifyLink({ id: '22222222-2222-4222-8222-222222222222', username: 'check', xray_uuid: '11111111-1111-4111-8111-111111111111' }, config.publicBaseUrl, policy);
    console.log(`Netlify relay configured: ${policy.hostname}`);
    console.log(`Origin: ${new URL(config.publicBaseUrl).hostname}; keep the relay DNS pointed at Netlify.`);
    console.log('The existing Netlify project keeps the same origin domain. Reconnect and verify its actual exit IP after migration.');
    console.log('If Netlify still exits through the old server, redeploy the existing Netlify project to refresh its origin. Keep the old server until this check passes.');
  } else console.log('Netlify links disabled. Configure the relay in admin Settings > Netlify after publishing your Netlify project.');
} catch {
  console.error('Netlify configuration could not be verified; check admin Settings > Netlify.');
  process.exitCode = 1;
} finally { await db.end(); }
