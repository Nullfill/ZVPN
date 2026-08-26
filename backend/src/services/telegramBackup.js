import { getSetting, updateSettings } from './settings.js';
import { exportPanelBackup } from './backup.js';
import { getLiveSessions } from '../worker.js';
import { config } from '../config.js';

/**
 * Test Telegram bot connection and chat_id validity.
 */
export async function testTelegramConnection(botToken, chatId) {
  if (!botToken || !chatId) {
    throw new Error('BOT_TOKEN_AND_CHAT_ID_REQUIRED');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const text = `🤖 *ZVPN Panel - تست ارتباط تلگرام*\n\n✅ ارتباط با ربات تلگرام با موفقیت برقرار شد!\n🌐 سرور: \`${config.vpnServer || 'ZVPN'}\`\n⏰ زمان: \`${new Date().toISOString()}\``;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(body.description || `Telegram API Error (${res.status})`);
  }
  return { ok: true, message: 'Connection successful' };
}

/**
 * Send backup JSON document to configured Telegram chat.
 */
export async function sendTelegramBackup(backupPayload = null, customCaption = null) {
  const settings = await getSetting('telegram');
  if (!settings.botToken || !settings.chatId) {
    throw new Error('TELEGRAM_NOT_CONFIGURED');
  }

  const payload = backupPayload || await exportPanelBackup({ includeAdmins: settings.includeAdmins ?? true });
  const backupJson = JSON.stringify(payload, null, 2);
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `zvpn-backup-${config.vpnServer || 'server'}-${dateStr}.json`;

  const liveSessions = getLiveSessions ? getLiveSessions() : [];
  const userCount = payload.counts?.users ?? (payload.users?.length || 0);

  const caption = customCaption || `📦 *پشتیبان خودکار ZVPN Panel*\n\n` +
    `🌐 *دامنه/سرور:* \`${config.vpnServer || config.publicBaseUrl || 'ZVPN'}\`\n` +
    `👥 *تعداد کل کاربران:* \`${userCount}\`\n` +
    `⚡ *کاربران آنلاین فعلی:* \`${liveSessions.length}\`\n` +
    `📅 *تاریخ ثبت:* \`${now.toLocaleString('fa-IR', { timeZone: config.timezone || 'Asia/Tehran' })}\`\n` +
    `🏷️ *نسخه پنل:* \`v${config.version}\``;

  const form = new FormData();
  form.append('chat_id', settings.chatId);
  form.append('caption', caption);
  form.append('parse_mode', 'Markdown');
  form.append('document', new Blob([backupJson], { type: 'application/json' }), filename);

  const url = `https://api.telegram.org/bot${settings.botToken}/sendDocument`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    const errorMsg = body.description || `Telegram API Error (${res.status})`;
    await updateSettings('telegram', {
      lastStatus: 'error',
      lastError: errorMsg,
    }).catch(() => {});
    throw new Error(errorMsg);
  }

  await updateSettings('telegram', {
    lastBackupAt: now.toISOString(),
    lastStatus: 'success',
    lastError: null,
  }).catch(() => {});

  return { ok: true, filename, sentAt: now.toISOString() };
}

/**
 * Scheduled background task for Telegram backup dispatch.
 */
export async function checkAndDispatchTelegramBackup() {
  try {
    const settings = await getSetting('telegram');
    if (!settings.enabled || !settings.botToken || !settings.chatId) {
      return;
    }

    const intervalHours = Number(settings.intervalHours || 1);
    const intervalMs = intervalHours * 3600 * 1000;
    const lastBackup = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
    const now = Date.now();

    if (now - lastBackup >= intervalMs) {
      console.info(`[telegramBackup] Dispatching automated backup (interval: ${intervalHours}h)...`);
      await sendTelegramBackup();
      console.info('[telegramBackup] Automated backup sent successfully.');
    }
  } catch (err) {
    console.error('[telegramBackup] Scheduled backup failed:', err.message);
  }
}
