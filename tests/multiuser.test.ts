import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
import { hashPassword, digest } from '../src/server/security.js';
const password = 'multiuser-test-only-password';
const headers = {
  host: 'localhost:3000',
  origin: 'http://localhost:3000',
  'x-textrelay-request': '1',
  'content-type': 'application/json',
};
test('every actor including superadmin is isolated; user CRUD revokes sessions and cascades shares', async () => {
  const db = openDb(':memory:');
  db.prepare(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,'quashy',?,'superadmin',0,0)",
  ).run(await hashPassword(password));
  const app = await createApp({ db, origin: headers.origin, secure: false, rateLimit: false });
  const call = (cookie: string, method: any, url: string, payload?: any) =>
    app.inject({ method, url, payload, headers: { ...headers, cookie } });
  const login = async (username: string, pw = password) => {
    const r = await call('', 'POST', '/api/auth/login', { username, password: pw });
    assert.equal(r.statusCode, 200, r.body);
    return r.headers['set-cookie']!.toString().split(';')[0];
  };
  try {
    const root = await login('quashy');
    const make = async (username: string) => {
      const r = await call(root, 'POST', '/api/admin/users', { username, password });
      assert.equal(r.statusCode, 201, r.body);
      assert.equal('password_hash' in r.json(), false);
      assert.equal(r.json().role, 'user');
      return r.json();
    };
    const alice = await make('alice'),
      bob = await make('bob');
    assert.equal(
      (await call(root, 'POST', '/api/admin/users', { username: 'ALICE', password })).statusCode,
      409,
    );
    assert.equal(
      (
        await call(root, 'POST', '/api/admin/users', {
          username: 'evil',
          password,
          role: 'superadmin',
        })
      ).statusCode,
      400,
    );
    let ac = await login('alice');
    const bc = await login('bob');
    const create = async (c: string, code: string) => {
      const r = await call(c, 'POST', '/api/admin/shares', {
        title: code,
        body: 'private ' + code,
        enabled: true,
        code,
      });
      assert.equal(r.statusCode, 201, r.body);
      assert.equal('owner_id' in r.json(), false);
      return r.json();
    };
    const rs = await create(root, 'Rt01'),
      as = await create(ac, 'Al01'),
      bs = await create(bc, 'Bo01');
    for (const [c, own, others] of [
      [root, rs, [as, bs]],
      [ac, as, [rs, bs]],
      [bc, bs, [rs, as]],
    ] as const) {
      const list = await call(c, 'GET', '/api/admin/shares');
      assert.equal(list.json().total, 1);
      assert.equal(list.json().items[0].id, own.id);
      for (const foreign of others) {
        const search = await call(c, 'POST', '/api/admin/shares/search', { q: foreign.code });
        assert.equal(search.json().total, 0);
        for (const [method, suffix, payload] of [
          ['GET', '', undefined],
          ['PATCH', '', { title: 'stolen', version: foreign.version }],
          ['POST', '/rotate-code', { code: 'New1', version: foreign.version }],
          ['DELETE', '', { version: foreign.version }],
        ] as const)
          assert.equal(
            (await call(c, method, '/api/admin/shares/' + foreign.id + suffix, payload)).statusCode,
            404,
          );
      }
    }
    assert.equal(
      (
        await call(ac, 'POST', '/api/admin/shares', {
          title: 'fake owner',
          body: 'x',
          enabled: true,
          owner_id: 1,
        })
      ).statusCode,
      400,
    );
    for (const path of ['/api/admin/users', '/api/%61dmin/users', '/api/admin/users/' + bob.id])
      assert.equal((await call(ac, 'GET', path)).statusCode, 403);
    for (const [method, url, payload] of [
      ['POST', '/api/admin/users', { username: 'evil', password }],
      ['PATCH', '/api/admin/users/' + bob.id, { username: 'evil', version: bob.version }],
      ['DELETE', '/api/admin/users/' + bob.id, { version: bob.version }],
    ] as const)
      assert.equal((await call(ac, method, url, payload)).statusCode, 403);
    assert.equal(
      (await call(root, 'DELETE', '/api/admin/users/1', { version: 1 })).statusCode,
      403,
    );
    assert.equal(
      (await call(root, 'PATCH', '/api/admin/users/1', { username: 'rename', version: 1 }))
        .statusCode,
      403,
    );
    assert.throws(() => db.prepare('DELETE FROM users WHERE id=1').run());
    assert.throws(() => db.prepare("UPDATE users SET role='user' WHERE id=1").run());
    // Changing one account never clears another account's sessions.
    const newPassword = 'changed-test-only-password';
    assert.equal(
      (await call(ac, 'POST', '/api/auth/password', { currentPassword: password, newPassword }))
        .statusCode,
      200,
    );
    assert.equal((await call(ac, 'GET', '/api/auth/session')).statusCode, 401);
    assert.equal((await call(bc, 'GET', '/api/auth/session')).statusCode, 200);
    assert.equal((await call(root, 'GET', '/api/auth/session')).statusCode, 200);
    ac = await login('alice', newPassword);
    const renamed = await call(root, 'PATCH', '/api/admin/users/' + alice.id, {
      username: 'alice-new',
      password,
      version: 2,
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((await call(ac, 'GET', '/api/auth/session')).statusCode, 401);
    assert.equal(
      (await call('', 'POST', '/api/auth/login', { username: 'alice', password: newPassword }))
        .statusCode,
      401,
    );
    ac = await login('alice-new');
    assert.equal((await call(ac, 'GET', '/api/admin/shares')).json().items[0].id, as.id);
    assert.equal(
      (await call(root, 'DELETE', '/api/admin/users/' + alice.id, { version: 1 })).statusCode,
      409,
    );
    assert.equal(
      (
        await call(root, 'DELETE', '/api/admin/users/' + alice.id, {
          version: renamed.json().version,
        })
      ).statusCode,
      200,
    );
    assert.equal((await call(ac, 'GET', '/api/auth/session')).statusCode, 401);
    assert.equal((await call('', 'POST', '/api/share/resolve', { code: 'Al01' })).statusCode, 404);
    assert.equal((await call('', 'POST', '/api/share/resolve', { code: 'Bo01' })).statusCode, 200);
    assert.equal(
      (db.prepare('SELECT count(*) n FROM shares WHERE owner_id=?').get(alice.id) as any).n,
      0,
    );
    assert.equal(
      (db.prepare('SELECT count(*) n FROM user_sessions WHERE user_id=?').get(alice.id) as any).n,
      0,
    );
    assert.equal((await call(root, 'GET', '/api/admin/users/' + bob.id)).statusCode, 200);
    assert.equal((await call('', 'GET', '/api/admin/users')).statusCode, 401);
  } finally {
    await app.close();
    db.close();
  }
});

function legacy(path: string, hash: string, orphan = false) {
  const db = new Database(path);
  db.pragma('journal_mode=WAL');
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
 INSERT INTO schema_migrations VALUES(1,0);
 CREATE TABLE admin(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX sessions_expiry ON sessions(expires_at);
 CREATE TABLE shares(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,code TEXT COLLATE BINARY UNIQUE NOT NULL,enabled INTEGER NOT NULL,version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
  if (!orphan) db.prepare('INSERT INTO admin VALUES(1,?,?,?)').run('quashy', hash, 42);
  db.prepare('INSERT INTO shares VALUES(?,?,?,?,?,?,?,?)').run(
    'old-share',
    'Old title',
    'Original\n  text\t',
    'Ab12',
    1,
    7,
    10,
    20,
  );
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest('old-token'), Date.now() + 999999, 0);
  return db;
}
test('v1 backup, atomic v2 migration, old-session revocation and public-code continuity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'textrelay-migrate-')),
    path = join(dir, 'db.sqlite'),
    backup = join(dir, 'v1-backup.sqlite');
  const hash = await hashPassword(password),
    old = legacy(path, hash);
  old.close();
  const backedUp = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/server/cli.ts', 'backup', backup],
    { env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf-8' },
  );
  assert.equal(backedUp.status, 0, backedUp.stderr);
  const untouched = new Database(path, { readonly: true });
  assert.equal(
    (untouched.prepare('SELECT max(version) v FROM schema_migrations').get() as any).v,
    1,
  );
  untouched.close();
  let db = openDb(path);
  assert.equal(
    (db.prepare('SELECT password_hash FROM users WHERE id=1').get() as any).password_hash,
    hash,
  );
  assert.deepEqual(db.prepare('SELECT id,username,role FROM users').all(), [
    { id: 1, username: 'quashy', role: 'superadmin' },
  ]);
  assert.deepEqual(
    db.prepare('SELECT id,body,code,version,created_at,updated_at,owner_id FROM shares').get(),
    {
      id: 'old-share',
      body: 'Original\n  text\t',
      code: 'Ab12',
      version: 7,
      created_at: 10,
      updated_at: 20,
      owner_id: 1,
    },
  );
  assert.equal((db.prepare('SELECT count(*) n FROM user_sessions').get() as any).n, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
  db = openDb(path);
  assert.equal((db.prepare('SELECT count(*) n FROM schema_migrations').get() as any).n, 2);
  const app = await createApp({ db, origin: headers.origin, secure: false, rateLimit: false });
  try {
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/shares',
          headers: { ...headers, cookie: 'tr_session=old-token' },
        })
      ).statusCode,
      401,
    );
    const resolved = await app.inject({
      method: 'POST',
      url: '/api/share/resolve',
      headers,
      payload: { code: 'Ab12' },
    });
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.json().body, 'Original\n  text\t');
    const logged = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { username: 'quashy', password },
    });
    assert.equal(logged.statusCode, 200);
    assert.equal(logged.json().role, 'superadmin');
  } finally {
    await app.close();
    db.close();
  }
  const restored = new Database(backup, { readonly: true });
  assert.equal(
    (restored.prepare('SELECT password_hash FROM admin WHERE id=1').get() as any).password_hash,
    hash,
  );
  assert.equal((restored.prepare('SELECT count(*) n FROM schema_migrations').get() as any).n, 1);
  assert.equal((restored.prepare('SELECT code FROM shares').get() as any).code, 'Ab12');
  restored.close();
  const recovered = openDb(backup);
  assert.equal(
    (recovered.prepare('SELECT count(*) n FROM shares WHERE owner_id=1').get() as any).n,
    1,
  );
  recovered.close();
  rmSync(dir, { recursive: true });
});
test('migration refuses orphaned legacy data without partial schema changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'textrelay-orphan-')),
    path = join(dir, 'db.sqlite');
  const old = legacy(path, 'unused', true);
  old.close();
  assert.throws(() => openDb(path), /no administrator/);
  const db = new Database(path);
  assert.equal((db.prepare('SELECT count(*) n FROM shares').get() as any).n, 1);
  assert.equal((db.prepare('SELECT max(version) n FROM schema_migrations').get() as any).n, 1);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get(), undefined);
  db.close();
  rmSync(dir, { recursive: true });
});
