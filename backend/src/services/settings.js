import { one, many, db } from '../db.js';
import { config } from '../config.js';
import { invalidateVpnConfigCache } from './vpnConfig.js';
import { z } from 'zod';

const DEFAULTS = {
  general: { panelName: config.panelName, timezone: config.timezone, domain: '' },
  vpn: {
    maxDevicesPolicy: 'disconnect_oldest',
    serverAddress: '',
    remoteId: '',
    dns: '',
  },
  appearance: { theme: 'dark', animations: true, threeJs: true, glassIntensity: 0.12 },
  download: { tokenDays: 30, pageTitle: '', supportText: '' },
};

const SETTINGS_SCHEMAS = {
  general: z.object({
    panelName: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    domain: z.string().trim().max(253).optional(),
  }).strict(),
  vpn: z.object({
    maxDevicesPolicy: z.enum(['disconnect_oldest', 'reject_newest']).optional(),
    serverAddress: z.string().trim().max(253).optional(),
    remoteId: z.string().trim().max(253).optional(),
    dns: z.string().trim().max(253).optional(),
  }).strict(),
  appearance: z.object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    animations: z.boolean().optional(),
    threeJs: z.boolean().optional(),
    glassIntensity: z.number().finite().min(0).max(1).optional(),
  }).strict(),
  download: z.object({
    tokenDays: z.coerce.number().int().min(1).max(365).optional(),
    pageTitle: z.string().trim().max(120).optional(),
    supportText: z.string().trim().max(500).optional(),
  }).strict(),
};

export const SETTINGS_SECTIONS = Object.freeze(Object.keys(SETTINGS_SCHEMAS));

export function validateSettingsPatch(section, value) {
  const schema = SETTINGS_SCHEMAS[section];
  if (!schema) return { success: false, error: null };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return parsed;
  if (Object.keys(parsed.data).length === 0) {
    return {
      success: false,
      error: new z.ZodError([{ code: 'custom', path: [], message: 'At least one setting is required' }]),
    };
  }
  return parsed;
}

export async function getSettings() {
  const rows = await many('SELECT key, value FROM panel_settings');
  const out = structuredClone(DEFAULTS);
  for (const r of rows) {
    if (out[r.key]) out[r.key] = { ...out[r.key], ...r.value };
  }
  if (!out.vpn.serverAddress) out.vpn.serverAddress = config.vpnServer;
  if (!out.vpn.remoteId) out.vpn.remoteId = config.vpnRemoteId || out.vpn.serverAddress;
  return out;
}

export async function getSetting(key) {
  const row = await one('SELECT value FROM panel_settings WHERE key=$1', [key]);
  const base = { ...DEFAULTS[key] };
  const merged = row ? { ...base, ...row.value } : { ...base };
  if (key === 'vpn') {
    if (!merged.serverAddress) merged.serverAddress = config.vpnServer;
    if (!merged.remoteId) merged.remoteId = config.vpnRemoteId || merged.serverAddress;
  }
  return merged;
}

export async function updateSettings(section, value) {
  const parsed = validateSettingsPatch(section, value);
  if (!parsed.success) {
    const error = new Error('INVALID_SETTINGS');
    error.code = 'INVALID_SETTINGS';
    error.details = parsed.error?.flatten?.();
    throw error;
  }

  const patch = { ...parsed.data };
  if (section === 'vpn') {
    if (Object.hasOwn(patch, 'serverAddress')) patch.serverAddress = patch.serverAddress.trim();
    if (Object.hasOwn(patch, 'remoteId')) patch.remoteId = patch.remoteId.trim();
  }

  // Merge inside PostgreSQL so concurrent partial updates cannot overwrite
  // unrelated fields. Defaults are presentation-time values only.
  const result = await db.query(
    `INSERT INTO panel_settings(key, value, updated_at) VALUES($1, $2::jsonb, now())
     ON CONFLICT(key) DO UPDATE
       SET value=panel_settings.value || EXCLUDED.value, updated_at=now()
     RETURNING value`,
    [section, JSON.stringify(patch)]
  );
  const merged = { ...DEFAULTS[section], ...result.rows[0].value };
  if (section === 'vpn') {
    if (!merged.serverAddress) merged.serverAddress = config.vpnServer;
    if (!merged.remoteId) merged.remoteId = config.vpnRemoteId || merged.serverAddress;
  }
  if (section === 'vpn') invalidateVpnConfigCache();
  return merged;
}

export async function getMaxDevicesPolicy() {
  const s = await getSetting('vpn');
  return s.maxDevicesPolicy || 'disconnect_oldest';
}
