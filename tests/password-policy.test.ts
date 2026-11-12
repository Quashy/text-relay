import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
import { hashPassword } from '../src/server/security.js';

test('password boundary: five rejected, six accepted for creation, reset and self-change', async () => {
  const db = openDb(':memory:');
  const initial = 'existing-long-test-password';
  db.prepare(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,'root',?,'superadmin',0,0)",
  ).run(await hashPassword(initial));
  const app = await createApp({
    db,
    origin: 'http://localhost:3000',
    secure: false,
    rateLimit: false,
  });
  const call = (cookie: string, method: any, url: string, payload?: any) =>
    app.inject({
      method,
      url,
      payload,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-textrelay-request': '1',
        cookie,
      },
    });
  const login = async (username: string, password: string) => {
    const result = await call('', 'POST', '/api/auth/login', { username, password });
    assert.equal(result.statusCode, 200);
    return result.headers['set-cookie']!.toString().split(';')[0];
  };
  try {
    const root = await login('root', initial);
    for (const password of ['12345', 'x'.repeat(257)]) {
      assert.equal(
        (await call(root, 'POST', '/api/admin/users', { username: 'rejected', password }))
          .statusCode,
        400,
      );
      assert.equal(db.prepare("SELECT id FROM users WHERE username='rejected'").get(), undefined);
    }
    const made = await call(root, 'POST', '/api/admin/users', {
      username: 'six',
      password: '123456',
    });
    assert.equal(made.statusCode, 201);
    const user = made.json();
    let cookie = await login('six', '123456');
    for (const password of ['12345', 'x'.repeat(257)]) {
      assert.equal(
        (await call(root, 'PATCH', '/api/admin/users/' + user.id, { password, version: 1 }))
          .statusCode,
        400,
      );
      assert.equal((await call(cookie, 'GET', '/api/auth/session')).statusCode, 200);
    }
    assert.equal(
      (await call(root, 'PATCH', '/api/admin/users/' + user.id, { password: '654321', version: 1 }))
        .statusCode,
      200,
    );
    assert.equal((await call(cookie, 'GET', '/api/auth/session')).statusCode, 401);
    assert.equal(
      (await call('', 'POST', '/api/auth/login', { username: 'six', password: '123456' }))
        .statusCode,
      401,
    );
    cookie = await login('six', '654321');
    for (const newPassword of ['12345', 'x'.repeat(257)]) {
      assert.equal(
        (
          await call(cookie, 'POST', '/api/auth/password', {
            currentPassword: '654321',
            newPassword,
          })
        ).statusCode,
        400,
      );
      assert.equal((await call(cookie, 'GET', '/api/auth/session')).statusCode, 200);
    }
    assert.equal(
      (
        await call(cookie, 'POST', '/api/auth/password', {
          currentPassword: '654321',
          newPassword: 'abcdef',
        })
      ).statusCode,
      200,
    );
    assert.equal((await call(cookie, 'GET', '/api/auth/session')).statusCode, 401);
    await login('six', 'abcdef');
    assert.equal(
      (
        await call(root, 'POST', '/api/auth/password', {
          currentPassword: initial,
          newPassword: '12345',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call(root, 'POST', '/api/auth/password', {
          currentPassword: initial,
          newPassword: '123456',
        })
      ).statusCode,
      200,
    );
    await login('root', '123456');
    const freshRoot = await login('root', '123456');
    assert.equal(
      (
        await call(freshRoot, 'POST', '/api/admin/users', {
          username: 'upper-bound',
          password: 'x'.repeat(256),
        })
      ).statusCode,
      201,
    );
    await login('upper-bound', 'x'.repeat(256));
  } finally {
    await app.close();
    db.close();
  }
});
