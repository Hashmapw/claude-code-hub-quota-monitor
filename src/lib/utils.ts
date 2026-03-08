import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function resolveDefaultVendorType(
  vendorTypes: string[] | undefined,
  vendorDefinitions: Array<{ vendorType: string }> | undefined,
  preferred?: string | null,
): string {
  const preferredValue = (preferred || '').trim();
  if (preferredValue) {
    return preferredValue;
  }

  if (Array.isArray(vendorTypes)) {
    for (const vendorType of vendorTypes) {
      const candidate = (vendorType || '').trim();
      if (candidate) {
        return candidate;
      }
    }
  }

  if (Array.isArray(vendorDefinitions)) {
    for (const definition of vendorDefinitions) {
      const candidate = (definition.vendorType || '').trim();
      if (candidate) {
        return candidate;
      }
    }
  }

  return '';
}
