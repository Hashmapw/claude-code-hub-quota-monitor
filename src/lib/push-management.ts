import "server-only";

import { randomUUID } from "node:crypto";
import { logInfo } from "@/lib/logger";
import { createPushDeliveryRecord } from "@/lib/push-history";
import { sendPushMessage } from "@/lib/push/notifier";
import {
  getPushProviderLabel,
  getPushTaskConfig,
  normalizePushTaskConfigs,
  normalizePushTargets,
  PUSH_PROVIDER_TYPES,
  serializePushTaskConfigs,
  serializePushTargets,
  setPushTaskConfig,
  SETTING_KEY_PUSH_TARGETS,
  SETTING_KEY_PUSH_TASKS,
  type PushStructuredMessage,
  type PushTarget,
  type PushTaskConfig,
  type PushTaskType,
  type PushTestTemplateType,
} from "@/lib/push/types";
import { buildPushTestMessageByTemplate } from "@/lib/push/templates";
import {
  getSystemSettingValue,
  setSystemSettingValue,
} from "@/lib/system-settings";

export type PushManagementState = {
  targets: PushTarget[];
  tasks: PushTaskConfig[];
};

export type PushTargetUpdateResult = {
  target: PushTarget;
  tasks: PushTaskConfig[];
};

export type PushTargetUpsertInput = {
  name?: unknown;
  providerType?: unknown;
  webhookUrl?: unknown;
  telegramBotToken?: unknown;
  telegramChatId?: unknown;
  dingtalkSecret?: unknown;
  customHeaders?: unknown;
  customTemplate?: unknown;
  isEnabled?: unknown;
};

export type PushTaskUpdateInput = {
  enabled?: unknown;
  targetIds?: unknown;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function parseStoredJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonObjectInput(
  value: unknown,
  fieldLabel: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${fieldLabel} 必须是合法 JSON 对象`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} 必须是 JSON 对象`);
    }
    return parsed as Record<string, unknown>;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`${fieldLabel} 必须是 JSON 对象`);
}

function parseStringRecordInput(
  value: unknown,
  fieldLabel: string,
): Record<string, string> | null {
  const parsed = parseJsonObjectInput(value, fieldLabel);
  if (!parsed) {
    return null;
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(raw);
    if (normalizedKey && normalizedValue) {
      result[normalizedKey] = normalizedValue;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function assertValidUrl(url: string, fieldLabel: string): string {
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(`${fieldLabel} 格式不正确`);
  }
}

function getPushTargets(): PushTarget[] {
  const entry = getSystemSettingValue(SETTING_KEY_PUSH_TARGETS);
  return normalizePushTargets(parseStoredJson(entry.value));
}

function getPushTasks(): PushTaskConfig[] {
  const entry = getSystemSettingValue(SETTING_KEY_PUSH_TASKS);
  return normalizePushTaskConfigs(parseStoredJson(entry.value));
}

function savePushTargets(targets: PushTarget[]): PushTarget[] {
  setSystemSettingValue(
    SETTING_KEY_PUSH_TARGETS,
    serializePushTargets(targets),
  );
  return getPushTargets();
}

function savePushTasks(tasks: PushTaskConfig[]): PushTaskConfig[] {
  setSystemSettingValue(
    SETTING_KEY_PUSH_TASKS,
    serializePushTaskConfigs(tasks),
  );
  return getPushTasks();
}

function normalizeTargetInput(
  input: PushTargetUpsertInput,
  existing?: PushTarget,
): Omit<
  PushTarget,
  "id" | "lastTestAt" | "lastTestResult" | "createdAt" | "updatedAt"
> {
  const providerType =
    normalizeText(input.providerType) ?? existing?.providerType ?? null;
  const name = normalizeText(input.name) ?? existing?.name ?? null;
  if (!providerType) {
    throw new Error("推送渠道不能为空");
  }
  if (
    !PUSH_PROVIDER_TYPES.includes(providerType as PushTarget["providerType"])
  ) {
    throw new Error("推送渠道不受支持");
  }
  if (!name) {
    throw new Error("目标名称不能为空");
  }

  const webhookUrlRaw =
    normalizeText(input.webhookUrl) ?? existing?.webhookUrl ?? null;
  const telegramBotToken =
    normalizeText(input.telegramBotToken) ?? existing?.telegramBotToken ?? null;
  const telegramChatId =
    normalizeText(input.telegramChatId) ?? existing?.telegramChatId ?? null;
  const dingtalkSecret =
    normalizeText(input.dingtalkSecret) ?? existing?.dingtalkSecret ?? null;
  const customHeaders =
    input.customHeaders !== undefined
      ? parseStringRecordInput(input.customHeaders, "自定义请求头")
      : (existing?.customHeaders ?? null);
  const customTemplate =
    input.customTemplate !== undefined
      ? parseJsonObjectInput(input.customTemplate, "自定义模板")
      : (existing?.customTemplate ?? null);
  const isEnabled =
    typeof input.isEnabled === "boolean"
      ? input.isEnabled
      : (existing?.isEnabled ?? true);

  if (providerType === "telegram") {
    if (!telegramBotToken || !telegramChatId) {
      throw new Error("Telegram 需要 Bot Token 和 Chat ID");
    }
  } else {
    if (!webhookUrlRaw) {
      throw new Error("Webhook URL 不能为空");
    }
    assertValidUrl(webhookUrlRaw, "Webhook URL");
  }

  if (providerType === "custom" && webhookUrlRaw) {
    assertValidUrl(webhookUrlRaw, "自定义 Webhook URL");
  }

  return {
    name,
    providerType: providerType as PushTarget["providerType"],
    webhookUrl: providerType === "telegram" ? null : webhookUrlRaw,
    telegramBotToken: providerType === "telegram" ? telegramBotToken : null,
    telegramChatId: providerType === "telegram" ? telegramChatId : null,
    dingtalkSecret: providerType === "dingtalk" ? dingtalkSecret : null,
    customHeaders: providerType === "custom" ? customHeaders : null,
    customTemplate: providerType === "custom" ? customTemplate : null,
    isEnabled,
  };
}

function updateStoredTestResult(
  targetId: string,
  result: PushTarget["lastTestResult"],
): PushTarget[] {
  const targets = getPushTargets().map((target) =>
    target.id === targetId
      ? {
          ...target,
          lastTestAt: new Date().toISOString(),
          lastTestResult: result,
          updatedAt: new Date().toISOString(),
        }
      : target,
  );
  return savePushTargets(targets);
}

export function getPushManagementState(): PushManagementState {
  return {
    targets: getPushTargets(),
    tasks: getPushTasks(),
  };
}

export function createPushTarget(input: PushTargetUpsertInput): PushTarget {
  const normalized = normalizeTargetInput(input);
  const now = new Date().toISOString();
  const nextTarget: PushTarget = {
    id: randomUUID(),
    ...normalized,
    lastTestAt: null,
    lastTestResult: null,
    createdAt: now,
    updatedAt: now,
  };
  const targets = savePushTargets([...getPushTargets(), nextTarget]);
  return targets.find((item) => item.id === nextTarget.id) ?? nextTarget;
}

export function updatePushTarget(
  targetId: string,
  input: PushTargetUpsertInput,
): PushTargetUpdateResult {
  const targets = getPushTargets();
  const existing = targets.find((item) => item.id === targetId);
  if (!existing) {
    throw new Error("未找到推送目标");
  }

  const normalized = normalizeTargetInput(input, existing);
  const updatedTarget: PushTarget = {
    ...existing,
    ...normalized,
    updatedAt: new Date().toISOString(),
  };

  const savedTargets = savePushTargets(
    targets.map((item) => (item.id === targetId ? updatedTarget : item)),
  );
  const savedTarget =
    savedTargets.find((item) => item.id === targetId) ?? updatedTarget;

  return {
    target: savedTarget,
    tasks: getPushTasks(),
  };
}

export function deletePushTarget(targetId: string): void {
  const targets = getPushTargets();
  if (!targets.some((item) => item.id === targetId)) {
    return;
  }

  savePushTargets(targets.filter((item) => item.id !== targetId));
  const nextTasks = getPushTasks().map((task) => ({
    ...task,
    targetIds: task.targetIds.filter((id) => id !== targetId),
  }));
  savePushTasks(nextTasks);
}

export function updatePushTask(
  taskType: PushTaskType,
  input: PushTaskUpdateInput,
): PushTaskConfig {
  const currentTask = getPushTaskConfig(getPushTasks(), taskType);
  const targets = getPushTargets();
  const validTargetIds = new Set(targets.map((target) => target.id));

  const nextTargetIds = Array.isArray(input.targetIds)
    ? Array.from(
        new Set(
          input.targetIds
            .map((item) => normalizeText(item))
            .filter(
              (item): item is string =>
                Boolean(item) && validTargetIds.has(item!),
            ),
        ),
      )
    : currentTask.targetIds;

  const nextTask: PushTaskConfig = {
    taskType,
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : currentTask.enabled,
    targetIds: nextTargetIds,
  };
  const tasks = savePushTasks(setPushTaskConfig(getPushTasks(), nextTask));
  return getPushTaskConfig(tasks, taskType);
}

export async function testPushTarget(
  targetId: string,
  templateType: PushTestTemplateType = "push_test",
): Promise<{
  target: PushTarget;
  result: NonNullable<PushTarget["lastTestResult"]>;
}> {
  const target = getPushTargets().find((item) => item.id === targetId);
  if (!target) {
    throw new Error("未找到推送目标");
  }

  const message = buildPushTestMessageByTemplate(
    templateType,
    target.name,
    getPushProviderLabel(target.providerType),
  );
  const result = await sendPushMessage(target, message);
  createPushDeliveryRecord({
    source: "test",
    templateType,
    taskType: templateType === "push_test" ? null : templateType,
    targetId: target.id,
    targetName: target.name,
    targetProviderType: target.providerType,
    success: result.success,
    error: result.error ?? null,
    latencyMs: result.latencyMs ?? null,
    message,
  });
  const targets = updateStoredTestResult(targetId, result);
  const nextTarget = targets.find((item) => item.id === targetId) ?? {
    ...target,
    lastTestAt: new Date().toISOString(),
    lastTestResult: result,
  };

  return {
    target: nextTarget,
    result,
  };
}

export function getEnabledPushTargetsForTask(
  taskType: PushTaskType,
): PushTarget[] {
  const state = getPushManagementState();
  const task = getPushTaskConfig(state.tasks, taskType);
  if (!task.enabled) {
    return [];
  }

  const targetIdSet = new Set(task.targetIds);
  return state.targets.filter(
    (target) => target.isEnabled && targetIdSet.has(target.id),
  );
}

export async function dispatchPushTaskMessage(
  taskType: PushTaskType,
  message: PushStructuredMessage,
): Promise<{
  attempted: number;
  success: number;
  failed: number;
  failures: string[];
}> {
  const targets = getEnabledPushTargetsForTask(taskType);
  if (targets.length === 0) {
    logInfo("push.task", {
      event: "skipped",
      taskType,
      reason: "no_enabled_targets",
    });
    return {
      attempted: 0,
      success: 0,
      failed: 0,
      failures: [],
    };
  }

  let success = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const target of targets) {
    const result = await sendPushMessage(target, message);
    createPushDeliveryRecord({
      source: "task",
      templateType: taskType,
      taskType,
      targetId: target.id,
      targetName: target.name,
      targetProviderType: target.providerType,
      success: result.success,
      error: result.error ?? null,
      latencyMs: result.latencyMs ?? null,
      message,
    });
    if (result.success) {
      success += 1;
      continue;
    }
    failed += 1;
    failures.push(`${target.name}: ${result.error || "unknown error"}`);
  }

  logInfo("push.task", {
    event: "done",
    taskType,
    attempted: targets.length,
    success,
    failed,
  });

  return {
    attempted: targets.length,
    success,
    failed,
    failures,
  };
}
