import 'server-only';

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function resolvePreferredDatabasePath(): string {
  const cwd = process.cwd();

  const localRootLooksLikeProject =
    existsSync(resolve(cwd, 'next.config.ts')) && existsSync(resolve(cwd, 'src', 'app'));
  if (localRootLooksLikeProject) {
    return resolve(cwd, 'data', 'provider-settings.sqlite');
  }

  const envRoot = process.env.MONITOR_PROJECT_ROOT?.trim();
  if (envRoot) {
    return resolve(envRoot, 'data', 'provider-settings.sqlite');
  }

  const nestedRoot = resolve(cwd, 'Utils', 'claude-code-quota-monitor');
  if (existsSync(resolve(nestedRoot, 'next.config.ts'))) {
    return resolve(nestedRoot, 'data', 'provider-settings.sqlite');
  }

  const siblingRoot = resolve(cwd, '..', 'claude-code-quota-monitor');
  if (existsSync(resolve(siblingRoot, 'next.config.ts'))) {
    return resolve(siblingRoot, 'data', 'provider-settings.sqlite');
  }

  return resolve(cwd, 'data', 'provider-settings.sqlite');
}

function resolveDefaultDatabasePath(): string {
  const preferred = resolvePreferredDatabasePath();
  if (existsSync(preferred)) {
    return preferred;
  }

  const cwd = process.cwd();
  const legacyCandidates = [
    resolve(cwd, 'data', 'provider-settings.sqlite'),
    resolve(cwd, 'Utils', 'claude-code-quota-monitor', 'data', 'provider-settings.sqlite'),
    resolve(cwd, '..', 'claude-code-quota-monitor', 'data', 'provider-settings.sqlite'),
  ].filter((value) => value !== preferred);

  const legacyExisting = legacyCandidates.find((candidate) => existsSync(candidate));
  return legacyExisting ?? preferred;
}

export function getDatabasePath(): string {
  const fromEnv = process.env.MONITOR_SETTINGS_DB_PATH?.trim();
  const filePath = fromEnv ? resolve(fromEnv) : resolveDefaultDatabasePath();

  const parentDir = dirname(filePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  return filePath;
}
