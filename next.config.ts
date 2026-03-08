import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveProxyUri(): string | null {
  const direct = process.env.VSCODE_PROXY_URI?.trim();
  if (direct) {
    return direct;
  }

  const vscodeUri = process.env.VSCODE_URI?.trim();
  if (!vscodeUri) {
    return null;
  }

  if (vscodeUri.includes('{{port}}')) {
    return vscodeUri;
  }

  const port = process.env.PORT || '3010';
  const cleaned = trimTrailingSlash(vscodeUri);
  if (cleaned.includes('/proxy/')) {
    return cleaned;
  }

  return `${cleaned}/proxy/${port}`;
}

function getAssetPrefix(): string | undefined {
  const rawProxyUri = resolveProxyUri();
  if (!rawProxyUri) {
    return undefined;
  }

  try {
    const port = process.env.PORT || '3010';
    const resolvedUri = rawProxyUri.replace('{{port}}', port);
    const url = new URL(resolvedUri);
    const path = trimTrailingSlash(url.pathname);
    return path || undefined;
  } catch {
    return undefined;
  }
}

const assetPrefix = getAssetPrefix();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  turbopack: {
    root: projectRoot,
  },
  assetPrefix,
  env: {
    NEXT_PUBLIC_BASE_PATH: assetPrefix ?? '',
  },
};

export default nextConfig;
