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
  const schema =
    (db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as { v: number | null })
      .v ?? 0;
  if (schema > 2) {
    db.close();
    throw Error('Database schema is newer than this application');
  }
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
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) {
    try {
      db.transaction(() => {
        const orphaned = db.prepare('SELECT count(*) AS n FROM shares').get() as { n: number };
        if (orphaned.n && !db.prepare('SELECT id FROM admin WHERE id=1').get())
          throw Error('Existing shares have no administrator; migration stopped');
        db.exec(`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(username)) BETWEEN 1 AND 100),
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK((id=1 AND role='superadmin') OR (id<>1 AND role='user')),
            version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          INSERT INTO users(id,username,password_hash,role,created_at,updated_at)
            SELECT id,username,password_hash,'superadmin',updated_at,updated_at FROM admin;
          CREATE TRIGGER protect_superadmin_delete BEFORE DELETE ON users WHEN OLD.id=1
            BEGIN SELECT RAISE(ABORT,'superadmin is protected'); END;
          CREATE TRIGGER protect_superadmin_identity BEFORE UPDATE OF id,role,username ON users WHEN OLD.id=1
            BEGIN SELECT RAISE(ABORT,'superadmin is protected'); END;
          CREATE TABLE owned_shares (
            id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
            body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 102400),
            code TEXT COLLATE BINARY NOT NULL UNIQUE CHECK(length(code)=4 AND code NOT GLOB '*[^A-Za-z0-9]*'),
            enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
          );
          INSERT INTO owned_shares SELECT *,1 FROM shares;
          DROP TABLE shares;
          ALTER TABLE owned_shares RENAME TO shares;
          CREATE INDEX shares_owner ON shares(owner_id,updated_at DESC);
          CREATE TABLE user_sessions (
            token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
          );
          CREATE INDEX user_sessions_expiry ON user_sessions(expires_at);
          CREATE INDEX user_sessions_user ON user_sessions(user_id);
          DROP TABLE sessions;
          DROP TABLE admin;
          INSERT INTO schema_migrations VALUES(2,unixepoch()*1000);
        `);
        if ((db.pragma('foreign_key_check') as unknown[]).length)
          throw Error('Migration foreign key check failed');
      }).immediate();
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return db;
}
export type Db = ReturnType<typeof openDb>;
