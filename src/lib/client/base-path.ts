function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveRuntimeProxyBasePath(): string {
  const direct = process.env.VSCODE_PROXY_URI?.trim();
  const vscodeUri = process.env.VSCODE_URI?.trim();
  const rawValue = direct || vscodeUri;
  if (!rawValue) {
    return '';
  }

  const port = process.env.PORT || '3010';
  const normalizedValue = rawValue.includes('{{port}}')
    ? rawValue.replace('{{port}}', port)
    : rawValue.includes('/proxy/')
      ? rawValue
      : `${trimTrailingSlash(rawValue)}/proxy/${port}`;

  return cleanBasePath(normalizedValue);
}

function toPathname(value: string): string {
  if (!value) {
    return '';
  }

  try {
    if (typeof window !== 'undefined') {
      return new URL(value, window.location.origin).pathname || '';
    }
    return new URL(value).pathname || '';
  } catch {
    return value;
  }
}

function cleanBasePath(basePath: string): string {
  if (!basePath) {
    return '';
  }

  let cleaned = toPathname(basePath);
  if (!cleaned) {
    return '';
  }

  const markerIdx = cleaned.indexOf('/_next/');
  if (markerIdx >= 0) {
    cleaned = cleaned.substring(0, markerIdx);
  }

  const markers = ['/api', '/favicon.ico'];
  for (const marker of markers) {
    const idx = cleaned.indexOf(marker);
    if (idx >= 0) {
      cleaned = cleaned.substring(0, idx);
      break;
    }
  }

  return trimTrailingSlash(cleaned);
}

function deriveFromLocationPath(path: string): string {
  const proxyIdx = path.indexOf('/proxy/');
  if (proxyIdx >= 0) {
    const afterProxy = path.substring(proxyIdx + '/proxy/'.length);
    const slashIdx = afterProxy.indexOf('/');
    const portSeg = slashIdx >= 0 ? afterProxy.substring(0, slashIdx) : afterProxy;
    if (/^\d+$/.test(portSeg)) {
      return cleanBasePath(path.substring(0, proxyIdx + '/proxy/'.length + portSeg.length));
    }
  }

  const apiIdx = path.indexOf('/api/');
  if (apiIdx > 0) {
    return cleanBasePath(path.substring(0, apiIdx));
  }

  return '';
}

export function deriveBasePathFromPathname(pathname: string): string {
  return deriveFromLocationPath(pathname);
}

function deriveFromRuntimeAssets(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const envBasePath = cleanBasePath(process.env.NEXT_PUBLIC_BASE_PATH || '');
  if (envBasePath) {
    return envBasePath;
  }

  const nextData = (window as Window & { __NEXT_DATA__?: { assetPrefix?: string } }).__NEXT_DATA__;
  const nextDataBasePath = cleanBasePath(nextData?.assetPrefix || '');
  if (nextDataBasePath) {
    return nextDataBasePath;
  }

  const candidates: string[] = [];
  const scriptNodes = document.querySelectorAll('script[src]');
  for (const node of scriptNodes) {
    const src = node.getAttribute('src') || '';
    if (src.includes('/_next/')) {
      candidates.push(src);
    }
  }

  const linkNodes = document.querySelectorAll('link[href]');
  for (const node of linkNodes) {
    const href = node.getAttribute('href') || '';
    if (href.includes('/_next/')) {
      candidates.push(href);
    }
  }

  for (const candidate of candidates) {
    const basePath = cleanBasePath(candidate);
    if (basePath) {
      return basePath;
    }
  }

  return '';
}

export function getBasePath(): string {
  if (typeof window === 'undefined') {
    const runtimeProxyBasePath = resolveRuntimeProxyBasePath();
    if (runtimeProxyBasePath) {
      return runtimeProxyBasePath;
    }

    return cleanBasePath(process.env.NEXT_PUBLIC_BASE_PATH || '');
  }

  const locationBasePath = deriveFromLocationPath(window.location.pathname);
  if (locationBasePath) {
    return locationBasePath;
  }

  return deriveFromRuntimeAssets();
}

export function withBasePath(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }

  const basePath = getBasePath();
  if (!basePath) {
    return path;
  }

  if (path === basePath || path.startsWith(`${basePath}/`)) {
    return path;
  }

  return `${basePath}${path}`;
}
