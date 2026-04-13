/**
 * Persistent File Logger — writes structured logs to disk for post-mortem debugging.
 *
 * Server-side only — do not import from React components.
 *
 * Log files are stored in:
 *   - Production: app.getPath('userData')/logs/ (passed via CLAUDE_GUI_LOG_DIR)
 *   - Dev: ~/.codepilot/logs/
 *
 * Uses separate files per prefix to avoid cross-process write conflicts.
 * Rotation: max 5 files × 10MB each per prefix.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface FileLoggerState {
  logDir: string;
  maxFileSize: number;
  maxFiles: number;
  prefix: string;
  initialized: boolean;
}

const GLOBAL_KEY = '__codepilot_file_logger__' as const;

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_FILES = 5;

// Pre-compute home dir regex pattern for scrubbing
const homeDirPattern = process.env.HOME
  ? process.env.HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  : '/home/[^/\\s]+';

function scrubSensitive(msg: string): string {
  return msg
    .replace(/\b(sk-[a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]+/g, '$1***')
    .replace(/\b(anthropic-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/g, '$1***')
    .replace(/\b(key-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/g, '$1***')
    .replace(/(Bearer\s+)[a-zA-Z0-9_.-]{12,}/gi, '$1***')
    .replace(/\b[a-f0-9]{32,}\b/gi, (m) => m.slice(0, 8) + '***')
    .replace(new RegExp(homeDirPattern, 'g'), '~');
}

function resolveLogDir(): string {
  return process.env.CLAUDE_GUI_LOG_DIR
    || path.join(process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot'), 'logs');
}

function getState(): FileLoggerState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      logDir: resolveLogDir(),
      maxFileSize: DEFAULT_MAX_FILE_SIZE,
      maxFiles: DEFAULT_MAX_FILES,
      prefix: 'server',
      initialized: false,
    } satisfies FileLoggerState;
  }
  return g[GLOBAL_KEY] as FileLoggerState;
}

export interface FileLoggerOptions {
  logDir?: string;
  maxFileSize?: number;
  maxFiles?: number;
  prefix?: string;
}

/**
 * Initialize the file logger. Call once at startup.
 * Safe to call multiple times — later calls update options.
 */
export function initFileLogger(options?: FileLoggerOptions): void {
  const state = getState();
  if (options?.logDir) state.logDir = options.logDir;
  if (options?.maxFileSize) state.maxFileSize = options.maxFileSize;
  if (options?.maxFiles) state.maxFiles = options.maxFiles;
  if (options?.prefix) state.prefix = options.prefix;
  state.initialized = true;

  try {
    fs.mkdirSync(state.logDir, { recursive: true });
  } catch {
    // Best-effort — if we can't create the dir, logging will silently fail
  }
}

function getLogFilePath(state: FileLoggerState, index?: number): string {
  const name = index ? `${state.prefix}.${index}.log` : `${state.prefix}.log`;
  return path.join(state.logDir, name);
}

function rotateIfNeeded(state: FileLoggerState): void {
  const currentFile = getLogFilePath(state);
  try {
    const stat = fs.statSync(currentFile);
    if (stat.size < state.maxFileSize) return;
  } catch {
    return; // File doesn't exist yet
  }

  // Rotate: delete oldest, shift others
  const oldest = getLogFilePath(state, state.maxFiles);
  try { fs.unlinkSync(oldest); } catch { /* ignore */ }

  for (let i = state.maxFiles - 1; i >= 1; i--) {
    const from = getLogFilePath(state, i);
    const to = getLogFilePath(state, i + 1);
    try { fs.renameSync(from, to); } catch { /* ignore */ }
  }

  // Rotate current → .1
  try { fs.renameSync(currentFile, getLogFilePath(state, 1)); } catch { /* ignore */ }
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra) return '';
  try {
    const serialized = JSON.stringify(extra, (_key, value) => {
      if (typeof value === 'string' && value.length > 2000) {
        return value.slice(0, 2000) + '...[truncated]';
      }
      return value;
    });
    return ' | ' + serialized;
  } catch {
    return ' | [unserializable]';
  }
}

/**
 * Write a log entry to disk.
 */
export function log(level: LogLevel, tag: string, message: string, extra?: Record<string, unknown>): void {
  const state = getState();

  // Auto-initialize on first use if not explicitly initialized
  if (!state.initialized) {
    initFileLogger();
  }

  try {
    rotateIfNeeded(state);

    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const scrubbed = scrubSensitive(message);
    const extraStr = extra ? formatExtra(extra) : '';
    const line = `${timestamp} [${levelStr}] [${tag}] ${scrubbed}${extraStr}\n`;

    fs.appendFileSync(getLogFilePath(state), line);
  } catch {
    // Logging must never throw — silently fail
  }
}

export function logDebug(tag: string, message: string, extra?: Record<string, unknown>): void {
  log('debug', tag, message, extra);
}

export function logInfo(tag: string, message: string, extra?: Record<string, unknown>): void {
  log('info', tag, message, extra);
}

export function logWarn(tag: string, message: string, extra?: Record<string, unknown>): void {
  log('warn', tag, message, extra);
}

export function logError(tag: string, message: string, extra?: Record<string, unknown>): void {
  log('error', tag, message, extra);
}

/**
 * Get the current log directory path (for display in settings/diagnostics).
 */
export function getLogDir(): string {
  return getState().logDir;
}
