#!/usr/bin/env node
/**
 * Patches server.js to mount v2.1 routes (backup export/import, dynamic VPN config).
 * Run from backend/: node scripts/patch-v2.1-server.js
 */
import fs from 'node:fs';
import path from 'node:path';

const serverPath = path.resolve('src/server.js');
if (!fs.existsSync(serverPath)) {
  console.error('server.js not found at', serverPath);
  process.exit(1);
}

let src = fs.readFileSync(serverPath, 'utf8');

if (src.includes('mountV211Routes')) {
  console.log('server.js already patched for v2.1');
  process.exit(0);
}

const importLine = "import { mountV211Routes } from './routes/v211.js';";
if (!src.includes(importLine)) {
  const anchor = "import { getLiveSessions";
  if (src.includes(anchor)) {
    src = src.replace(anchor, `${importLine}\nimport { getLiveSessions`);
  } else {
    src = importLine + '\n' + src;
  }
}

const mountBlock = `
mountV211Routes(app, { requireAdmin, audit, clientIp });
`;

if (!src.includes('mountV211Routes(app')) {
  const anchor = 'await runMigrations();';
  if (src.includes(anchor)) {
    src = src.replace(anchor, mountBlock + anchor);
  } else if (src.includes('app.listen(')) {
    src = src.replace('app.listen(', mountBlock + '\napp.listen(');
  } else {
    console.error('Could not find insertion point in server.js');
    process.exit(1);
  }
}

fs.writeFileSync(serverPath, src);
console.log('Patched server.js for v2.1');
