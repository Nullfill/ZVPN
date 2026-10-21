import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const RELAY_EXTRA = {
  xPaddingObfsMode: true,
  xPaddingPlacement: 'header',
  xPaddingHeader: 'X-Relay-Padding',
  xPaddingMethod: 'repeat-x',
  xPaddingBytes: '100-1000',
  scMaxEachPostBytes: '1000000',
};

export function makeRelayLink(sourceLink, relayHost) {
  const original = new URL(sourceLink.trim());
  if (original.protocol !== 'vless:' || original.password ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(original.username) ||
      original.searchParams.get('type') !== 'xhttp' ||
      original.searchParams.get('path') !== '/zvpn-xhttp/') throw Error('Expected an existing ZVPN XHTTP link');
  const host = relayHost.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.netlify\.app$/.test(host)) throw Error('Expected the project hostname ending in .netlify.app');
  const query = new URLSearchParams({ encryption: 'none', security: 'tls', sni: host,
    host, type: 'xhttp', path: '/zvpn-xhttp/', mode: 'packet-up', alpn: 'h2,http/1.1',
    fp: 'chrome', extra: JSON.stringify(RELAY_EXTRA) });
  return `vless://${original.username}@${host}:443?${query}#${encodeURIComponent('Netlify test')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , inputFile, hostname, outputFile] = process.argv;
  if (!inputFile || !hostname || !outputFile) throw Error('Usage: node make-link.mjs INPUT_FILE PROJECT.netlify.app OUTPUT_FILE');
  const result = makeRelayLink(await fs.readFile(inputFile, 'utf8'), hostname);
  // Never put the user's UUID in console output, deployment logs or arguments.
  await fs.writeFile(outputFile, result + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Relay link written to ' + outputFile);
}
