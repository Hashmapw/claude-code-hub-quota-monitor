import { type NextRequest, NextResponse } from 'next/server';
import {
  MONITOR_AUTH_COOKIE_NAME,
  hasValidMonitorSessionToken,
  isTrustedLocalAddress,
  sanitizeAuthRedirectTarget,
} from '@/lib/monitor-auth-shared';

const PUBLIC_PAGE_PATHS = new Set(['/login']);
const PUBLIC_API_PATHS = new Set(['/api/auth/login', '/api/auth/logout']);

function normalizePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return trimmed.replace(/\/+$/, '') || '/';
}

function toPathname(value: string): string {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).pathname || '';
  } catch {
    return value;
  }
}

function cleanBasePath(pathname: string): string {
  if (!pathname) {
    return '';
  }
  const normalized = normalizePath(toPathname(pathname));
  return normalized === '/' ? '' : normalized;
}

function resolveRuntimeProxyUri(): string {
  const direct = process.env.VSCODE_PROXY_URI?.trim();
  if (direct) {
    const port = process.env.PORT || '3010';
    return direct.includes('{{port}}') ? direct.replace('{{port}}', port) : direct;
  }

  const vscodeUri = process.env.VSCODE_URI?.trim();
  if (!vscodeUri) {
    return '';
  }

  const port = process.env.PORT || '3010';
  if (vscodeUri.includes('{{port}}')) {
    return vscodeUri.replace('{{port}}', port);
  }

  const cleaned = vscodeUri.replace(/\/+$/, '');
  return cleaned.includes('/proxy/') ? cleaned : `${cleaned}/proxy/${port}`;
}

function extractProxyRoot(pathname: string): string {
  const normalizedPath = normalizePath(pathname);
  const proxyMatch = normalizedPath.match(/^(.*?\/proxy\/\d+)(?:\/.*)?$/);
  return cleanBasePath(proxyMatch?.[1] || '');
}

function configuredBasePath(): string {
  const runtimeProxyUri = resolveRuntimeProxyUri();
  if (runtimeProxyUri) {
    return cleanBasePath(runtimeProxyUri);
  }

  return cleanBasePath(process.env.NEXT_PUBLIC_BASE_PATH || '');
}

function deriveBasePath(pathname: string): string {
  const normalizedPath = normalizePath(pathname);
  const envBasePath = configuredBasePath();
  if (envBasePath && (normalizedPath === envBasePath || normalizedPath.startsWith(`${envBasePath}/`))) {
    return envBasePath;
  }

  const envProxyRoot = extractProxyRoot(envBasePath);
  if (envProxyRoot && (normalizedPath === envProxyRoot || normalizedPath.startsWith(`${envProxyRoot}/`))) {
    return envBasePath;
  }

  const requestProxyRoot = extractProxyRoot(normalizedPath);
  if (
    requestProxyRoot &&
    envBasePath &&
    envBasePath.endsWith(requestProxyRoot) &&
    (normalizedPath === requestProxyRoot || normalizedPath.startsWith(`${requestProxyRoot}/`))
  ) {
    return envBasePath;
  }

  return extractProxyRoot(normalizedPath);
}

function stripBasePath(pathname: string, basePath: string): string {
  const normalizedPath = normalizePath(pathname);
  const normalizedBasePath = cleanBasePath(basePath);
  if (!normalizedBasePath) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedBasePath) {
    return '/';
  }
  if (normalizedPath.startsWith(`${normalizedBasePath}/`)) {
    return normalizePath(normalizedPath.slice(normalizedBasePath.length));
  }

  const requestProxyRoot = extractProxyRoot(normalizedPath);
  if (requestProxyRoot && normalizedBasePath.endsWith(requestProxyRoot)) {
    if (requestProxyRoot === normalizedPath) {
      return '/';
    }
    if (normalizedPath.startsWith(`${requestProxyRoot}/`)) {
      return normalizePath(normalizedPath.slice(requestProxyRoot.length));
    }
  }

  return normalizedPath;
}

function buildRelativeLoginPath(from: string): string {
  return `/login?from=${encodeURIComponent(sanitizeAuthRedirectTarget(from))}`;
}

function buildRelativeRedirectHtml(targetPath: string): string {
  const safeTargetPath = JSON.stringify(targetPath);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
  <title>Redirecting...</title>
  <script>
    (() => {
      const targetPath = ${safeTargetPath};

      function normalizePath(pathname) {
        const trimmed = (pathname || '').trim();
        if (!trimmed || trimmed === '/') {
          return '/';
        }
        return trimmed.replace(/\\/+$/, '') || '/';
      }

      function detectBasePath(pathname) {
        const normalizedPath = normalizePath(pathname);
        const proxyMatch = normalizedPath.match(/^(.*?\\/proxy\\/\\d+)(?:\\/.*)?$/);
        return proxyMatch ? normalizePath(proxyMatch[1]) : '';
      }

      const currentPath = window.location.pathname;
      const basePath = detectBasePath(currentPath);
      const nextPath = targetPath.startsWith('/') && basePath && !targetPath.startsWith(basePath)
        ? basePath + targetPath
        : targetPath;

      window.location.replace(nextPath);
    })();
  </script>
  <noscript>
    <meta http-equiv="refresh" content="0;url=${targetPath}" />
  </noscript>
</head>
<body>Redirecting...</body>
</html>`;
}

function createRelativeRedirectResponse(targetPath: string): Response {
  return new Response(buildRelativeRedirectHtml(targetPath), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

function buildPageLoginRedirect(basePath: string, from: string): Response {
  return createRelativeRedirectResponse(
    `${basePath || ''}/login?from=${encodeURIComponent(sanitizeAuthRedirectTarget(from))}`,
  );
}

function buildLoginSuccessRedirect(basePath: string, target: string): Response {
  const parsed = new URL(`http://localhost${target}`);
  const pathname = parsed.pathname === '/' ? '/' : parsed.pathname;
  const prefixedPath = basePath
    ? `${basePath}${pathname === '/' ? '' : pathname}`
    : pathname;

  return createRelativeRedirectResponse(
    `${prefixedPath || '/'}${parsed.search}`,
  );
}

function buildApiUnauthorizedResponse(from: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      message: 'Unauthorized',
      redirectTo: buildRelativeLoginPath(from),
    },
    { status: 401 },
  );
}

function currentAppPath(request: NextRequest, basePath: string): string {
  const pathname = stripBasePath(request.nextUrl.pathname, basePath);
  return sanitizeAuthRedirectTarget(`${pathname}${request.nextUrl.search}`);
}

function resolveClientIp(request: NextRequest): string | null {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  const requestIp = (request as NextRequest & { ip?: string }).ip;
  return requestIp?.trim() || null;
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isNextInternalPath(pathname: string): boolean {
  return (
    pathname === '/favicon.ico' ||
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/_next/image')
  );
}

function buildInternalRewrite(request: NextRequest, targetPath: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = targetPath;
  return NextResponse.rewrite(url);
}

function isPublicRequest(pathname: string, request: NextRequest): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname) || PUBLIC_API_PATHS.has(pathname)) {
    return true;
  }

  if (pathname === '/api/health') {
    return isTrustedLocalAddress(resolveClientIp(request));
  }

  return false;
}

function proxyHandler(request: NextRequest): Response {
  const basePath = deriveBasePath(request.nextUrl.pathname);
  const relativePath = stripBasePath(request.nextUrl.pathname, basePath);
  const currentPath = currentAppPath(request, basePath);
  const token = request.cookies.get(MONITOR_AUTH_COOKIE_NAME)?.value;
  const hasSession = hasValidMonitorSessionToken(token);
  const shouldRewrite = Boolean(basePath) && relativePath !== request.nextUrl.pathname;

  if (isNextInternalPath(relativePath)) {
    return shouldRewrite ? buildInternalRewrite(request, relativePath) : NextResponse.next();
  }

  if (isPublicRequest(relativePath, request)) {
    if (relativePath === '/login' && hasSession) {
      const target = sanitizeAuthRedirectTarget(request.nextUrl.searchParams.get('from'));
      return buildLoginSuccessRedirect(basePath, target);
    }
    return shouldRewrite ? buildInternalRewrite(request, relativePath) : NextResponse.next();
  }

  if (hasSession) {
    return shouldRewrite ? buildInternalRewrite(request, relativePath) : NextResponse.next();
  }

  if (isApiPath(relativePath)) {
    return buildApiUnauthorizedResponse(currentPath);
  }

  return buildPageLoginRedirect(basePath, currentPath);
}

export default proxyHandler;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
