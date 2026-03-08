export const GROUP_COLLAPSE_STORAGE_KEY = 'quota-dashboard-collapsed-groups';
export const GROUP_COLLAPSE_COOKIE_KEY = 'quota-dashboard-collapsed-groups-v1';

export type CollapsedGroupMap = Record<string, boolean>;

function normalizeGroupName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeCollapsedGroupMap(input: unknown): CollapsedGroupMap {
  const next: CollapsedGroupMap = {};
  if (Array.isArray(input)) {
    for (const item of input) {
      const groupName = normalizeGroupName(item);
      if (!groupName) {
        continue;
      }
      next[groupName] = true;
    }
    return next;
  }
  if (!input || typeof input !== 'object') {
    return next;
  }
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const groupName = normalizeGroupName(rawKey);
    if (!groupName || typeof rawValue !== 'boolean') {
      continue;
    }
    next[groupName] = rawValue;
  }
  return next;
}

export function parseCollapsedGroupStateRaw(raw: string | null | undefined): CollapsedGroupMap {
  if (!raw) {
    return {};
  }
  try {
    return normalizeCollapsedGroupMap(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export function parseCollapsedGroupsCookie(raw: string | null | undefined): {
  groups: CollapsedGroupMap;
  hasCookieValue: boolean;
} {
  if (!raw) {
    return {
      groups: {},
      hasCookieValue: false,
    };
  }
  try {
    const decoded = decodeURIComponent(raw);
    return {
      groups: normalizeCollapsedGroupMap(JSON.parse(decoded) as unknown),
      hasCookieValue: true,
    };
  } catch {
    return {
      groups: {},
      hasCookieValue: false,
    };
  }
}

export function serializeCollapsedGroupsCookieValue(groups: CollapsedGroupMap): string {
  const collapsedGroupNames = Object.entries(groups)
    .filter(([, collapsed]) => collapsed)
    .map(([groupName]) => groupName)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return encodeURIComponent(JSON.stringify(collapsedGroupNames));
}
