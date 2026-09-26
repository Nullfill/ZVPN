import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { getSetting, updateSettings } from './settings.js';

const execFileAsync = promisify(execFile);

const BACKUP_SCRIPT = path.resolve('/opt/zvpn-panel/app/ops/backup-github.sh');

export async function runGithubBackupNow() {
  const cfg = await getSetting('github');
  if (!cfg.token || !cfg.repo) {
    throw new Error('GitHub token و repo پیکربندی نشده‌اند');
  }

  // Inject credentials as env vars so the shell script can read them without
  // touching the .env file on disk (avoids race conditions with concurrent requests).
  const env = {
    ...process.env,
    BACKUP_GITHUB_TOKEN: cfg.token,
    BACKUP_GITHUB_REPO: cfg.repo,
    BACKUP_PASSPHRASE: cfg.passphrase || '',
  };

  try {
    const { stdout, stderr } = await execFileAsync('bash', [BACKUP_SCRIPT], {
      env,
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    const now = new Date().toISOString();
    await updateSettings('github', {
      lastBackupAt: now,
      lastStatus: 'success',
      lastError: null,
    });
    return { ok: true, output: stdout };
  } catch (err) {
    const now = new Date().toISOString();
    await updateSettings('github', {
      lastBackupAt: now,
      lastStatus: 'error',
      lastError: err.message?.slice(0, 500) || 'Unknown error',
    });
    throw new Error(err.stderr?.slice(0, 500) || err.message);
  }
}

export async function testGithubConnection(token, repo) {
  // Test by listing releases via GitHub API
  const resp = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=1`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (resp.status === 404) throw new Error('ریپو پیدا نشد — نام ریپو را بررسی کنید');
  if (resp.status === 401) throw new Error('توکن نامعتبر است');
  if (!resp.ok) throw new Error(`خطای GitHub API: ${resp.status}`);

  // Also fetch repo metadata to return visibility info
  const repoResp = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  const repoData = await repoResp.json();
  return { ok: true, private: repoData.private, name: repoData.full_name };
}

export async function createGithubRepo(token, repoName) {
  // Accept either "owner/name" or just "name"
  const name = repoName.includes('/') ? repoName.split('/')[1] : repoName;

  const resp = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      name,
      private: true,
      description: 'ZVPN Panel — Encrypted Automatic Backups',
      auto_init: true,
    }),
  });

  const data = await resp.json();
  if (resp.status === 422) throw new Error('ریپو از قبل وجود دارد یا نام نامعتبر است');
  if (!resp.ok) throw new Error(data.message || `خطای GitHub API: ${resp.status}`);

  return { ok: true, repo: data.full_name, url: data.html_url, private: data.private };
}

export async function listGithubBackups(token, repo) {
  const resp = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=15`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
  const releases = await resp.json();
  return releases.map((r) => ({
    id: r.id,
    name: r.name,
    tag: r.tag_name,
    createdAt: r.created_at,
    size: r.assets?.[0]?.size || 0,
    fileName: r.assets?.[0]?.name || '',
  }));
}

// Scheduler: initialise once on startup and reschedule whenever settings change
let _githubTimer = null;

export function scheduleGithubBackup() {
  if (_githubTimer) clearInterval(_githubTimer);
  getSetting('github').then((cfg) => {
    if (!cfg.enabled || !cfg.token || !cfg.repo) return;
    const ms = (cfg.intervalHours || 24) * 3600 * 1000;
    _githubTimer = setInterval(async () => {
      try {
        await runGithubBackupNow();
      } catch (e) {
        console.error('[github-backup] Error:', e.message);
      }
    }, ms);
    console.log(`[github-backup] Scheduled every ${cfg.intervalHours}h`);
  }).catch(() => {});
}
