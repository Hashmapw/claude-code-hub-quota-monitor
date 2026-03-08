'use client';

import { useSyncExternalStore } from 'react';

export type CookieAlertItem = {
  endpointId: number;
  endpointName: string;
};

let items: CookieAlertItem[] = [];
const listeners = new Set<() => void>();
const EMPTY_ITEMS: CookieAlertItem[] = [];

function emit() {
  for (const l of listeners) l();
}

export function setCookieAlerts(next: CookieAlertItem[]) {
  items = next;
  emit();
}

export function clearCookieAlerts() {
  items = [];
  emit();
}

export function useCookieAlerts(): CookieAlertItem[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => items,
    () => EMPTY_ITEMS,
  );
}
