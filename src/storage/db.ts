/**
 * SQLite database wrapper for posts and tokens
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import type { ScheduledJob, TokenData } from '../platforms/types.js';

const DB_DIR = process.env.RELAY_DIR || join(process.env.HOME || '~', '.claude-relay');
const DB_PATH = join(DB_DIR, 'social-media-agent.db');

// Ensure database directory exists
import { mkdirSync } from 'fs';
try {
  mkdirSync(DB_DIR, { recursive: true });
} catch {
  // Directory may already exist
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// ============================================================================
// SCHEMA SETUP
// ============================================================================

// Posts table for scheduled and completed posts
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    scheduled_at TIMESTAMP,
    content_json TEXT NOT NULL,
    file_path TEXT,
    result_json TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Tokens table for OAuth credentials
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    platform TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create indexes for common queries
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform)`);

// ============================================================================
// POSTS CRUD OPERATIONS
// ============================================================================

export function addPost(
  platform: string,
  action: string,
  contentJson: string,
  scheduledAt?: Date,
  filePath?: string
): number {
  const stmt = db.prepare(`
    INSERT INTO posts (platform, action, status, scheduled_at, content_json, file_path)
    VALUES (?, ?, 'pending', ?, ?, ?)
  `);
  const result = stmt.run(
    platform,
    action,
    scheduledAt ? scheduledAt.toISOString() : null,
    contentJson,
    filePath || null
  );
  return Number(result.lastInsertRowid);
}

export function getPendingJobs(): ScheduledJob[] {
  const stmt = db.prepare(`
    SELECT * FROM posts
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= datetime('now'))
      AND retry_count < 3
    ORDER BY scheduled_at ASC, created_at ASC
  `);
  return stmt.all().map(rowToJob);
}

export function getJobById(id: number): ScheduledJob | null {
  const stmt = db.prepare('SELECT * FROM posts WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function listJobs(options?: {
  status?: 'pending' | 'completed' | 'failed';
  platform?: string;
  limit?: number;
}): ScheduledJob[] {
  let query = 'SELECT * FROM posts WHERE 1=1';
  const params: (string | number)[] = [];

  if (options?.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  if (options?.platform) {
    query += ' AND platform = ?';
    params.push(options.platform);
  }

  query += ' ORDER BY created_at DESC';

  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  const stmt = db.prepare(query);
  return stmt.all(...params).map(rowToJob);
}

export function markComplete(id: number, resultJson: string): void {
  const stmt = db.prepare(`
    UPDATE posts
    SET status = 'completed', result_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(resultJson, id);
}

export function markFailed(id: number, errorMessage: string): void {
  const stmt = db.prepare(`
    UPDATE posts
    SET status = 'failed', error_message = ?, retry_count = retry_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(errorMessage, id);
}

export function cancelJob(id: number): boolean {
  const stmt = db.prepare(`
    UPDATE posts
    SET status = 'failed', error_message = 'Cancelled by user', updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function retryJob(id: number): boolean {
  const stmt = db.prepare(`
    UPDATE posts
    SET status = 'pending', error_message = NULL, updated_at = datetime('now')
    WHERE id = ? AND status = 'failed'
  `);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function deleteOldPosts(days: number): number {
  const stmt = db.prepare(`
    DELETE FROM posts
    WHERE created_at < datetime('now', '-${days} days')
      AND status IN ('completed', 'failed')
  `);
  const result = stmt.run();
  return Number(result.changes);
}

// ============================================================================
// TOKEN CRUD OPERATIONS
// ============================================================================

export function saveToken(data: TokenData): void {
  const stmt = db.prepare(`
    INSERT INTO tokens (platform, access_token, refresh_token, expires_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(platform) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `);
  stmt.run(
    data.platform,
    data.accessToken,
    data.refreshToken || null,
    data.expiresAt ? data.expiresAt.toISOString() : null
  );
}

export function getToken(platform: string): TokenData | null {
  const stmt = db.prepare('SELECT * FROM tokens WHERE platform = ?');
  const row = stmt.get(platform) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    platform: row.platform as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string | undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : undefined,
  };
}

export function deleteToken(platform: string): boolean {
  const stmt = db.prepare('DELETE FROM tokens WHERE platform = ?');
  const result = stmt.run(platform);
  return result.changes > 0;
}

export function listTokens(): TokenData[] {
  const stmt = db.prepare('SELECT * FROM tokens ORDER BY platform');
  return stmt.all().map((row) => ({
    platform: (row as Record<string, unknown>).platform as string,
    accessToken: (row as Record<string, unknown>).access_token as string,
    refreshToken: (row as Record<string, unknown>).refresh_token as string | undefined,
    expiresAt: (row as Record<string, unknown>).expires_at
      ? new Date((row as Record<string, unknown>).expires_at as string)
      : undefined,
    updatedAt: (row as Record<string, unknown>).updated_at
      ? new Date((row as Record<string, unknown>).updated_at as string)
      : undefined,
  }));
}

// ============================================================================
// HELPERS
// ============================================================================

function rowToJob(row: Record<string, unknown>): ScheduledJob {
  return {
    id: row.id as number,
    platform: row.platform as string,
    action: row.action as string,
    status: row.status as 'pending' | 'completed' | 'failed',
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : new Date(),
    contentJson: row.content_json as string,
    filePath: row.file_path as string | undefined,
    resultJson: row.result_json as string | undefined,
    errorMessage: row.error_message as string | undefined,
    retryCount: row.retry_count as number,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ============================================================================
// DATABASE HEALTH
// ============================================================================

export function getDbStats(): { posts: number; pending: number; tokens: number } {
  const postsCount = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
  const pendingCount = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'pending'").get() as { count: number };
  const tokensCount = db.prepare('SELECT COUNT(*) as count FROM tokens').get() as { count: number };

  return {
    posts: postsCount.count,
    pending: pendingCount.count,
    tokens: tokensCount.count,
  };
}

export function closeDb(): void {
  db.close();
}

export default db;
