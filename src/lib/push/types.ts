export const PUSH_PROVIDER_TYPES = [
  "wechat",
  "feishu",
  "dingtalk",
  "telegram",
  "custom",
] as const;
export type PushProviderType = (typeof PUSH_PROVIDER_TYPES)[number];

export const PUSH_TASK_TYPES = [
  "daily_checkin_summary",
  "daily_checkin_balance_refresh",
  "daily_checkin_balance_refresh_anomaly",
] as const;
export type PushTaskType = (typeof PUSH_TASK_TYPES)[number];
export type PushTestTemplateType = PushTaskType | "push_test";

export const SETTING_KEY_PUSH_TARGETS = "push_targets";
export const SETTING_KEY_PUSH_TASKS = "push_tasks";

export type PushTargetTestResult = {
  success: boolean;
  error?: string;
  latencyMs?: number;
};

export type PushTarget = {
  id: string;
  name: string;
  providerType: PushProviderType;
  webhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  dingtalkSecret: string | null;
  customHeaders: Record<string, string> | null;
  customTemplate: Record<string, unknown> | null;
  isEnabled: boolean;
  lastTestAt: string | null;
  lastTestResult: PushTargetTestResult | null;
  createdAt: string;
  updatedAt: string;
};

export type PushTaskConfig = {
  taskType: PushTaskType;
  enabled: boolean;
  targetIds: string[];
};

export const PUSH_DELIVERY_SOURCES = ["task", "test"] as const;
export type PushDeliverySource = (typeof PUSH_DELIVERY_SOURCES)[number];

export type PushMessageLevel = "info" | "warning" | "error";

export type PushStructuredMessage = {
  header: {
    title: string;
    icon?: string | null;
    level: PushMessageLevel;
  };
  summary?: string | null;
  sections: Array<{
    title?: string | null;
    content: Array<
      | { type: "text"; value: string }
      | { type: "quote"; value: string }
      | { type: "fields"; items: Array<{ label: string; value: string }> }
      | {
          type: "table";
          columns: [string, string];
          rows: Array<{ left: string; right: string }>;
        }
      | {
          type: "list";
          items: Array<{
            primary: string;
            secondary?: string | null;
            icon?: string | null;
          }>;
        }
      | { type: "divider" }
    >;
  }>;
  footer?: Array<{
    title?: string | null;
    content: Array<
      | { type: "text"; value: string }
      | { type: "quote"; value: string }
      | { type: "fields"; items: Array<{ label: string; value: string }> }
      | {
          type: "table";
          columns: [string, string];
          rows: Array<{ left: string; right: string }>;
        }
      | {
          type: "list";
          items: Array<{
            primary: string;
            secondary?: string | null;
            icon?: string | null;
          }>;
        }
      | { type: "divider" }
    >;
  }> | null;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

export type PushDeliveryRecord = {
  id: string;
  source: PushDeliverySource;
  templateType: PushTestTemplateType;
  taskType: PushTaskType | null;
  targetId: string;
  targetName: string;
  targetProviderType: PushProviderType;
  success: boolean;
  error: string | null;
  latencyMs: number | null;
  message: PushStructuredMessage;
  sentAt: string;
};

const PUSH_PROVIDER_TYPE_SET = new Set<string>(PUSH_PROVIDER_TYPES);
const PUSH_TASK_TYPE_SET = new Set<string>(PUSH_TASK_TYPES);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    const normalized = normalizeText(item);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return Array.from(deduped);
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
  if (!isObject(value)) {
    return null;
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(raw);
    if (normalizedKey && normalizedValue) {
      result[normalizedKey] = normalizedValue;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function normalizeTemplate(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) {
    return null;
  }
  return value;
}

function normalizeTestResult(value: unknown): PushTargetTestResult | null {
  if (!isObject(value)) {
    return null;
  }

  return {
    success: value.success === true,
    ...(normalizeText(value.error)
      ? { error: normalizeText(value.error) ?? undefined }
      : {}),
    ...(typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs)
      ? { latencyMs: Math.max(0, Math.round(value.latencyMs)) }
      : {}),
  };
}

export function createDefaultPushTaskConfigs(): PushTaskConfig[] {
  return PUSH_TASK_TYPES.map((taskType) => ({
    taskType,
    enabled: false,
    targetIds: [],
  }));
}

export function normalizePushTaskConfigs(raw: unknown): PushTaskConfig[] {
  const defaults = createDefaultPushTaskConfigs();
  if (!Array.isArray(raw)) {
    return defaults;
  }

  const parsed = new Map<PushTaskType, PushTaskConfig>();
  for (const item of raw) {
    if (!isObject(item)) {
      continue;
    }

    const rawTaskType = normalizeText(item.taskType);
    if (!rawTaskType || !PUSH_TASK_TYPE_SET.has(rawTaskType)) {
      continue;
    }

    const taskType = rawTaskType as PushTaskType;
    parsed.set(taskType, {
      taskType,
      enabled: normalizeBoolean(item.enabled, false),
      targetIds: normalizeStringArray(item.targetIds),
    });
  }

  return defaults.map((item) => parsed.get(item.taskType) ?? item);
}

export function normalizePushTargets(raw: unknown): PushTarget[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const list: PushTarget[] = [];
  for (const item of raw) {
    if (!isObject(item)) {
      continue;
    }

    const id = normalizeText(item.id);
    const name = normalizeText(item.name);
    const providerType = normalizeText(item.providerType);
    const createdAt = normalizeText(item.createdAt);
    const updatedAt = normalizeText(item.updatedAt);

    if (
      !id ||
      !name ||
      !providerType ||
      !PUSH_PROVIDER_TYPE_SET.has(providerType) ||
      !createdAt ||
      !updatedAt
    ) {
      continue;
    }

    list.push({
      id,
      name,
      providerType: providerType as PushProviderType,
      webhookUrl: normalizeText(item.webhookUrl),
      telegramBotToken: normalizeText(item.telegramBotToken),
      telegramChatId: normalizeText(item.telegramChatId),
      dingtalkSecret: normalizeText(item.dingtalkSecret),
      customHeaders: normalizeStringRecord(item.customHeaders),
      customTemplate: normalizeTemplate(item.customTemplate),
      isEnabled: normalizeBoolean(item.isEnabled, true),
      lastTestAt: normalizeText(item.lastTestAt),
      lastTestResult: normalizeTestResult(item.lastTestResult),
      createdAt,
      updatedAt,
    });
  }

  return list.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function serializePushTaskConfigs(tasks: PushTaskConfig[]): string {
  return JSON.stringify(tasks);
}

export function serializePushTargets(targets: PushTarget[]): string {
  return JSON.stringify(targets);
}

export function getPushTaskConfig(
  tasks: PushTaskConfig[],
  taskType: PushTaskType,
): PushTaskConfig {
  return (
    tasks.find((task) => task.taskType === taskType) ?? {
      taskType,
      enabled: false,
      targetIds: [],
    }
  );
}

export function setPushTaskConfig(
  tasks: PushTaskConfig[],
  nextTask: PushTaskConfig,
): PushTaskConfig[] {
  return createDefaultPushTaskConfigs().map((task) =>
    task.taskType === nextTask.taskType
      ? {
          taskType: nextTask.taskType,
          enabled: nextTask.enabled,
          targetIds: normalizeStringArray(nextTask.targetIds),
        }
      : getPushTaskConfig(tasks, task.taskType),
  );
}

export function getPushTaskLabel(taskType: PushTaskType): string {
  if (taskType === "daily_checkin_balance_refresh_anomaly") {
    return "服务商已用消耗异常提醒";
  }
  if (taskType === "daily_checkin_balance_refresh") {
    return "签到后刷新余额推送";
  }
  return "签到简报推送";
}

export function getPushProviderLabel(providerType: PushProviderType): string {
  switch (providerType) {
    case "wechat":
      return "企业微信";
    case "feishu":
      return "飞书";
    case "dingtalk":
      return "钉钉";
    case "telegram":
      return "Telegram";
    case "custom":
      return "自定义 Webhook";
  }
}
