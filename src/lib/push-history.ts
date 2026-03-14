import "server-only";

import { randomUUID } from "node:crypto";
import { getSqliteConnection } from "@/lib/sqlite-connection";
import type {
  PushDeliveryRecord,
  PushDeliverySource,
  PushProviderType,
  PushStructuredMessage,
  PushTaskType,
  PushTestTemplateType,
} from "@/lib/push/types";

type PushDeliveryRecordRow = {
  id: string;
  source: string;
  template_type: string;
  task_type: string | null;
  target_id: string;
  target_name: string;
  target_provider_type: string;
  success: number;
  error: string | null;
  latency_ms: number | null;
  message_json: string;
  sent_at: string;
};

type CreatePushDeliveryRecordInput = {
  source: PushDeliverySource;
  templateType: PushTestTemplateType;
  taskType: PushTaskType | null;
  targetId: string;
  targetName: string;
  targetProviderType: PushProviderType;
  success: boolean;
  error?: string | null;
  latencyMs?: number | null;
  message: PushStructuredMessage;
  sentAt?: string;
};

let initialized = false;

function ensureTable(): void {
  if (initialized) {
    return;
  }

  const conn = getSqliteConnection();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS push_delivery_records (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      template_type TEXT NOT NULL,
      task_type TEXT,
      target_id TEXT NOT NULL,
      target_name TEXT NOT NULL,
      target_provider_type TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      latency_ms INTEGER,
      message_json TEXT NOT NULL,
      sent_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_push_delivery_records_sent_at
      ON push_delivery_records (sent_at DESC);
  `);

  initialized = true;
}

function normalizeMessage(raw: string): PushStructuredMessage | null {
  try {
    return JSON.parse(raw) as PushStructuredMessage;
  } catch {
    return null;
  }
}

function mapRow(row: PushDeliveryRecordRow): PushDeliveryRecord | null {
  const message = normalizeMessage(String(row.message_json || ""));
  if (!message) {
    return null;
  }

  return {
    id: String(row.id),
    source: String(row.source) as PushDeliverySource,
    templateType: String(row.template_type) as PushTestTemplateType,
    taskType: row.task_type ? (String(row.task_type) as PushTaskType) : null,
    targetId: String(row.target_id),
    targetName: String(row.target_name),
    targetProviderType: String(row.target_provider_type) as PushProviderType,
    success: Number(row.success) === 1,
    error: row.error ? String(row.error) : null,
    latencyMs:
      row.latency_ms !== null && Number.isFinite(Number(row.latency_ms))
        ? Number(row.latency_ms)
        : null,
    message,
    sentAt: String(row.sent_at),
  };
}

export function createPushDeliveryRecord(
  input: CreatePushDeliveryRecordInput,
): PushDeliveryRecord {
  ensureTable();

  const sentAt = input.sentAt ?? new Date().toISOString();
  const id = randomUUID();
  getSqliteConnection()
    .prepare(
      `INSERT INTO push_delivery_records (
        id,
        source,
        template_type,
        task_type,
        target_id,
        target_name,
        target_provider_type,
        success,
        error,
        latency_ms,
        message_json,
        sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.source,
      input.templateType,
      input.taskType,
      input.targetId,
      input.targetName,
      input.targetProviderType,
      input.success ? 1 : 0,
      input.error ?? null,
      input.latencyMs ?? null,
      JSON.stringify(input.message),
      sentAt,
    );

  return {
    id,
    source: input.source,
    templateType: input.templateType,
    taskType: input.taskType,
    targetId: input.targetId,
    targetName: input.targetName,
    targetProviderType: input.targetProviderType,
    success: input.success,
    error: input.error ?? null,
    latencyMs: input.latencyMs ?? null,
    message: input.message,
    sentAt,
  };
}

export function listPushDeliveryRecords(limit = 50): PushDeliveryRecord[] {
  ensureTable();

  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 200) : 50;
  const rows = getSqliteConnection()
    .prepare(
      `SELECT
        id,
        source,
        template_type,
        task_type,
        target_id,
        target_name,
        target_provider_type,
        success,
        error,
        latency_ms,
        message_json,
        sent_at
      FROM push_delivery_records
      ORDER BY sent_at DESC
      LIMIT ?`,
    )
    .all(normalizedLimit) as PushDeliveryRecordRow[];

  return rows
    .map(mapRow)
    .filter((item): item is PushDeliveryRecord => item !== null);
}
