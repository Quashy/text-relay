import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 1000');
  db.pragma('synchronous = FULL');
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`,
  );
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=1').get())
    db.transaction(() => {
      db.exec(`CREATE TABLE shares (
      id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 102400),
      code TEXT COLLATE BINARY NOT NULL UNIQUE CHECK(length(code)=4 AND code NOT GLOB '*[^A-Za-z0-9]*'),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
    );
    CREATE TABLE admin(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    INSERT INTO schema_migrations VALUES(1,unixepoch()*1000);`);
    })();
  return db;
}
export type Db = ReturnType<typeof openDb>;
