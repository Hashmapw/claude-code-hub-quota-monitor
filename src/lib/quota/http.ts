import axios from 'axios';
import { ProxyAgent } from 'proxy-agent';
import { getConfig } from '@/lib/config';
import { logDebug } from '@/lib/logger';
import { getEffectiveProxyUrl } from '@/lib/system-settings';
import type { AuthMethod } from '@/lib/quota/types';

export type HttpAttempt = {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  status: number;
  latencyMs: number;
  contentType: string | null;
  requestHeaders: Record<string, string>;
  requestBodyPreview?: string;
  bodyPreview?: string;
  error?: string;
};

export type HttpResponse = {
  url: string;
  status: number;
  bodyText: string;
  json: unknown | null;
  latencyMs: number;
  contentType: string | null;
  attempts: HttpAttempt[];
};

export type RequestAuthOptions = {
  authMethod: AuthMethod;
  apiKey: string;
  urlKeyName?: string | null;
  cookieValue?: string | null;
  userId?: string | null;
  fallbackCookie?: string | null;
  acwFallbackCookie?: string | null;
};

export type RequestExecutionOptions = {
  autoHandle403Intercept?: boolean;
};

type HttpTransportResponse = {
  status: number;
  bodyText: string;
  contentType: string | null;
  setCookies: string[];
};

const proxyAgentCache = new Map<string, ProxyAgent>();

function resolveHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim());
    return first ? first.trim() : null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function getProxyAgent(proxyUrl: string): ProxyAgent {
  const cached = proxyAgentCache.get(proxyUrl);
  if (cached) {
    return cached;
  }

  const created = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
  proxyAgentCache.set(proxyUrl, created);
  return created;
}

async function requestByAxios(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  proxyUrl: string,
  body?: unknown,
): Promise<HttpTransportResponse> {
  const agent = getProxyAgent(proxyUrl);
  const response = await axios.request({
    method,
    url,
    headers,
    ...(method !== 'GET' ? { data: body } : {}),
    responseType: 'text',
    timeout: getConfig().requestTimeoutMs,
    validateStatus: () => true,
    signal,
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    maxRedirects: 5,
    transitional: {
      forcedJSONParsing: false,
      silentJSONParsing: true,
    },
  });

  let bodyText = '';
  if (typeof response.data === 'string') {
    bodyText = response.data;
  } else if (response.data === null || response.data === undefined) {
    bodyText = '';
  } else {
    bodyText = JSON.stringify(response.data);
  }

  return {
    status: response.status,
    bodyText,
    contentType: resolveHeaderValue(response.headers?.['content-type']),
    setCookies: ([] as string[]).concat(response.headers?.['set-cookie'] ?? []),
  };
}

async function requestByFetch(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  body?: unknown,
): Promise<HttpTransportResponse> {
  const requestHeaders = method === 'GET'
    ? headers
    : { ...headers, 'Content-Type': 'application/json' };

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    signal,
    cache: 'no-store',
  });

  return {
    status: response.status,
    bodyText: await response.text(),
    contentType: response.headers.get('content-type'),
    setCookies: response.headers.getSetCookie?.() ?? [],
  };
}

async function performHttpGet(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<HttpTransportResponse> {
  const proxyUrl = getEffectiveProxyUrl();
  if (proxyUrl) {
    return requestByAxios('GET', url, headers, signal, proxyUrl);
  }

  return requestByFetch('GET', url, headers, signal);
}

async function performHttpWrite(
  method: 'POST' | 'PUT',
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<HttpTransportResponse> {
  const proxyUrl = getEffectiveProxyUrl();
  if (proxyUrl) {
    return requestByAxios(method, url, headers, signal, proxyUrl, body);
  }

  return requestByFetch(method, url, headers, signal, body);
}

function withBase(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function resolveCandidateUrls(baseUrl: string, path: string): string[] {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const candidates: string[] = [];

  try {
    const parsed = new URL(baseUrl);
    const origin = parsed.origin;
    const pathname = parsed.pathname.replace(/\/+$/, '');

    // If baseUrl pathname ends with the same prefix as path, prioritize the de-duped URL
    if (pathname && pathname !== '/') {
      const pathPrefix = normalizedPath.split('/').filter(Boolean)[0];
      if (pathPrefix && pathname.endsWith(`/${pathPrefix}`)) {
        const prefix = pathname.slice(0, -(pathPrefix.length + 1)) || '';
        candidates.push(`${origin}${prefix}${normalizedPath}`);
      }
    }

    candidates.push(withBase(baseUrl, normalizedPath));
    candidates.push(`${origin}${normalizedPath}`);

    if (pathname && pathname !== '/') {
      const segments = pathname.split('/').filter(Boolean);

      for (let length = segments.length; length >= 1; length -= 1) {
        const prefix = `/${segments.slice(0, length).join('/')}`;
        candidates.push(`${origin}${prefix}${normalizedPath}`);
      }

      if (normalizedPath.startsWith('/v1/') && pathname.endsWith('/v1')) {
        const prefix = pathname.slice(0, -3) || '/';
        candidates.push(`${origin}${prefix === '/' ? '' : prefix}${normalizedPath}`);
      }

      if (normalizedPath.startsWith('/api/') && pathname.endsWith('/api')) {
        const prefix = pathname.slice(0, -4) || '/';
        candidates.push(`${origin}${prefix === '/' ? '' : prefix}${normalizedPath}`);
      }
    }
  } catch {
    candidates.push(withBase(baseUrl, normalizedPath));
  }

  return Array.from(new Set(candidates));
}

function normalizeToken(raw: string): string {
  const token = raw.trim();
  if (!token) {
    return token;
  }
  return token.replace(/^Bearer\s+/i, '').trim();
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveEffectiveUserId(
  auth: RequestAuthOptions,
  userIdOverride?: string | null,
): string | null {
  const fallbackUserId = normalizeOptional(auth.userId);
  if (userIdOverride === undefined) {
    return fallbackUserId;
  }
  return normalizeOptional(userIdOverride) ?? fallbackUserId;
}

function appendQueryParam(url: string, key: string, value: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function shouldAttachUserIdToPath(_path: string): boolean {
  return false;
}

function appendUserIdCandidates(url: string, path: string, userId: string | null): string[] {
  if (!userId || !shouldAttachUserIdToPath(path)) {
    return [url];
  }

  return [
    appendQueryParam(url, 'user_id', userId),
    appendQueryParam(url, 'id', userId),
    appendQueryParam(url, 'uid', userId),
    url,
  ];
}

function looksLikeSecretToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^sk-[A-Za-z0-9_-]{16,}$/.test(trimmed)) {
    return true;
  }

  return trimmed.length >= 48;
}

function resolveUrlKeyParamNames(input: string | null | undefined): string[] {
  const candidate = normalizeOptional(input);
  if (!candidate) {
    return ['key'];
  }

  if (looksLikeSecretToken(candidate)) {
    return ['key'];
  }

  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,48}$/.test(candidate)) {
    return ['key'];
  }

  if (candidate === 'key') {
    return ['key'];
  }

  return [candidate, 'key'];
}

function buildCompatUserHeaders(userId: string | null): Record<string, string> {
  if (!userId) {
    return {};
  }

  return {
    'New-API-User': userId,
  };
}

function createAbortSignal(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getConfig().requestTimeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

function appendUrlKey(url: string, paramName: string, key: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(paramName, key);
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(paramName)}=${encodeURIComponent(key)}`;
  }
}

function createHeaders(
  baseUrl: string,
  auth: RequestAuthOptions,
  extraHeaders: Record<string, string> | undefined,
  userIdOverride?: string | null,
): Record<string, string> {
  const token = normalizeToken(auth.apiKey);
  const resolvedUserId = resolveEffectiveUserId(auth, userIdOverride);

  const baseHeaders: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Pragma: 'no-cache',
    ...buildCompatUserHeaders(resolvedUserId),
  };

  if (auth.authMethod === 'cookie') {
    const base = baseUrl.replace(/\/+$/, '');
    return {
      ...baseHeaders,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      Referer: `${base}/console/personal`,
      Origin: base,
      ...(auth.cookieValue ? { Cookie: auth.cookieValue } : {}),
      ...extraHeaders,
    };
  }

  const browserHeaders: Record<string, string> = auth.fallbackCookie
    ? {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        Referer: `${baseUrl.replace(/\/+$/, '')}/console/personal`,
        Origin: baseUrl.replace(/\/+$/, ''),
      }
    : {};

  if (auth.authMethod === 'url_key') {
    return {
      ...baseHeaders,
      ...browserHeaders,
      ...extraHeaders,
    };
  }

  return {
    ...baseHeaders,
    ...browserHeaders,
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
}

function buildRequestUrls(
  baseUrl: string,
  path: string,
  auth: RequestAuthOptions,
  userId: string | null,
): string[] {
  const candidates = resolveCandidateUrls(baseUrl, path);

  const authExpandedUrls: string[] = [];
  if (auth.authMethod !== 'url_key') {
    authExpandedUrls.push(...candidates);
  } else {
    const token = normalizeToken(auth.apiKey);
    const paramNames = resolveUrlKeyParamNames(auth.urlKeyName);

    for (const url of candidates) {
      for (const paramName of paramNames) {
        authExpandedUrls.push(appendUrlKey(url, paramName, token));
      }
    }
  }

  const urls: string[] = [];
  for (const url of authExpandedUrls) {
    urls.push(...appendUserIdCandidates(url, path, userId));
  }

  return Array.from(new Set(urls));
}

function summarizeBodyPreview(bodyText: string): string {
  const normalized = bodyText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized;
}

function maskHeaderValue(key: string, value: string): string {
  return value.trim();
}

function maskRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = maskHeaderValue(key, value);
  }
  return result;
}

function maskSensitiveUrl(url: string): string {
  return url;
}

// --- acw_sc__v2 anti-bot cookie solver ---

function acwDecode(encoded: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  const bytes: number[] = [];
  let q = 0;
  let r = 0;
  for (const ch of encoded) {
    const s = alphabet.indexOf(ch);
    if (s === -1) continue;
    const oldQ = q;
    r = oldQ % 4 !== 0 ? r * 64 + s : s;
    q += 1;
    if (oldQ % 4 !== 0) {
      bytes.push(0xff & (r >> ((-2 * q) & 6)));
    }
  }
  return Buffer.from(bytes).toString('utf-8');
}

function acwSolve(html: string): string | null {
  const argMatch = html.match(/var\s+arg1\s*=\s*'([0-9A-Fa-f]+)'/);
  if (!argMatch) return null;
  const arg1 = argMatch[1];

  const arrMatch = html.match(/a0i\s*,\s*(0x[0-9a-fA-F]+)\s*\)/);
  if (!arrMatch) return null;
  const target = parseInt(arrMatch[1], 16);

  const nMatch = html.match(/function\s+a0i\s*\(\)\s*\{\s*var\s+\w+\s*=\s*\[([^\]]+)\]/);
  if (!nMatch) return null;
  const nOriginal = nMatch[1].match(/'([^']*)'/g)?.map((s) => s.slice(1, -1));
  if (!nOriginal) return null;

  const mMatch = html.match(/var\s+m\s*=\s*\[([0-9a-fA-Fx,\s]+)\]/);
  if (!mMatch) return null;
  const m = mMatch[1].split(',').map((s) => parseInt(s.trim(), 16));

  // Indices used in the checksum expression (from the IIFE)
  const exprMatch = html.match(
    /parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x1\*.*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x2\).*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x3\*.*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x4\).*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x5\*.*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x6\).*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x7\*.*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x8\).*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0x9.*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0xa\*.*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0xb\).*?parseInt\(\w+\((0x[0-9a-f]+)\)\)\/0xc/,
  );
  if (!exprMatch) return null;

  const baseIdx = parseInt(
    html.match(/\w+=\w+-\s*(0x[0-9a-f]+)/)?.[1] ?? '0xfb',
    16,
  );

  const idxs = exprMatch.slice(1, 13).map((s) => parseInt(s, 16) - baseIdx);

  function jsParseInt(s: string): number {
    const match = s.match(/^[+-]?\d+/);
    return match ? parseInt(match[0], 10) : NaN;
  }

  // Rotate N array until checksum matches
  const N = [...nOriginal];
  let found = false;
  for (let rot = 0; rot < N.length; rot++) {
    try {
      const v = idxs.map((i) => jsParseInt(acwDecode(N[i])));
      if (v.some((x) => isNaN(x))) {
        N.push(N.shift()!);
        continue;
      }
      const e =
        -(v[0]) / 1 * (v[1] / 2) +
        -(v[2]) / 3 * (v[3] / 4) +
        -(v[4]) / 5 * (-(v[5]) / 6) +
        -(v[6]) / 7 * (v[7] / 8) +
        v[8] / 9 +
        v[9] / 10 * (v[10] / 11) +
        v[11] / 12;
      if (Math.round(e) === target) {
        found = true;
        break;
      }
    } catch {
      // ignore
    }
    N.push(N.shift()!);
  }
  if (!found) return null;

  // Get XOR key: a0j(0x115) -> N[0x115 - baseIdx]
  const pKeyMatch = html.match(/p\s*=\s*\w+\((0x[0-9a-f]+)\)/);
  const pIdx = pKeyMatch ? parseInt(pKeyMatch[1], 16) - baseIdx : 0x115 - baseIdx;
  const p = acwDecode(N[pIdx]);

  // Reorder arg1 using m
  const q: string[] = new Array(m.length).fill('');
  for (let x = 0; x < arg1.length; x++) {
    for (let z = 0; z < m.length; z++) {
      if (m[z] === x + 1) {
        q[z] = arg1[x];
        break;
      }
    }
  }
  const u = q.join('');

  // XOR each 2-char hex pair
  let result = '';
  for (let i = 0; i < u.length && i < p.length; i += 2) {
    const xor = parseInt(u.slice(i, i + 2), 16) ^ parseInt(p.slice(i, i + 2), 16);
    result += xor.toString(16).padStart(2, '0');
  }

  return result;
}

function isAcwChallenge(bodyText: string, contentType: string | null): boolean {
  if (!(contentType || '').toLowerCase().includes('text/html') &&
      !bodyText.trim().toLowerCase().startsWith('<html') &&
      !bodyText.trim().toLowerCase().startsWith('<!doctype')) {
    return false;
  }
  return /var\s+arg1\s*=\s*'[0-9A-Fa-f]+'/.test(bodyText) && bodyText.includes('acw_sc__v2');
}

// Per-host acw_sc__v2 cookie cache
const acwCookieCache = new Map<string, string>();

function getAcwCookieForUrl(url: string): string | null {
  try {
    const host = new URL(url).host;
    return acwCookieCache.get(host) ?? null;
  } catch {
    return null;
  }
}

function setAcwCookieForUrl(url: string, value: string): void {
  try {
    const host = new URL(url).host;
    acwCookieCache.set(host, value);
  } catch {
    // ignore
  }
}

function stripAcwFromCookie(cookie: string): string {
  return cookie
    .replace(/acw_sc__v2=[^;]*(;\s*)?/g, '')
    .replace(/;\s*$/, '')
    .trim();
}

function parseSetCookies(setCookies: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const sc of setCookies) {
    const pair = sc.split(';')[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq > 0) {
      result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return result;
}

function mergeCookies(existing: string, newCookies: Record<string, string>): string {
  const parts: Record<string, string> = {};
  for (const segment of existing.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      parts[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  Object.assign(parts, newCookies);
  return Object.entries(parts).map(([k, v]) => `${k}=${v}`).join('; ');
}

function buildAcwHeaders(
  headers: Record<string, string>,
  originalCookie: string,
  url: string,
  serverCookies?: Record<string, string>,
): Record<string, string> {
  const acw = getAcwCookieForUrl(url);
  let baseCookie = stripAcwFromCookie(originalCookie);
  if (serverCookies && Object.keys(serverCookies).length > 0) {
    baseCookie = mergeCookies(baseCookie, serverCookies);
  }
  if (acw) {
    const cookiePart = `acw_sc__v2=${acw}`;
    return { ...headers, Cookie: baseCookie ? `${baseCookie}; ${cookiePart}` : cookiePart };
  }
  if (originalCookie) {
    return { ...headers, Cookie: baseCookie || originalCookie };
  }
  return { ...headers };
}

function injectAcwCookie(headers: Record<string, string>, url: string): Record<string, string> {
  const acw = getAcwCookieForUrl(url);
  if (!acw) return { ...headers };
  const existing = stripAcwFromCookie(headers['Cookie'] || '');
  const cookiePart = `acw_sc__v2=${acw}`;
  return { ...headers, Cookie: existing ? `${existing}; ${cookiePart}` : cookiePart };
}

function maybeDebugLog(path: string, attempt: HttpAttempt): void {
  void path;
  void attempt;
}

export async function getJsonWithAuth(
  baseUrl: string,
  path: string,
  auth: RequestAuthOptions,
  extraHeaders?: Record<string, string>,
  userIdOverride?: string | null,
  executionOptions?: RequestExecutionOptions,
): Promise<HttpResponse> {
  const resolvedUserId = resolveEffectiveUserId(auth, userIdOverride);
  const requestUrls = buildRequestUrls(baseUrl, path, auth, resolvedUserId);
  const headers = createHeaders(baseUrl, auth, extraHeaders, resolvedUserId);
  const autoHandle403Intercept = executionOptions?.autoHandle403Intercept !== false;

  const attempts: HttpAttempt[] = [];
  let lastResponse: HttpResponse | null = null;

  // Freeze the original cookie string so fetch() mutations can't affect it
  const originalCookie: string = headers['Cookie'] || auth.fallbackCookie || '';

  for (const url of requestUrls) {
    // Inject cached acw cookie for any request that has a cookie source
    const effectiveHeaders = autoHandle403Intercept && originalCookie
      ? buildAcwHeaders(headers, originalCookie, url)
      : { ...headers };
    const { signal, cancel } = createAbortSignal();
    const start = Date.now();
    let currentHeaders = effectiveHeaders;

    try {
      let response = await performHttpGet(url, effectiveHeaders, signal);
      let bodyText = response.bodyText;

      // Handle acw_sc__v2 anti-bot challenge for any request
      if (autoHandle403Intercept && isAcwChallenge(bodyText, response.contentType)) {
        logDebug('http.acw', {
          event: 'challenge_detected',
          method: 'GET',
          url,
          contentType: response.contentType,
        });
        const solved = acwSolve(bodyText);
        if (solved) {
          logDebug('http.acw', {
            event: 'cookie_solved',
            method: 'GET',
            url,
            cookie: solved,
          });
          setAcwCookieForUrl(url, solved);

          const serverCookies = parseSetCookies(response.setCookies);

          attempts.push({
            url: maskSensitiveUrl(url),
            method: 'GET',
            status: response.status,
            latencyMs: Date.now() - start,
            contentType: response.contentType,
            requestHeaders: maskRequestHeaders(effectiveHeaders),
            bodyPreview: `[acw_sc__v2 challenge] solved=${solved}, server-set-cookies=[${Object.keys(serverCookies).join(', ')}]`,
          });

          cancel();
          const { signal: retrySignal, cancel: retryCancel } = createAbortSignal();
          try {
            const acwCookie = originalCookie || auth.acwFallbackCookie || '';
            const retryHeaders = buildAcwHeaders(headers, acwCookie, url, serverCookies);
            currentHeaders = retryHeaders;
            response = await performHttpGet(url, retryHeaders, retrySignal);
            bodyText = response.bodyText;
            logDebug('http.acw', {
              event: 'retry_result',
              method: 'GET',
              url,
              status: response.status,
              contentType: response.contentType,
              isChallenge: isAcwChallenge(bodyText, response.contentType),
            });
          } finally {
            retryCancel();
          }
        } else {
          logDebug('http.acw', {
            event: 'solve_failed',
            method: 'GET',
            url,
          });
        }
      }

      let parsed: unknown | null = null;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        parsed = null;
      }

      const current: HttpResponse = {
        url,
        status: response.status,
        bodyText,
        json: parsed,
        latencyMs: Date.now() - start,
        contentType: response.contentType,
        attempts: [],
      };

      const attempt: HttpAttempt = {
        url: maskSensitiveUrl(url),
        method: 'GET',
        status: current.status,
        latencyMs: current.latencyMs,
        contentType: current.contentType,
        requestHeaders: maskRequestHeaders(currentHeaders),
        bodyPreview: summarizeBodyPreview(bodyText),
      };

      attempts.push(attempt);
      maybeDebugLog(path, attempt);

      lastResponse = {
        ...current,
        attempts: [...attempts],
      };

      if (current.status < 500 && current.status !== 404 && current.status !== 405) {
        return {
          ...current,
          attempts: [...attempts],
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latencyMs = Date.now() - start;

      const attempt: HttpAttempt = {
        url: maskSensitiveUrl(url),
        method: 'GET',
        status: 598,
        latencyMs,
        contentType: null,
        requestHeaders: maskRequestHeaders(currentHeaders),
        error: message,
      };
      attempts.push(attempt);
      maybeDebugLog(path, attempt);

      lastResponse = {
        url,
        status: 598,
        bodyText: message,
        json: null,
        latencyMs,
        contentType: null,
        attempts: [...attempts],
      };
      continue;
    } finally {
      cancel();
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  return {
    url: withBase(baseUrl, path),
    status: 599,
    bodyText: '',
    json: null,
    latencyMs: 0,
    contentType: null,
    attempts,
  };
}

async function writeJsonInternal(
  method: 'POST' | 'PUT',
  baseUrl: string,
  path: string,
  body: unknown,
  auth: RequestAuthOptions,
  extraHeaders?: Record<string, string>,
  userIdOverride?: string | null,
  executionOptions?: RequestExecutionOptions,
): Promise<HttpResponse> {
  const resolvedUserId = resolveEffectiveUserId(auth, userIdOverride);
  const urls = buildRequestUrls(baseUrl, path, auth, resolvedUserId);
  const headers: Record<string, string> = createHeaders(baseUrl, auth, extraHeaders, resolvedUserId);
  const autoHandle403Intercept = executionOptions?.autoHandle403Intercept !== false;
  const originalCookie: string = headers['Cookie'] || auth.fallbackCookie || '';

  const attempts: HttpAttempt[] = [];
  let lastResponse: HttpResponse | null = null;
  const requestBodyPreview = summarizeRaw(body);
  const normalizedRequestBodyPreview = requestBodyPreview.trim() ? requestBodyPreview : undefined;

  for (const url of urls) {
    const requestHeaders = autoHandle403Intercept && originalCookie
      ? buildAcwHeaders(headers, originalCookie, url)
      : { ...headers };
    const { signal, cancel } = createAbortSignal();
    const start = Date.now();

    try {
      let response = await performHttpWrite(method, url, requestHeaders, body, signal);
      let bodyText = response.bodyText;
      let currentHeaders = requestHeaders;

      if (autoHandle403Intercept && isAcwChallenge(bodyText, response.contentType)) {
        logDebug('http.acw', {
          event: 'challenge_detected',
          method,
          url,
          contentType: response.contentType,
        });
        const solved = acwSolve(bodyText);
        if (solved) {
          logDebug('http.acw', {
            event: 'cookie_solved',
            method,
            url,
            cookie: solved,
          });
          setAcwCookieForUrl(url, solved);
          const serverCookies = parseSetCookies(response.setCookies);

          attempts.push({
            url: maskSensitiveUrl(url),
            method,
            status: response.status,
            latencyMs: Date.now() - start,
            contentType: response.contentType,
            requestHeaders: maskRequestHeaders(requestHeaders),
            ...(normalizedRequestBodyPreview ? { requestBodyPreview: normalizedRequestBodyPreview } : {}),
            bodyPreview: `[acw_sc__v2 challenge] solved=${solved}, server-set-cookies=[${Object.keys(serverCookies).join(', ')}]`,
          });

          cancel();
          const { signal: retrySignal, cancel: retryCancel } = createAbortSignal();
          try {
            const acwCookie = originalCookie || auth.acwFallbackCookie || '';
            const retryHeaders = buildAcwHeaders(headers, acwCookie, url, serverCookies);
            currentHeaders = retryHeaders;
            response = await performHttpWrite(method, url, retryHeaders, body, retrySignal);
            bodyText = response.bodyText;
            logDebug('http.acw', {
              event: 'retry_result',
              method,
              url,
              status: response.status,
              contentType: response.contentType,
              isChallenge: isAcwChallenge(bodyText, response.contentType),
            });
          } finally {
            retryCancel();
          }
        } else {
          logDebug('http.acw', {
            event: 'solve_failed',
            method,
            url,
          });
        }
      }

      let parsed: unknown | null = null;
      try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { parsed = null; }

      const attempt: HttpAttempt = {
        url: maskSensitiveUrl(url),
        method,
        status: response.status,
        latencyMs: Date.now() - start,
        contentType: response.contentType,
        requestHeaders: maskRequestHeaders(currentHeaders),
        ...(normalizedRequestBodyPreview ? { requestBodyPreview: normalizedRequestBodyPreview } : {}),
        bodyPreview: summarizeBodyPreview(bodyText),
      };
      attempts.push(attempt);
      maybeDebugLog(path, attempt);

      lastResponse = {
        url,
        status: response.status,
        bodyText,
        json: parsed,
        latencyMs: Date.now() - start,
        contentType: response.contentType,
        attempts: [...attempts],
      };

      if (response.status < 500 && response.status !== 404 && response.status !== 405) {
        return lastResponse;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        url: maskSensitiveUrl(url),
        method,
        status: 598,
        latencyMs: Date.now() - start,
        contentType: null,
        requestHeaders: maskRequestHeaders(requestHeaders),
        ...(normalizedRequestBodyPreview ? { requestBodyPreview: normalizedRequestBodyPreview } : {}),
        error: message,
      });
      maybeDebugLog(path, attempts[attempts.length - 1]);
      lastResponse = { url, status: 598, bodyText: message, json: null, latencyMs: Date.now() - start, contentType: null, attempts: [...attempts] };
    } finally {
      cancel();
    }
  }

  return lastResponse ?? {
    url: withBase(baseUrl, path),
    status: 599,
    bodyText: '',
    json: null,
    latencyMs: 0,
    contentType: null,
    attempts,
  };
}

export async function postJsonWithResolvedAuth(
  baseUrl: string,
  path: string,
  body: unknown,
  auth: RequestAuthOptions,
  extraHeaders?: Record<string, string>,
  userIdOverride?: string | null,
  executionOptions?: RequestExecutionOptions,
): Promise<HttpResponse> {
  return writeJsonInternal('POST', baseUrl, path, body, auth, extraHeaders, userIdOverride, executionOptions);
}

export async function putJsonWithResolvedAuth(
  baseUrl: string,
  path: string,
  body: unknown,
  auth: RequestAuthOptions,
  extraHeaders?: Record<string, string>,
  userIdOverride?: string | null,
  executionOptions?: RequestExecutionOptions,
): Promise<HttpResponse> {
  return writeJsonInternal('PUT', baseUrl, path, body, auth, extraHeaders, userIdOverride, executionOptions);
}

export async function postJsonWithAuth(
  baseUrl: string,
  path: string,
  body: unknown,
  apiKey: string,
): Promise<HttpResponse> {
  return writeJsonInternal(
    'POST',
    baseUrl,
    path,
    body,
    {
      authMethod: 'bearer',
      apiKey,
      urlKeyName: null,
      cookieValue: null,
      userId: null,
    },
    undefined,
    null,
  );
}

export function unwrapCommonEnvelope(json: unknown): Record<string, unknown> | null {
  void json;
  // Global override: disable automatic envelope unwrapping.
  // Callers should always use explicit field paths against the original JSON payload.
  return null;
}

export function isLikelyHtml(bodyText: string, contentType: string | null): boolean {
  const content = bodyText.trim().toLowerCase();
  const type = (contentType || '').toLowerCase();
  if (type.includes('text/html')) {
    return true;
  }
  return content.startsWith('<!doctype html') || content.startsWith('<html');
}

export function summarizeRaw(value: unknown): string {
  try {
    const rawText = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const normalized = (rawText || '').trim();
    if (!normalized) {
      return '';
    }

    let formatted = normalized;
    if (typeof value === 'string') {
      try {
        formatted = JSON.stringify(JSON.parse(normalized), null, 2);
      } catch {
        formatted = normalized;
      }
    }
    return formatted;
  } catch {
    return '';
  }
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    // Accept common formatted numeric strings, e.g. "2,930,630", "$84.2572".
    const normalized = trimmed
      .replace(/[,\uFF0C_]/g, '')
      .replace(/\s+/g, '')
      .replace(/^[$￥¥€£]/, '')
      .replace(/%$/, '');
    if (normalized) {
      const looseParsed = Number(normalized);
      if (Number.isFinite(looseParsed)) {
        return looseParsed;
      }
    }
  }
  return null;
}
