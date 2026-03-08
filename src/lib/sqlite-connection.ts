import 'server-only';

import { copyFileSync, existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabasePath } from '@/lib/db-path';

let sharedConnection: DatabaseSync | null = null;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function hasCorruptionErrorCode(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.toLowerCase().includes('corrupt');
}

function isSqliteCorruptionError(error: unknown): boolean {
  if (hasCorruptionErrorCode(error)) {
    return true;
  }
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes('database disk image is malformed') ||
    message.includes('sqlite_corrupt') ||
    message.includes('database corrupt') ||
    message.includes('quick_check failed') ||
    message.includes('malformed')
  );
}

function formatRecoveryTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function resolveUniquePath(path: string): string {
  if (!existsSync(path)) {
    return path;
  }
  let index = 1;
  while (existsSync(`${path}.${index}`)) {
    index += 1;
  }
  return `${path}.${index}`;
}

function moveFileIfExists(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }
  renameSync(sourcePath, resolveUniquePath(destinationPath));
}

function closeSharedConnection(): void {
  if (!sharedConnection) {
    return;
  }
  try {
    sharedConnection.close();
  } catch {
    // noop
  } finally {
    sharedConnection = null;
  }
}

function openConfiguredConnection(dbPath: string): DatabaseSync {
  const connection = new DatabaseSync(dbPath, { timeout: 5000 });
  connection.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
  `);
  return connection;
}

function assertConnectionHealthy(connection: DatabaseSync): void {
  const rows = connection.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
  const issues = rows
    .map((row) => String(Object.values(row)[0] ?? ''))
    .filter((value) => value && value.toLowerCase() !== 'ok');
  if (issues.length > 0) {
    throw new Error(`SQLite quick_check failed: ${issues[0]}`);
  }
}

function pickNewestBackupPath(dbPath: string): string | null {
  const parent = dirname(dbPath);
  const base = basename(dbPath);
  const prefix = `${base}.bak`;
  const candidates = readdirSync(parent)
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const fullPath = `${parent}/${name}`;
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(fullPath).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { fullPath, mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.fullPath ?? null;
}

function recoverCorruptedDatabase(dbPath: string, rootError: unknown): DatabaseSync {
  const timestamp = formatRecoveryTimestamp();
  const rootMessage = extractErrorMessage(rootError);
  console.error(`[sqlite] 检测到数据库损坏，开始自动恢复: ${rootMessage}`);

  moveFileIfExists(`${dbPath}-wal`, `${dbPath}-wal.corrupt-${timestamp}`);
  moveFileIfExists(`${dbPath}-shm`, `${dbPath}-shm.corrupt-${timestamp}`);

  try {
    const retriedConnection = openConfiguredConnection(dbPath);
    assertConnectionHealthy(retriedConnection);
    console.warn('[sqlite] 已通过清理 WAL/SHM 自动恢复数据库连接');
    return retriedConnection;
  } catch (errorAfterWalCleanup) {
    const retryMessage = extractErrorMessage(errorAfterWalCleanup);
    console.error(`[sqlite] 清理 WAL/SHM 后仍失败: ${retryMessage}`);
  }

  moveFileIfExists(dbPath, `${dbPath}.corrupt-${timestamp}`);
  const backupPath = pickNewestBackupPath(dbPath);
  if (backupPath) {
    copyFileSync(backupPath, dbPath);
    console.warn(`[sqlite] 已从备份恢复数据库: ${backupPath}`);
  } else {
    console.warn('[sqlite] 未找到可用备份，将重建空数据库');
  }

  try {
    const recoveredConnection = openConfiguredConnection(dbPath);
    assertConnectionHealthy(recoveredConnection);
    return recoveredConnection;
  } catch (recoveryError) {
    const recoveryMessage = extractErrorMessage(recoveryError);
    console.error(`[sqlite] 备份恢复失败，重建新数据库: ${recoveryMessage}`);
    moveFileIfExists(dbPath, `${dbPath}.corrupt-${timestamp}.recovery-failed`);
    const freshConnection = openConfiguredConnection(dbPath);
    assertConnectionHealthy(freshConnection);
    return freshConnection;
  }
}

export function getSqliteConnection(): DatabaseSync {
  if (sharedConnection) {
    try {
      sharedConnection.prepare('SELECT 1').get();
      return sharedConnection;
    } catch (error) {
      if (!isSqliteCorruptionError(error)) {
        throw error;
      }
      const dbPath = getDatabasePath();
      closeSharedConnection();
      sharedConnection = recoverCorruptedDatabase(dbPath, error);
      return sharedConnection;
    }
  }

  const dbPath = getDatabasePath();
  try {
    sharedConnection = openConfiguredConnection(dbPath);
    assertConnectionHealthy(sharedConnection);
  } catch (error) {
    if (!isSqliteCorruptionError(error)) {
      throw error;
    }
    closeSharedConnection();
    sharedConnection = recoverCorruptedDatabase(dbPath, error);
  }

  return sharedConnection;
}
