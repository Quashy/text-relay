import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { hashPassword } from '../src/server/security.js';

const origin = 'http://localhost:3000';
const attachmentMaxBytes = 64;
const password = 'attachments-test-only-password';
const filename = '测试 文档.md';
const bytes = Buffer.from('# 小文件\n\n上传测试。');
const headers = {
  host: 'localhost:3000',
  origin,
  'x-textrelay-request': '1',
  'content-type': 'application/json',
};
const db = openDb(':memory:');
const attachmentDir = mkdtempSync(join(tmpdir(), 'textrelay-attachments-test-'));
let app: Awaited<ReturnType<typeof createApp>>;
let clock = Date.now();
let owner: string;
let colleague: string;
let colleagueAccount: { id: number; version: number };

function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Buffer | Record<string, unknown>,
  cookie?: string,
  extra?: Record<string, string>,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: { ...headers, ...(cookie ? { cookie } : {}), ...extra },
  });
}

function upload(name: string, contents: Buffer, cookie?: string) {
  return request('POST', '/api/admin/attachments', contents, cookie, {
    'content-type': 'application/octet-stream',
    'x-textrelay-filename': encodeURIComponent(name),
  });
}

async function uploadFile(cookie = owner, contents = bytes) {
  const r = await upload(filename, contents, cookie);
  assert.equal(r.statusCode, 201, r.body);
  const file = r.json<{ id: string; name: string; size: number }>();
  assert.equal(file.name, filename);
  assert.equal(file.size, contents.length);
  return file;
}

async function createShare(code: string, body = '', attachmentId?: string, cookie = owner) {
  const r = await request(
    'POST',
    '/api/admin/shares',
    { code, title: '附件测试', body, enabled: true, ...(attachmentId ? { attachmentId } : {}) },
    cookie,
  );
  assert.equal(r.statusCode, 201, r.body);
  return r.json<{
    id: string;
    version: number;
    attachment?: { id: string; name: string; size: number };
  }>();
}

function resolveCode(code: string) {
  return request('POST', '/api/share/resolve', { code });
}

async function resolveAttachment(code: string, body: string) {
  const r = await resolveCode(code);
  assert.equal(r.statusCode, 200, r.body);
  const data = r.json<{
    body: string;
    attachment: { name: string; size: number; downloadUrl: string };
  }>();
  assert.equal(data.body, body);
  assert.equal(data.attachment.name, filename);
  assert.ok(data.attachment.downloadUrl.startsWith('/api/'), data.attachment.downloadUrl);
  assert.equal('id' in data.attachment, false);
  return data.attachment;
}

before(async () => {
  app = await createApp({
    db,
    origin,
    secure: false,
    rateLimit: false,
    now: () => clock,
    attachmentDir,
    attachmentMaxBytes,
  });
  db.prepare(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,'owner',?,'superadmin',0,0)",
  ).run(await hashPassword(password));
  const login = async (username: string) => {
    const response = await request('POST', '/api/auth/login', { username, password });
    assert.equal(response.statusCode, 200, response.body);
    return response.headers['set-cookie']!.toString().split(';')[0];
  };
  owner = await login('owner');
  const response = await request(
    'POST',
    '/api/admin/users',
    { username: 'colleague', password },
    owner,
  );
  assert.equal(response.statusCode, 201, response.body);
  colleagueAccount = response.json();
  colleague = await login('colleague');
});

after(async () => {
  try {
    await app?.close();
  } finally {
    db.close();
    rmSync(attachmentDir, { recursive: true, force: true });
  }
});

test('only signed-in owners can upload, and the file ceiling is exclusive', async () => {
  assert.equal((await upload(filename, bytes)).statusCode, 401);
  const before = readdirSync(attachmentDir);
  assert.equal((await upload(filename, Buffer.alloc(attachmentMaxBytes), owner)).statusCode, 413);
  assert.equal(
    (await upload(filename, Buffer.alloc(attachmentMaxBytes + 1), owner)).statusCode,
    413,
  );
  assert.deepEqual(readdirSync(attachmentDir), before);
  const file = await uploadFile(owner, Buffer.alloc(attachmentMaxBytes - 1, 0x20));
  const share = await createShare('Fi01', '', file.id);
  assert.deepEqual(share.attachment, file);
  const response = await request(
    'DELETE',
    '/api/admin/shares/' + share.id,
    { version: share.version },
    owner,
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(readdirSync(attachmentDir), before);
});

test('a small file-only share downloads byte-for-byte and supports range requests', async () => {
  const file = await uploadFile();
  const share = await createShare('Fi02', '', file.id);
  assert.deepEqual(share.attachment, file);
  const attachment = await resolveAttachment('Fi02', '');
  assert.equal(attachment.size, bytes.length);

  const downloaded = await request('GET', attachment.downloadUrl);
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.deepEqual(downloaded.rawPayload, bytes);
  assert.equal(downloaded.headers['cache-control'], 'no-store');
  assert.match(String(downloaded.headers['content-disposition']), /attachment/i);
  assert.ok(
    String(downloaded.headers['content-disposition']).includes(encodeURIComponent(filename)),
  );
  assert.equal(downloaded.headers['accept-ranges'], 'bytes');
  const partial = await request('GET', attachment.downloadUrl, undefined, undefined, {
    range: 'bytes=2-5',
  });
  assert.equal(partial.statusCode, 206, partial.body);
  assert.equal(partial.headers['content-range'], 'bytes 2-5/' + bytes.length);
  assert.deepEqual(partial.rawPayload, bytes.subarray(2, 6));

  const stored = join(attachmentDir, file.id);
  assert.deepEqual(readFileSync(stored), bytes);
  const deletion = await request(
    'DELETE',
    '/api/admin/shares/' + share.id,
    { version: share.version },
    owner,
  );
  assert.equal(deletion.statusCode, 200, deletion.body);
  assert.equal(existsSync(stored), false);
  assert.equal((await resolveCode('Fi02')).statusCode, 404);
  assert.equal((await request('GET', attachment.downloadUrl)).statusCode, 404);
});

test('replacement, removal, and mutating a share invalidate the old download authorization', async () => {
  const old = await uploadFile();
  const share = await createShare('Fi03', '说明正文', old.id);
  const first = await resolveAttachment('Fi03', '说明正文');
  const replacement = await uploadFile(owner, Buffer.from('new file'));
  const patchUrl = '/api/admin/shares/' + share.id;
  const conflict = await request(
    'PATCH',
    patchUrl,
    { version: share.version + 1, attachmentId: replacement.id },
    owner,
  );
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal((await request('GET', first.downloadUrl)).statusCode, 200);
  assert.equal(existsSync(join(attachmentDir, old.id)), true);

  const replace = await request(
    'PATCH',
    patchUrl,
    { version: share.version, attachmentId: replacement.id },
    owner,
  );
  assert.equal(replace.statusCode, 200, replace.body);
  assert.equal(existsSync(join(attachmentDir, old.id)), false);
  assert.equal((await request('GET', first.downloadUrl)).statusCode, 404);
  const second = await resolveAttachment('Fi03', '说明正文');
  assert.deepEqual((await request('GET', second.downloadUrl)).rawPayload, Buffer.from('new file'));

  const rotate = await request(
    'POST',
    patchUrl + '/rotate-code',
    { version: replace.json().version, code: 'FNew' },
    owner,
  );
  assert.equal(rotate.statusCode, 200, rotate.body);
  assert.equal((await request('GET', second.downloadUrl)).statusCode, 404);
  const current = await resolveAttachment('FNew', '说明正文');
  const pause = await request(
    'PATCH',
    patchUrl,
    { version: rotate.json().version, enabled: false },
    owner,
  );
  assert.equal(pause.statusCode, 200, pause.body);
  assert.equal((await request('GET', current.downloadUrl)).statusCode, 404);
  assert.equal(existsSync(join(attachmentDir, replacement.id)), true);

  const remove = await request(
    'PATCH',
    patchUrl,
    { version: pause.json().version, enabled: true, attachmentId: null },
    owner,
  );
  assert.equal(remove.statusCode, 200, remove.body);
  assert.equal(existsSync(join(attachmentDir, replacement.id)), false);
  const text = await resolveCode('FNew');
  assert.equal(text.statusCode, 200, text.body);
  assert.equal(text.json().body, '说明正文');
  assert.equal(text.json().attachment, undefined);
});

test('deleting a user removes the files belonging to their shares', async () => {
  const file = await uploadFile(colleague);
  const refused = await request(
    'POST',
    '/api/admin/shares',
    { code: 'Fi04', title: '附件测试', body: '', enabled: true, attachmentId: file.id },
    owner,
  );
  assert.ok([400, 404].includes(refused.statusCode), refused.body);
  await createShare('Fi04', '', file.id, colleague);
  const { downloadUrl } = await resolveAttachment('Fi04', '');

  const deleted = await request(
    'DELETE',
    '/api/admin/users/' + colleagueAccount.id,
    { version: colleagueAccount.version },
    owner,
  );
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(existsSync(join(attachmentDir, file.id)), false);
  assert.equal((await resolveCode('Fi04')).statusCode, 404);
  assert.equal((await request('GET', downloadUrl)).statusCode, 404);
});

test('existing text API remains compatible and an empty share is rejected', async () => {
  await createShare('Fi05', '  原文\n  \t');
  const r = await resolveCode('Fi05');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.json()).sort(), ['body', 'updated_at']);
  assert.equal(r.json().body, '  原文\n  \t');
  const empty = await request(
    'POST',
    '/api/admin/shares',
    { title: '空', body: '', enabled: true },
    owner,
  );
  assert.equal(empty.statusCode, 400, empty.body);
});

test('download authorization expires, but the unexpired share can be resolved again', async () => {
  const file = await uploadFile();
  const share = await createShare('Fi06', '', file.id);
  const first = await resolveAttachment('Fi06', '');
  const unavailableRange = await request('GET', first.downloadUrl, undefined, undefined, {
    range: 'bytes=' + bytes.length + '-',
  });
  assert.equal(unavailableRange.statusCode, 416);
  assert.equal(unavailableRange.headers['content-range'], 'bytes */' + bytes.length);
  const original = clock;
  try {
    clock += 31 * 60 * 1000;
    assert.equal((await request('GET', first.downloadUrl)).statusCode, 404);
    const renewed = await resolveAttachment('Fi06', '');
    assert.equal((await request('GET', renewed.downloadUrl)).statusCode, 200);
  } finally {
    clock = original;
  }
  const deleted = await request(
    'DELETE',
    '/api/admin/shares/' + share.id,
    { version: share.version },
    owner,
  );
  assert.equal(deleted.statusCode, 200, deleted.body);
});

test('failed disk deletion revokes the download and retries durable cleanup', async () => {
  const file = await uploadFile();
  const share = await createShare('Fi07', '', file.id);
  const { downloadUrl } = await resolveAttachment('Fi07', '');
  const stored = join(attachmentDir, file.id);
  const parked = stored + '.test-parked';
  renameSync(stored, parked);
  mkdirSync(stored);
  try {
    // unlink cannot remove a directory, even when running as an administrator.
    const deletion = await request(
      'DELETE',
      '/api/admin/shares/' + share.id,
      { version: share.version },
      owner,
    );
    assert.equal(deletion.statusCode, 200, deletion.body);
    assert.equal(deletion.json().cleanupPending, true);
    assert.equal((await request('GET', downloadUrl)).statusCode, 404);
    const pending = db.prepare('SELECT state FROM attachments WHERE id=?').get(file.id);
    assert.deepEqual(pending, { state: 'deleting' });
  } finally {
    rmdirSync(stored);
    renameSync(parked, stored);
  }
  const retried = await request('POST', '/api/admin/attachments/cleanup', {}, owner);
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(retried.json().cleanupPending, undefined);
  assert.equal(existsSync(stored), false);
  assert.equal(db.prepare('SELECT state FROM attachments WHERE id=?').get(file.id), undefined);
});

test('canceling a small HTTP upload removes the partial file', { timeout: 8000 }, async () => {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const conn = httpRequest({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'POST',
    path: '/api/admin/attachments',
    headers: {
      ...headers,
      cookie: owner,
      'content-type': 'application/octet-stream',
      'content-length': bytes.length,
      'x-textrelay-filename': encodeURIComponent(filename),
    },
  });
  conn.on('error', () => {});
  conn.on('response', (response) => response.resume());
  const findPartial = () => readdirSync(attachmentDir).find((name) => name.endsWith('.part'));
  let partial: string | undefined;
  try {
    conn.write(bytes.subarray(0, 3));
    for (let tries = 0; tries < 100 && !(partial = findPartial()); tries++) await delay(20);
    assert.ok(partial, 'no partial file was staged after the first chunk');
  } finally {
    conn.destroy();
  }
  for (let tries = 0; tries < 100 && findPartial(); tries++) await delay(20);
  assert.equal(findPartial(), undefined, 'an interrupted upload left a partial file behind');
  assert.equal(existsSync(join(attachmentDir, partial.replace(/\.part$/, ''))), false);
});
