import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';
import { collectXrayUsage } from './xray.js';

const exec = promisify(execFile);
export const BACKUP_MAGIC = Buffer.from('ZVPNENC1');

export function encryptBackup(buffer, passphrase) {
  if (!passphrase) return buffer;
  const salt = randomBytes(16); const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export async function createFullBackup(passphrase = '') {
  await collectXrayUsage();
  const { stdout } = await exec('sudo', [config.helper, 'full-backup'], {
    encoding: 'buffer', timeout: 300000, maxBuffer: 256 * 1024 * 1024,
  });
  if (stdout.length < 100 || stdout[0] !== 0x1f || stdout[1] !== 0x8b) throw new Error('INVALID_FULL_BACKUP_ARCHIVE');
  return encryptBackup(stdout, passphrase);
}

export function backupParts(buffer, limit = 45 * 1024 * 1024) {
  const result = [];
  for (let offset = 0; offset < buffer.length; offset += limit) result.push(buffer.subarray(offset, offset + limit));
  return result;
}
