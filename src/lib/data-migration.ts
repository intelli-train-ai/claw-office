import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * One-shot migration of legacy CodePilot data to SafeClaw paths.
 *
 * v0.47.0 与之前的版本以 CodePilot 品牌存储数据，本模块负责把老用户的数据
 * 平滑迁移到新品牌路径。所有函数都是幂等且尽量不抛出（迁移失败只记录警告，
 * 不阻塞应用启动）。
 *
 * 调用时机：
 *   - migrateLegacyDataDir / migrateLegacyDbFile：进程启动尽早期、读取数据前
 *     （Electron 主进程在 Sentry init 前；Next.js 服务端在 db 初始化前）
 *   - migrateLegacyDbColumns：DB 打开后、CREATE TABLE 之后、应用查询之前
 */

/**
 * Rename `~/.codepilot/` → `~/.safeclaw/` if old exists and new does not.
 * Idempotent. If both exist, leaves them alone (avoids clobbering user data).
 */
export function migrateLegacyDataDir(): void {
  const home = os.homedir();
  const oldDir = path.join(home, '.codepilot');
  const newDir = path.join(home, '.safeclaw');

  if (fs.existsSync(newDir)) return;
  if (!fs.existsSync(oldDir)) return;

  try {
    fs.renameSync(oldDir, newDir);
    console.log(`[migration] data dir: ${oldDir} → ${newDir}`);
  } catch (err) {
    console.warn(`[migration] data dir rename failed:`, err);
  }
}

/**
 * Within `dataDir`, rename `codepilot.db` → `safeclaw.db` (and WAL/SHM
 * journal siblings). Idempotent. Skips if target already exists.
 */
export function migrateLegacyDbFile(dataDir: string, newDbName: string = 'safeclaw.db'): void {
  const newPath = path.join(dataDir, newDbName);
  const oldPath = path.join(dataDir, 'codepilot.db');
  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return;

  try {
    fs.renameSync(oldPath, newPath);
    for (const ext of ['-wal', '-shm']) {
      const oldF = oldPath + ext;
      const newF = newPath + ext;
      if (fs.existsSync(oldF)) fs.renameSync(oldF, newF);
    }
    console.log(`[migration] db file: ${oldPath} → ${newPath}`);
  } catch (err) {
    console.warn(`[migration] db file rename failed:`, err);
  }
}

/**
 * Rename `codepilot_session_id` → `safeclaw_session_id` in
 * channel_bindings + channel_outbound_refs. SQLite ALTER TABLE RENAME COLUMN
 * automatically updates indexes and foreign keys that reference the column.
 *
 * Skips when the legacy column doesn't exist or the new column already does.
 */
export function migrateLegacyDbColumns(db: Database.Database): void {
  const tables = ['channel_bindings', 'channel_outbound_refs'];
  for (const table of tables) {
    try {
      const tblExists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      if (!tblExists) continue;

      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      const hasLegacy = cols.some((c) => c.name === 'codepilot_session_id');
      const hasNew = cols.some((c) => c.name === 'safeclaw_session_id');
      if (!hasLegacy || hasNew) continue;

      db.exec(`ALTER TABLE ${table} RENAME COLUMN codepilot_session_id TO safeclaw_session_id`);
      console.log(`[migration] db column: ${table}.codepilot_session_id → safeclaw_session_id`);
    } catch (err) {
      console.warn(`[migration] db column rename on ${table} failed:`, err);
    }
  }
}
