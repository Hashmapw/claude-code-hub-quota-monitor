import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MONITOR_AUTH_COOKIE_NAME = 'monitor-admin-session';
export const MONITOR_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type MonitorSession = {
  role: 'admin';
  issuedAt: number;
  expiresAt: number;
};

function normalizeSecret(value: string | null | undefined): string | null {
  const normalized = (value || '').trim();
  return normalized || null;
}

function toBase64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url');
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf-8')) as T;
  } catch {
    return null;
  }
}

function hashText(value: string): Buffer {
  return createHash('sha256').update(value, 'utf-8').digest();
}

function constantTimeTextEqual(left: string, right: string): boolean {
  return timingSafeEqual(hashText(left), hashText(right));
}

function buildSessionSignature(payload: string, secret: string): string {
  return createHmac('sha256', `quota-monitor:${secret}`)
    .update(payload, 'utf-8')
    .digest('base64url');
}

function parseIpv4Candidate(value: string): [number, number, number, number] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return null;
  }

  const parts = value.split('.').map((item) => Number.parseInt(item, 10));
  if (parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return null;
  }

  return parts as [number, number, number, number];
}

export function readMonitorAdminPassword(): string | null {
  return normalizeSecret(process.env.MONITOR_ADMIN_PASSWORD);
}

export function isMonitorAuthConfigured(): boolean {
  return Boolean(readMonitorAdminPassword());
}

export function isMonitorAdminPasswordValid(password: string): boolean {
  const secret = readMonitorAdminPassword();
  const candidate = normalizeSecret(password);
  if (!secret || !candidate) {
    return false;
  }

  return constantTimeTextEqual(candidate, secret);
}

export function createMonitorSessionToken(now = Date.now()): string | null {
  const secret = readMonitorAdminPassword();
  if (!secret) {
    return null;
  }

  const payload = toBase64UrlJson({
    role: 'admin',
    issuedAt: now,
    expiresAt: now + MONITOR_AUTH_MAX_AGE_SECONDS * 1000,
  } satisfies MonitorSession);
  const signature = buildSessionSignature(payload, secret);
  return `${payload}.${signature}`;
}

export function parseMonitorSessionToken(token: string | null | undefined): MonitorSession | null {
  const secret = readMonitorAdminPassword();
  const normalizedToken = (token || '').trim();
  if (!secret || !normalizedToken) {
    return null;
  }

  const [payload, signature] = normalizedToken.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = buildSessionSignature(payload, secret);
  if (!constantTimeTextEqual(signature, expectedSignature)) {
    return null;
  }

  const parsed = parseBase64UrlJson<MonitorSession>(payload);
  if (
    !parsed ||
    parsed.role !== 'admin' ||
    !Number.isFinite(parsed.issuedAt) ||
    !Number.isFinite(parsed.expiresAt) ||
    parsed.expiresAt <= Date.now()
  ) {
    return null;
  }

  return parsed;
}

export function hasValidMonitorSessionToken(token: string | null | undefined): boolean {
  return Boolean(parseMonitorSessionToken(token));
}

export function sanitizeAuthRedirectTarget(value: string | null | undefined): string {
  const candidate = (value || '').trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return '/';
  }

  try {
    const parsed = new URL(candidate, 'http://localhost');
    const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!target.startsWith('/') || target.startsWith('/login') || target.startsWith('/api/auth/')) {
      return '/';
    }
    return target;
  } catch {
    return '/';
  }
}

export function isTrustedLocalAddress(value: string | null | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }

  const withoutMappedPrefix = normalized.replace(/^::ffff:/, '');
  const ipv4WithoutPort = withoutMappedPrefix.replace(/:\d+$/, '');
  const ipv4 = parseIpv4Candidate(ipv4WithoutPort);
  if (ipv4) {
    const [first, second] = ipv4;
    return (
      first === 127 ||
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}
