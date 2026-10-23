import { getSetting } from '../src/services/settings.js';
import { closeDatabase } from '../src/db.js';
try {
  const p = await getSetting('xrayRelay');
  console.log(p.enabled ? 'Iran Xray is enabled. Preserve the Iran Advanced rule; its origin uses your main domain.' : 'Iran Xray is optional: enable it in Settings > Iran Xray and copy the generated Advanced template.');
} finally { await closeDatabase(); }
