'use client';

import { useEffect, useRef } from 'react';
import { getBasePath, withBasePath } from '@/lib/client/base-path';
import { sanitizeAuthRedirectTarget } from '@/lib/monitor-auth-shared';

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) {
    return pathname || '/';
  }
  if (pathname === basePath) {
    return '/';
  }
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || '/';
  }
  return pathname || '/';
}

function buildLoginRedirectFromCurrentLocation(): string {
  const basePath = getBasePath();
  const pathname = stripBasePath(window.location.pathname, basePath);
  const from = sanitizeAuthRedirectTarget(`${pathname}${window.location.search}`);
  return `/login?from=${encodeURIComponent(from)}`;
}

export function AuthResponseInterceptor() {
  const redirectingRef = useRef(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      if (response.status === 401 && !redirectingRef.current) {
        let redirectTo = buildLoginRedirectFromCurrentLocation();

        try {
          const body = (await response.clone().json()) as { redirectTo?: unknown };
          if (typeof body.redirectTo === 'string') {
            redirectTo = sanitizeAuthRedirectTarget(body.redirectTo);
          }
        } catch {
          // Ignore invalid JSON bodies.
        }

        redirectingRef.current = true;
        window.location.assign(withBasePath(redirectTo));
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
