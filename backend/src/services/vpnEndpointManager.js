import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db, one, many } from '../db.js';
import { getSetting, updateSettings } from './settings.js';
import { invalidateVpnConfigCache } from './vpnConfig.js';

const execFileAsync = promisify(execFile);
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,253}[a-z0-9])?$/i;

export class EndpointError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function validIp(ip) {
  if (!IP_RE.test(ip)) return false;
  return ip.split('.').every((p) => Number(p) >= 0 && Number(p) <= 255);
}

export function normalizeEndpoint(raw) {
  const endpoint = String(raw || '').trim();
  if (!endpoint || endpoint.length > 253) throw new EndpointError('INVALID_ENDPOINT', 'Endpoint نامعتبر است.');
  if (validIp(endpoint)) return { endpoint, type: 'ip', remoteId: endpoint, serverAddress: endpoint };
  const host = endpoint.toLowerCase();
  if (!HOST_RE.test(host) && !DOMAIN_RE.test(host)) {
    throw new EndpointError('INVALID_ENDPOINT', 'Endpoint باید IP معتبر یا دامنه باشد.');
  }
  return { endpoint: host, type: 'domain', remoteId: host, serverAddress: host };
}

async function helper(args, timeoutMs = 60000) {
  try {
    const { stdout } = await execFileAsync('sudo', [config.helper, ...args], {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return (stdout || '').trim();
  } catch (e) {
    const msg = e.stderr?.toString?.() || e.stdout?.toString?.() || e.message || 'helper failed';
    throw new EndpointError('HELPER_FAILED', msg.split('\n')[0].slice(0, 300));
  }
}

function parseCertInfo(text) {
  const out = { cn: null, san: [], notAfter: null, leftid: null, raw: text };
  for (const line of text.split('\n')) {
    if (!line.includes('=')) {
      const t = line.trim();
      if (/^(DNS:|IP Address:|IP:)/i.test(t)) out.san.push(t);
      continue;
    }
    const [k, ...rest] = line.split('=');
    const v = rest.join('=').trim();
    if (k === 'CN') out.cn = v;
    else if (k === 'SAN' && v) out.san.push(...v.split(',').map((x) => x.trim()).filter(Boolean));
    else if (k === 'NOT_AFTER') out.notAfter = v;
    else if (k === 'LEFTID') out.leftid = v;
  }
  return out;
}

function leftidMatches(cert, remoteId) {
  return !cert?.leftid || cert.leftid === remoteId;
}

export function certMatchesEndpoint(cert, endpoint, type) {
  if (!cert?.cn) return false;
  const values = new Set([cert.cn, ...cert.san].filter(Boolean));
  if (type === 'ip') {
    return [...values].some((v) => v.replace(/^IP Address:/i, '').replace(/^IP:/i, '').trim() === endpoint);
  }
  const norm = endpoint.toLowerCase();
  return [...values].some((v) => v.replace(/^DNS:/i, '').trim().toLowerCase() === norm);
}

async function resolveDns(domain) {
  try {
    const out = await helper(['resolve-host', domain], 15000);
    const ips = out.split('\n').map((l) => l.trim()).filter(Boolean);
    return { ok: ips.length > 0, addresses: ips };
  } catch {
    return { ok: false, addresses: [], error: 'DNS resolve ناموفق بود.' };
  }
}

async function checkPorts() {
  try {
    const out = await helper(['check-ike-ports'], 10000);
    const lines = Object.fromEntries(out.split('\n').map((l) => l.split('=')).filter((p) => p.length === 2));
    return { udp500: lines.UDP500 === '1', udp4500: lines.UDP4500 === '1' };
  } catch {
    return { udp500: false, udp4500: false };
  }
}

export async function getEndpointStatus() {
  const vpn = await getSetting('vpn');
  const certText = await helper(['cert-info']);
  const cert = parseCertInfo(certText);
  const current = {
    serverAddress: (vpn.serverAddress || '').trim() || config.vpnServer,
    remoteId: (vpn.remoteId || '').trim() || config.vpnRemoteId,
  };
  const identity = current.remoteId || current.serverAddress;
  let type = 'domain';
  try { type = normalizeEndpoint(identity).type; } catch { /* keep domain */ }
  return {
    current,
    certificate: {
      ...cert,
      matches: certMatchesEndpoint(cert, identity, type),
    },
    ports: await checkPorts(),
  };
}

export async function validateEndpointChange(rawEndpoint) {
  const parsed = normalizeEndpoint(rawEndpoint);
  const status = await getEndpointStatus();
  const dns = parsed.type === 'domain' ? await resolveDns(parsed.endpoint) : { ok: true, addresses: [parsed.endpoint] };
  const ports = await checkPorts();
  const needsNewCert = !certMatchesEndpoint(status.certificate, parsed.endpoint, parsed.type);
  const needsLeftidUpdate = status.certificate.leftid !== parsed.remoteId;
  const needsSettingsUpdate = status.current.serverAddress !== parsed.serverAddress
    || status.current.remoteId !== parsed.remoteId;
  const unchanged = !needsSettingsUpdate && !needsLeftidUpdate;

  return {
    ...parsed,
    dns,
    ports,
    unchanged,
    needsNewCert,
    needsLeftidUpdate,
    certificate: status.certificate,
    current: status.current,
    messages: [
      unchanged ? 'Endpoint و strongSwan هم‌اکنون هماهنگ هستند.' : null,
      needsNewCert ? 'گواهی سرور با Endpoint جدید هماهنگ نیست — برای اتصال موفق، گواهی جدید لازم است.' : 'گواهی سرور با Endpoint جدید هماهنگ است.',
      needsLeftidUpdate ? `leftid در ipsec.conf هنوز «${status.certificate.leftid}» است — Apply آن را به «${parsed.remoteId}» تغییر می‌دهد.` : null,
      parsed.type === 'domain' && !dns.ok ? 'دامنه resolve نشد — قبل از Apply مطمئن شوید DNS درست است.' : null,
    ].filter(Boolean),
  };
}

async function healthCheck() {
  const ports = await checkPorts();
  let strongswan = false;
  let ikeOk = false;
  try {
    await helper(['status'], 15000);
    strongswan = true;
  } catch { /* ignore */ }
  try {
    const sas = await helper(['list-sas'], 10000);
    ikeOk = true;
    void sas;
  } catch { /* ignore */ }
  return {
    ok: ports.udp500 && ports.udp4500 && strongswan,
    ports,
    strongswan,
    ikeResponding: ikeOk,
  };
}

async function recordHistory(row) {
  await db.query(
    `INSERT INTO vpn_endpoint_history(old_endpoint, new_endpoint, old_certificate, new_certificate, backup_path, status, error_message, changed_by)
     VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)`,
    [row.oldEndpoint, row.newEndpoint, JSON.stringify(row.oldCertificate || null), JSON.stringify(row.newCertificate || null),
      row.backupPath || null, row.status, row.errorMessage || null, row.changedBy || null],
  );
}

export async function applyEndpointChange({ endpoint, confirmNewCert, adminId }) {
  const parsed = normalizeEndpoint(endpoint);
  const validation = await validateEndpointChange(parsed.endpoint);

  if (validation.unchanged) {
    throw new EndpointError('UNCHANGED', 'Endpoint تغییری نکرده است.');
  }
  if (validation.needsNewCert && !confirmNewCert) {
    throw new EndpointError('CERT_CONFIRM_REQUIRED', 'برای Endpoint جدید باید ساخت گواهی جدید را تأیید کنید.');
  }
  if (parsed.type === 'domain' && !validation.dns.ok) {
    throw new EndpointError('DNS_FAILED', 'دامنه resolve نمی‌شود. DNS را اصلاح کنید یا بعداً دوباره تلاش کنید.');
  }

  let backupPath = null;
  try {
    backupPath = await helper(['endpoint-backup']);
    if (validation.needsNewCert) {
      await helper(['issue-server-cert', parsed.remoteId], 120000);
    }
    await helper(['set-leftid', parsed.remoteId]);
    await helper(['normalize-conn']);
    await helper(['restart-strongswan'], 90000);

    await updateSettings('vpn', {
      serverAddress: parsed.serverAddress,
      remoteId: parsed.remoteId,
    });
    invalidateVpnConfigCache();

    const newCert = parseCertInfo(await helper(['cert-info']));
    const health = await healthCheck();
    if (!health.ok) {
      throw new EndpointError('HEALTH_FAILED', 'تغییرات اعمال شد اما health check کامل موفق نبود.');
    }

    await recordHistory({
      oldEndpoint: `${validation.current.serverAddress} / ${validation.current.remoteId}`,
      newEndpoint: `${parsed.serverAddress} / ${parsed.remoteId}`,
      oldCertificate: validation.certificate,
      newCertificate: newCert,
      backupPath,
      status: 'applied',
      changedBy: adminId,
    });

    return {
      ok: true,
      endpoint: parsed,
      certificate: newCert,
      health,
      message: 'Endpoint VPN با موفقیت به‌روزرسانی شد. پروفایل‌های جدید با آدرس جدید ساخته می‌شوند؛ لینک‌های دانلود کاربران تغییر نمی‌کند.',
    };
  } catch (e) {
    if (backupPath) {
      try { await helper(['endpoint-rollback', backupPath], 120000); } catch (rb) {
        console.error('[endpoint rollback]', rb.message);
      }
    }
    await recordHistory({
      oldEndpoint: `${validation.current.serverAddress} / ${validation.current.remoteId}`,
      newEndpoint: `${parsed.serverAddress} / ${parsed.remoteId}`,
      oldCertificate: validation.certificate,
      newCertificate: null,
      backupPath,
      status: 'failed',
      errorMessage: e.message,
      changedBy: adminId,
    });
    throw e;
  }
}

export async function listEndpointHistory(limit = 20) {
  return many(
    `SELECT h.*, a.username AS admin_username FROM vpn_endpoint_history h
     LEFT JOIN admins a ON a.id=h.changed_by ORDER BY h.created_at DESC LIMIT $1`,
    [limit],
  );
}
