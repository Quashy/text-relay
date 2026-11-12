import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
import { hashPassword, digest } from '../src/server/security.js';
const origin = 'http://localhost:3000',
  password = 'test-only-long-password';
const headers = {
  host: 'localhost:3000',
  origin,
  'x-textrelay-request': '1',
  'content-type': 'application/json',
};
const db = openDb(':memory:');
let clock = Date.now();
const app = await createApp({ db, origin, secure: false, rateLimit: false, now: () => clock });
let cookie = '';
const request = (method: any, url: string, payload?: any, logged = true, extra: any = {}) =>
  app.inject({
    method,
    url,
    payload,
    headers: Object.fromEntries(
      Object.entries({ ...headers, ...(logged ? { cookie } : {}), ...extra }).filter(
        ([, v]) => v !== undefined,
      ),
    ),
  });
async function login() {
  const r = await request('POST', '/api/auth/login', { username: 'owner', password }, false);
  assert.equal(r.statusCode, 200);
  return r.headers['set-cookie']!.toString().split(';')[0];
}
async function create(
  code?: string,
  body = 'Hello\n  world\t <script>alert(1)</script>\n',
  enabled = true,
) {
  const r = await request('POST', '/api/admin/shares', {
    title: '测试标题',
    body,
    enabled,
    ...(code ? { code } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
before(async () => {
  db.prepare(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,?,?,'superadmin',0,?)",
  ).run('owner', await hashPassword(password), clock);
  cookie = await login();
});
after(async () => {
  await app.close();
  db.close();
});
test('all management endpoints require authentication', async () => {
  for (const [method, url, payload] of [
    ['GET', '/api/admin/shares', undefined],
    ['POST', '/api/admin/shares/search', {}],
    ['POST', '/api/admin/shares', { title: 'x', body: 'x', enabled: true }],
    ['GET', '/api/admin/shares/x', undefined],
    ['PATCH', '/api/admin/shares/x', { version: 1 }],
    ['POST', '/api/admin/shares/x/rotate-code', { version: 1 }],
    ['DELETE', '/api/admin/shares/x', { version: 1 }],
    ['GET', '/api/auth/session', undefined],
    ['POST', '/api/auth/logout', {}],
    ['POST', '/api/auth/password', {}],
  ] as any[]) {
    assert.equal((await request(method, url, payload, false)).statusCode, 401, url);
  }
});
test('source checks, content type, custom header and Host are enforced', async () => {
  for (const extra of [
    { origin: undefined },
    { origin: 'null' },
    { origin: 'https://evil.example' },
    { 'x-textrelay-request': undefined },
    { 'content-type': 'text/plain' },
  ])
    assert.equal(
      (await request('POST', '/api/auth/login', { username: 'owner', password }, false, extra))
        .statusCode,
      403,
    );
  assert.equal(
    (await request('GET', '/api/health', undefined, false, { host: 'evil.example' })).statusCode,
    403,
  );
});
test('canonical routed paths protect encoded URLs and query suffixes', async () => {
  for (const url of ['/api/%61dmin/shares', '/%61pi/admin/shares'])
    assert.equal((await request('GET', url, undefined, false)).statusCode, 401);
  assert.equal(
    (
      await request(
        'POST',
        '/%61pi/admin/shares',
        { title: 'bad', body: 'bad', enabled: true },
        false,
        { origin: undefined, 'x-textrelay-request': undefined },
      )
    ).statusCode,
    403,
  );
  const limited = await createApp({ db, origin, secure: false, now: () => clock });
  for (let i = 0; i < 3; i++)
    assert.notEqual(
      (
        await limited.inject({
          method: 'POST',
          url: '/api/share/resolve?x=' + i,
          headers,
          payload: { code: 'xxxx' },
        })
      ).statusCode,
      429,
    );
  assert.equal(
    (
      await limited.inject({
        method: 'POST',
        url: '/%61pi/share/resolve?x=4',
        headers,
        payload: { code: 'xxxx' },
      })
    ).statusCode,
    429,
  );
  await limited.close();
});
test('exact case-sensitive four-character codes, leading zeros, body preservation', async () => {
  const body = '\n  exact whitespace\r\n\t<script>window.hacked=true</script>  \n';
  await create('Ab12', body);
  await create('ab12', 'lowercase');
  await create('0001', 'zero');
  for (const [code, expected] of [
    ['Ab12', body],
    ['ab12', 'lowercase'],
    ['0001', 'zero'],
    ['  Ab12\n', body],
  ]) {
    const r = await request('POST', '/api/share/resolve', { code }, false);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().body, expected);
    assert.equal(r.json().title, undefined);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  for (const code of ['abc', 'abcde', 'Ａb12', 'ab_1', '汉字12', 'a\nb1', ''])
    assert.equal(
      (await request('POST', '/api/share/resolve', { code }, false)).statusCode,
      400,
      code,
    );
  for (const code of ['AB12', 'xxxx'])
    assert.equal((await request('POST', '/api/share/resolve', { code }, false)).statusCode, 404);
  for (const payload of [{ code: 1234 }, { code: true }, { code: 'Ab12', extra: 1 }])
    assert.equal((await request('POST', '/api/share/resolve', payload, false)).statusCode, 400);
});
test('unique code race allows exactly one writer; disabled codes stay reserved', async () => {
  const requests = await Promise.all(
    Array.from({ length: 8 }, () =>
      request('POST', '/api/admin/shares', {
        title: 'race',
        body: 'same',
        code: 'Rc01',
        enabled: true,
      }),
    ),
  );
  assert.equal(requests.filter((r) => r.statusCode === 201).length, 1);
  assert.equal(requests.filter((r) => r.statusCode === 409).length, 7);
  const disabled = await create('Ds01', 'not visible', false);
  assert.equal(
    (await request('POST', '/api/share/resolve', { code: 'Ds01' }, false)).statusCode,
    404,
  );
  assert.equal(
    (
      await request('POST', '/api/admin/shares', {
        title: 'x',
        body: 'x',
        enabled: true,
        code: 'Ds01',
      })
    ).statusCode,
    409,
  );
  const r = await request('PATCH', '/api/admin/shares/' + disabled.id, {
    enabled: true,
    version: disabled.version,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(
    (await request('POST', '/api/share/resolve', { code: 'Ds01' }, false)).statusCode,
    200,
  );
});
test('rotation/deletion release old codes immediately and reject stale versions', async () => {
  let share = await create('Old1', 'original');
  const base = '/api/admin/shares/' + share.id;
  assert.equal((await request('PATCH', base, { body: 'stale', version: 99 })).statusCode, 409);
  assert.equal(
    (await request('POST', base + '/rotate-code', { code: 'Ab12', version: 1 })).statusCode,
    409,
  );
  assert.equal(
    (await request('POST', '/api/share/resolve', { code: 'Old1' }, false)).json().body,
    'original',
  );
  let r = await request('POST', base + '/rotate-code', { code: 'New1', version: 1 });
  assert.equal(r.statusCode, 200);
  share = r.json();
  assert.equal(
    (await request('POST', '/api/share/resolve', { code: 'Old1' }, false)).statusCode,
    404,
  );
  await create('Old1', 'replacement');
  assert.equal(
    (await request('POST', '/api/share/resolve', { code: 'Old1' }, false)).json().body,
    'replacement',
  );
  assert.equal((await request('DELETE', base, { version: 1 })).statusCode, 409);
  assert.equal(
    (await request('POST', base + '/rotate-code', { code: 'New1', version: share.version }))
      .statusCode,
    400,
  );
  r = await request('POST', base + '/rotate-code', { version: share.version });
  assert.equal(r.statusCode, 200);
  const random = r.json();
  assert.match(random.code, /^[A-Za-z0-9]{4}$/);
  assert.notEqual(random.code, 'New1');
  await create('New1');
  assert.equal((await request('DELETE', base, { version: random.version })).statusCode, 200);
  await create(random.code, 'reused after delete');
});
test('UTF-8 byte limit, empty body/title, request shape and SQL input boundaries', async () => {
  assert.equal(
    (await request('POST', '/api/admin/shares', { title: '空', body: '', enabled: true }))
      .statusCode,
    400,
  );
  assert.equal(
    (await request('POST', '/api/admin/shares', { title: '  ', body: 'x', enabled: true }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request('POST', '/api/admin/shares', {
        title: 'x',
        body: '你'.repeat(35000),
        enabled: true,
      })
    ).statusCode,
    400,
  );
  await create('Max1', 'a'.repeat(102400));
  assert.equal(
    (
      await request('POST', '/api/admin/shares', {
        title: 'x',
        body: 'a'.repeat(102401),
        enabled: true,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await request('POST', '/api/admin/shares', { title: 'x', body: 'x', enabled: 1 })).statusCode,
    400,
  );
  const r = await request('POST', '/api/admin/shares/search', { q: "%' OR 1=1 --" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().total, 0);
});
test('search matches title/body substrings and exact case-sensitive code; pagination', async () => {
  const r = await request('POST', '/api/admin/shares/search', { q: 'Ab12' });
  assert.equal(r.json().total, 1);
  assert.equal(r.json().items[0].code, 'Ab12');
  assert.equal((await request('POST', '/api/admin/shares/search', { q: 'AB12' })).json().total, 0);
  for (let i = 0; i < 23; i++) await create(undefined, 'pagination');
  const page = await request('POST', '/api/admin/shares/search', { q: 'pagination', page: 2 });
  assert.equal(page.json().items.length, 3);
  assert.equal(page.json().total, 23);
  const clamped = await request('POST', '/api/admin/shares/search', { q: 'pagination', page: 99 });
  assert.equal(clamped.json().page, 2);
  assert.equal(clamped.json().items.length, 3);
});
test('cookie properties, digest-only storage, logout, password revocation, expiry', async () => {
  const r = await request('POST', '/api/auth/login', { username: 'owner', password }, false);
  const set = r.headers['set-cookie']!.toString();
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.doesNotMatch(set, /Domain=/);
  const second = set.split(';')[0],
    token = second.split('=')[1];
  assert.ok(db.prepare('SELECT * FROM user_sessions WHERE token_hash=?').get(digest(token)));
  assert.equal(db.prepare('SELECT * FROM user_sessions WHERE token_hash=?').get(token), undefined);
  assert.equal(
    (await request('POST', '/api/auth/logout', {}, true, { cookie: second })).statusCode,
    200,
  );
  assert.equal(
    (await request('GET', '/api/auth/session', undefined, true, { cookie: second })).statusCode,
    401,
  );
  const newCookie = await login();
  assert.equal(
    (
      await request('POST', '/api/auth/password', {
        currentPassword: 'wrong',
        newPassword: 'another-long-test-password',
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await request('POST', '/api/auth/password', {
        currentPassword: password,
        newPassword: 'another-long-test-password',
      })
    ).statusCode,
    200,
  );
  for (const c of [cookie, newCookie])
    assert.equal(
      (await request('GET', '/api/auth/session', undefined, true, { cookie: c })).statusCode,
      401,
    );
  const loginNew = await request(
    'POST',
    '/api/auth/login',
    { username: 'owner', password: 'another-long-test-password' },
    false,
  );
  cookie = loginNew.headers['set-cookie']!.toString().split(';')[0];
  clock += 8 * 3600000 + 1;
  assert.equal((await request('GET', '/api/auth/session')).statusCode, 401);
});
test('rate limiting counts malformed/successful attempts, resists spoofed XFF, global budget', async () => {
  const limited = await createApp({ db, origin, secure: true, now: () => clock });
  const call = (url: string, ip: string, payload: unknown, xff?: string) =>
    limited.inject({
      method: 'POST',
      url,
      remoteAddress: ip,
      headers: { ...headers, ...(xff ? { 'x-forwarded-for': xff } : {}) },
      payload,
    });
  for (let i = 0; i < 3; i++)
    assert.notEqual(
      (await call('/api/share/resolve', '10.0.0.1', { code: 'Ab12' })).statusCode,
      429,
    );
  const blocked = await call('/api/share/resolve', '10.0.0.1', { code: 'bad' }, '2.2.2.2');
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  for (let i = 0; i < 7; i++)
    assert.notEqual(
      (await call('/api/share/resolve', '10.0.1.' + i, { code: 'bad' })).statusCode,
      429,
    );
  assert.equal((await call('/api/share/resolve', '10.0.2.1', { code: 'Ab12' })).statusCode, 429);
  for (let i = 0; i < 3; i++)
    assert.notEqual(
      (await call('/api/auth/login', '10.0.0.1', { username: 'owner', password: 'wrong' }))
        .statusCode,
      429,
    );
  assert.equal(
    (await call('/api/auth/login', '10.0.0.1', { username: 'owner', password: 'wrong' }, '4.4.4.4'))
      .statusCode,
    429,
  );
  for (let i = 0; i < 2; i++)
    assert.notEqual(
      (await call('/api/auth/login', '10.2.0.' + i, { username: 'owner', password: 'wrong' }))
        .statusCode,
      429,
    );
  assert.equal(
    (await call('/api/auth/login', '10.3.0.1', { username: 'owner', password: 'wrong' }))
      .statusCode,
    429,
  );
  clock += 60000;
  assert.notEqual((await call('/api/share/resolve', '10.0.0.1', { code: 'Ab12' })).statusCode, 429);
  await limited.close();
});
test('WAL backup restoration, migrations are idempotent, public reading can be paused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'textrelay-test-')),
    path = join(dir, 'db.sqlite'),
    backup = join(dir, 'backup.sqlite');
  const source = openDb(path);
  source
    .prepare(
      "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,'backup-owner','test','superadmin',0,0)",
    )
    .run();
  source
    .prepare('INSERT INTO shares VALUES(?,?,?,?,?,1,?,?,1)')
    .run('test', 'backup', 'preserve\n  whitespace', 'Bk01', 1, clock, clock);
  await source.backup(backup);
  source.close();
  const restored = openDb(backup);
  assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(
    (restored.prepare('SELECT body FROM shares').get() as any).body,
    'preserve\n  whitespace',
  );
  assert.equal((restored.prepare('SELECT count(*) n FROM schema_migrations').get() as any).n, 2);
  const paused = await createApp({ db: restored, origin, rateLimit: false, publicRead: false });
  const r = await paused.inject({
    method: 'POST',
    url: '/api/share/resolve',
    headers,
    payload: { code: 'Bk01' },
  });
  assert.equal(r.statusCode, 404);
  await paused.close();
  restored.close();
  rmSync(dir, { recursive: true });
});
test('SQLITE_BUSY returns retryable error without changing data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'textrelay-busy-')),
    path = join(dir, 'db.sqlite'),
    one = openDb(path),
    two = new Database(path);
  one
    .prepare(
      "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,?,?,'superadmin',0,?)",
    )
    .run('owner', await hashPassword(password), clock);
  const busy = await createApp({
    db: one,
    origin,
    secure: false,
    rateLimit: false,
    now: () => clock,
  });
  const logged = await busy.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers,
    payload: { username: 'owner', password },
  });
  const c = logged.headers['set-cookie']!.toString().split(';')[0];
  two.exec('BEGIN IMMEDIATE');
  const r = await busy.inject({
    method: 'POST',
    url: '/api/admin/shares',
    headers: { ...headers, cookie: c },
    payload: { title: 'locked', body: 'body', enabled: true },
  });
  assert.equal(r.statusCode, 503);
  two.exec('ROLLBACK');
  assert.equal((one.prepare('SELECT count(*) n FROM shares').get() as any).n, 0);
  await busy.close();
  one.close();
  two.close();
  rmSync(dir, { recursive: true });
});

test('trusted proxy is explicit and untrusted forwarding headers cannot affect budgets', async () => {
  const limited = await createApp({
    db,
    origin,
    secure: false,
    trustedProxy: ['127.0.0.1'],
    now: () => clock,
  });
  const call = (remoteAddress: string, forwarded: string) =>
    limited.inject({
      method: 'POST',
      url: '/api/share/resolve',
      remoteAddress,
      headers: { ...headers, 'x-forwarded-for': forwarded },
      payload: { code: 'Ab12' },
    });
  for (let i = 0; i < 3; i++)
    assert.notEqual((await call('10.99.0.1', '1.1.1.' + i)).statusCode, 429);
  assert.equal((await call('10.99.0.1', '1.1.1.99')).statusCode, 429);
  assert.notEqual((await call('127.0.0.1', '10.20.0.1')).statusCode, 429);
  assert.notEqual((await call('127.0.0.1', '10.20.0.2')).statusCode, 429);
  await limited.close();
});
test('password reset wins against an in-flight login using the former password', async () => {
  const isolated = openDb(':memory:');
  const hash = await hashPassword(password);
  isolated
    .prepare(
      "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,?,?,'superadmin',0,?)",
    )
    .run('owner', hash, clock);
  const service = await createApp({
    db: isolated,
    origin,
    secure: false,
    rateLimit: false,
    now: () => clock,
  });
  const prepare = isolated.prepare.bind(isolated);
  let reset = false;
  isolated.prepare = ((sql: string) => {
    const stmt = prepare(sql);
    if (sql === 'SELECT * FROM users WHERE username=? COLLATE NOCASE') {
      const get = stmt.get.bind(stmt);
      stmt.get = ((...args: unknown[]) => {
        const row = get(...args);
        queueMicrotask(() => {
          prepare('UPDATE users SET password_hash=? WHERE id=1').run('revoked');
          prepare('DELETE FROM user_sessions').run();
          reset = true;
        });
        return row;
      }) as typeof stmt.get;
    }
    return stmt;
  }) as typeof isolated.prepare;
  const result = await service.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers,
    payload: { username: 'owner', password },
  });
  assert.equal(reset, true);
  assert.equal(result.statusCode, 401);
  assert.equal((prepare('SELECT count(*) n FROM user_sessions').get() as any).n, 0);
  await service.close();
  isolated.close();
});
test('five concurrent resolutions remain below 500ms P95 in the local API benchmark', async () => {
  const local = await createApp({ db, origin, secure: false, now: () => clock });
  const values: number[] = [];
  for (let round = 0; round < 10; round++) {
    clock += 60000;
    await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const start = performance.now();
        const r = await local.inject({
          method: 'POST',
          url: '/api/share/resolve',
          remoteAddress: '10.40.0.' + i,
          headers,
          payload: { code: 'Ab12' },
        });
        assert.equal(r.statusCode, 200);
        values.push(performance.now() - start);
      }),
    );
  }
  values.sort((a, b) => a - b);
  const p95 = values[Math.ceil(values.length * 0.95) - 1];
  assert.ok(p95 < 500, 'P95=' + p95);
  console.log('Local inject 5-way resolve P95: ' + p95.toFixed(2) + 'ms (50 requests)');
  await local.close();
});
