export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ApiState<T> = {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  error?: Error;
};

function messageFromResponse(data: unknown): string {
  if (typeof data === 'object' && data && 'message' in data) {
    const value = (data as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'Server request failed';
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(messageFromResponse(payload), response.status);
  }

  return payload as T;
}

export interface VpnUser {
  id: string;
  username: string;
  enabled: boolean;
  status: string;
  expiresAt?: string;
  durationDays?: number;
  dailyLimitBytes?: number | null;
  totalLimitBytes?: number | null;
  unlimitedTraffic: boolean;
  maxDevices: number;
  usageTotal: number;
  uploadBytes: number;
  downloadBytes: number;
  todayBytes: number;
  remainingTraffic?: number | null;
  remainingDays?: number | null;
  online: number;
  lastSeenAt?: string;
  firstConnectedAt?: string;
  downloadToken?: string;
  note?: string;
  createdAt: string;
}

export interface DownloadLinks {
  landing: string;
  android: string;
  ios: string;
  windows: string;
  windowsLauncher: string;
}

export function normalizeLinks(links?: DownloadLinks | null): DownloadLinks | undefined {
  if (!links) return undefined;
  const fixUrl = (url: string) => {
    if (!url) return '';
    if (typeof window !== 'undefined' && (url.includes('127.0.0.1') || url.includes('localhost') || url.startsWith('/'))) {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return url;
  };
  return {
    landing: fixUrl(links.landing),
    android: fixUrl(links.android),
    ios: fixUrl(links.ios),
    windows: fixUrl(links.windows),
    windowsLauncher: fixUrl(links.windowsLauncher),
  };
}

export interface DashboardData {
  totals: { users: number; active: number; online: number; todayBytes: number; bytes: number };
  system?: { load?: number; strongswan?: string; uptime?: number; memoryPercent?: number };
}

export interface VpnSession {
  ikeId: string;
  username?: string;
  remoteId?: string;
  remoteHost?: string;
  virtualIp?: string;
  bytesIn?: number;
  bytesOut?: number;
  established?: number;
  state?: string;
  startedAt?: string;
  lastSeenAt?: string;
}

export interface AuditLog {
  id: string | number;
  action: string;
  status?: string;
  admin_username?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface SystemEvent {
  id: string | number;
  created_at: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  event: string;
  action: string;
  status: string;
  admin_id?: string;
  user_id?: string;
  request_id?: string;
  source: string;
  metadata?: Record<string, unknown>;
  admin_username?: string;
  vpn_username?: string;
}

export interface ObservabilityEventsResponse {
  rows: SystemEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ObservabilityStatsResponse {
  stats: {
    error: number;
    warn: number;
    info: number;
    debug: number;
  };
}
