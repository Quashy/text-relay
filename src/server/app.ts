import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { Db } from './db.js';
import { digest, hashPassword, verifyPassword, randomCode, Limiter } from './security.js';
import type { Share } from '../shared/types.js';
import type { Readable } from 'node:stream';
import { AttachmentError, attachmentIdSchema, attachmentStore } from './attachments.js';
type Options = {
  db: Db;
  origin: string;
  secure?: boolean;
  staticRoot?: string;
  rateLimit?: boolean;
  publicRead?: boolean;
  now?: () => number;
  logger?: boolean;
  trustedProxy?: string[];
  attachmentDir?: string;
  attachmentMaxBytes?: number;
};
type Row = Omit<Share, 'enabled'> & { enabled: number };
const codePattern = '^[A-Za-z0-9]{4}$';
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = (maxLength: number, minLength = 1) => ({ type: 'string', maxLength, minLength });
const version = { type: 'integer', minimum: 1 };
const query = obj({
  page: { type: 'integer', minimum: 1, maximum: 100000 },
  q: str(200, 0),
  status: { type: 'string', enum: ['all', 'enabled', 'disabled'] },
});
const baseShare = (r: Row): Share => ({
  id: r.id,
  title: r.title,
  body: r.body,
  code: r.code,
  enabled: !!r.enabled,
  version: r.version,
  created_at: r.created_at,
  updated_at: r.updated_at,
});
export async function createApp(o: Options) {
  const db = o.db,
    now = o.now ?? Date.now;
  const app = Fastify({
    logger: o.logger
      ? {
          redact: ['req.headers.cookie', 'res.headers.set-cookie'],
          serializers: { req: (r) => ({ method: r.method, url: r.url?.split('?')[0] }) },
        }
      : false,
    bodyLimit: 512 * 1024,
    trustProxy: o.trustedProxy?.length ? o.trustedProxy : false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const staticRoot = resolve(o.staticRoot ?? 'dist/client');
  const attachments = attachmentStore(db, now, o.attachmentDir, o.attachmentMaxBytes);
  if (attachments.root) {
    const inside = (root: string, web: string) => {
      root = root.toLowerCase();
      web = web.toLowerCase();
      return root === web || root.startsWith(web + '/') || root.startsWith(web + '\\');
    };
    if (
      inside(attachments.root, staticRoot) ||
      (existsSync(staticRoot) && inside(realpathSync(attachments.root), realpathSync(staticRoot)))
    )
      throw Error('Attachment storage must not be inside the static directory');
    attachments.sweep();
    const cleanup = setInterval(() => {
      try {
        attachments.sweep();
      } catch {
        app.log.warn('Attachment cleanup will retry');
      }
    }, 60_000);
    cleanup.unref();
    app.addHook('onClose', (_, done) => {
      clearInterval(cleanup);
      done();
    });
  }
  const toShare = (row: Row): Share => {
    const attachment = attachments.current(row.id);
    return attachment ? { ...baseShare(row), attachment } : baseShare(row);
  };
  const uploadPath = '/api/admin/attachments';
  await app.register(cookie);
  const bad = (reply: any, status: number, message: string) => reply.code(status).send({ message });
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: o.secure ?? true,
  };
  type Identity = { id: number; username: string; role: 'superadmin' | 'user'; expires_at: number };
  const identity = (req: any): Identity | undefined => {
    const token = req.cookies.tr_session_v2;
    return token
      ? (db
          .prepare(
            `SELECT u.id,u.username,u.role,s.expires_at
      FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`,
          )
          .get(digest(token), now()) as Identity | undefined)
      : undefined;
  };
  const shareIp = new Limiter(6, 3, now),
    shareAll = new Limiter(60, 10, now),
    loginIp = new Limiter(5, 3, now),
    loginAll = new Limiter(20, 5, now);
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions.url ?? '';
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (req.headers.host !== new URL(o.origin).host) return bad(reply, 403, '请求来源不受支持');
    if (o.rateLimit !== false && (route === '/api/share/resolve' || route === '/api/auth/login')) {
      const login = route === '/api/auth/login';
      const ipWait = (login ? loginIp : shareIp).take(req.ip);
      const wait = ipWait || (login ? loginAll : shareAll).take('all');
      if (wait) {
        reply.header('Retry-After', wait);
        return bad(reply, 429, `操作较频繁，请在 ${wait} 秒后重试`);
      }
    }
    if (
      route.startsWith('/api/') &&
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      route !== '/api/share/resolve'
    ) {
      if (
        req.headers.origin !== o.origin ||
        req.headers['x-textrelay-request'] !== '1' ||
        req.headers['content-type']?.split(';')[0] !==
          (route === uploadPath ? 'application/octet-stream' : 'application/json')
      )
        return bad(reply, 403, '请求来源验证失败，请刷新后重试');
    }
    if (
      route.startsWith('/api/admin/') ||
      ['/api/auth/session', '/api/auth/logout', '/api/auth/password'].includes(route)
    ) {
      const user = identity(req);
      if (!user) return bad(reply, 401, '请先登录账号');
      if (route.startsWith('/api/admin/users') && user.role !== 'superadmin')
        return bad(reply, 403, '仅最高管理员可以管理用户');
    }
  });
  // Revalidate after body parsing/validation too; never rely on an earlier cached role.
  app.addHook('preHandler', async (req, reply) => {
    const route = req.routeOptions.url ?? '';
    if (
      route.startsWith('/api/admin/') ||
      ['/api/auth/session', '/api/auth/logout', '/api/auth/password'].includes(route)
    ) {
      const user = identity(req);
      if (!user) return bad(reply, 401, '请先登录账号');
      if (route.startsWith('/api/admin/users') && user.role !== 'superadmin')
        return bad(reply, 403, '仅最高管理员可以管理用户');
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { code?: string; statusCode?: number; validation?: unknown };
    if (error instanceof AttachmentError) return bad(reply, error.status, error.message);
    if (err.validation || err.statusCode === 400)
      return bad(reply, 400, '输入格式不正确，请检查后重试');
    if (err.statusCode === 413) return bad(reply, 413, '内容过长，请缩短后重试');
    const code = (err as Error & { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE')
      return bad(
        reply,
        409,
        req.routeOptions.url?.startsWith('/api/admin/users')
          ? '用户名已存在'
          : '访问码已被占用，请换一个',
      );
    if (code === 'SQLITE_BUSY') return bad(reply, 503, '服务繁忙，请稍后重试');
    req.log.error({ err: { name: err.name, code } }, 'Request failed');
    return bad(reply, 503, '服务暂时不可用，请稍后重试');
  });
  app.get('/api/health', () => ({ ok: true }));
  app.post(
    '/api/share/resolve',
    { schema: { body: obj({ code: str(100, 0) }, ['code']) } },
    async (req, reply) => {
      const code = (req.body as { code: string }).code.trim();
      if (!new RegExp(codePattern).test(code))
        return bad(reply, 400, '请输入恰好四位字母或数字，注意大小写');
      const row =
        o.publicRead === false
          ? undefined
          : (db
              .prepare(
                'SELECT id,body,version,updated_at FROM shares WHERE code=? COLLATE BINARY AND enabled=1',
              )
              .get(code) as Pick<Row, 'id' | 'body' | 'version' | 'updated_at'> | undefined);
      if (!row) return bad(reply, 404, '访问码无效或内容不可用');
      const attachment = attachments.current(row.id);
      return {
        body: row.body,
        updated_at: row.updated_at,
        ...(attachment && { attachment: attachments.publicInfo(attachment, row.id, row.version) }),
      };
    },
  );
  app.get('/api/share/attachment/:id', (req, reply) => {
    if (o.publicRead === false) return bad(reply, 404, '附件不可用，请重新输入访问码');
    const { id } = req.params as { id: string };
    return attachments.download(
      id,
      (req.query as { ticket?: string }).ticket,
      req.headers.range,
      reply,
    );
  });
  await app.register(async (uploads) => {
    // Keep the stream parser and enlarged upload limit scoped to the one authenticated route.
    uploads.addContentTypeParser('application/octet-stream', (_, payload, done) =>
      done(null, payload),
    );
    uploads.post(uploadPath, async (req, reply) => {
      const user = identity(req)!;
      const uploaded = await attachments.upload(
        req.body as Readable,
        req.headers['x-textrelay-filename'],
        req.headers['content-length'],
        user.id,
        () => identity(req)?.id === user.id && !req.raw.aborted,
      );
      return reply.code(201).send(uploaded);
    });
  });
  app.delete('/api/admin/attachments/:id', { schema: { body: obj({}) } }, (req, reply) => {
    const done = attachments.discard((req.params as { id: string }).id, identity(req)!.id);
    return done === undefined
      ? bad(reply, 404, '附件不存在')
      : { ok: true, ...(!done && { cleanupPending: true }) };
  });
  app.post('/api/admin/attachments/cleanup', { schema: { body: obj({}) } }, (req) => {
    const done = attachments.cleanOwner(identity(req)!.id);
    return { ok: true, ...(!done && { cleanupPending: true }) };
  });
  app.post(
    '/api/auth/login',
    { schema: { body: obj({ username: str(100), password: str(256) }, ['username', 'password']) } },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      const admin = db
        .prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE')
        .get(username) as
        | { id: number; username: string; password_hash: string; version: number; role: string }
        | undefined;
      // Compute the same expensive hash for unknown usernames.
      const hash = admin?.password_hash ?? (await hashPassword('unconfigured-account-placeholder'));
      const valid = await verifyPassword(password, hash);
      if (!admin || !valid) return bad(reply, 401, '账号或密码不正确');
      const token = randomBytes(32).toString('hex'),
        expires = now() + 8 * 60 * 60 * 1000;
      const created = db.transaction(() => {
        const current = db
          .prepare('SELECT password_hash,version FROM users WHERE id=?')
          .get(admin.id) as { password_hash: string; version: number } | undefined;
        if (current?.password_hash !== hash || current.version !== admin.version) return false;
        db.prepare('DELETE FROM user_sessions WHERE expires_at<=?').run(now());
        db.prepare('INSERT INTO user_sessions VALUES(?,?,?,?)').run(
          digest(token),
          expires,
          now(),
          admin.id,
        );
        return true;
      })();
      if (!created) return bad(reply, 401, '账号或密码已更新，请重新登录');
      reply.setCookie('tr_session_v2', token, { ...cookieOptions, maxAge: 8 * 60 * 60 });
      return { username: admin.username, role: admin.role, expires_at: expires };
    },
  );
  app.get('/api/auth/session', (req) => {
    const u = identity(req)!;
    return { username: u.username, role: u.role, expires_at: u.expires_at };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    db.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(
      digest(req.cookies.tr_session_v2!),
    );
    reply.clearCookie('tr_session_v2', cookieOptions);
    return { ok: true };
  });
  app.post(
    '/api/auth/password',
    {
      schema: {
        body: obj({ currentPassword: str(256), newPassword: str(256, 6) }, [
          'currentPassword',
          'newPassword',
        ]),
      },
    },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      const logged = identity(req)!;
      const admin = db.prepare('SELECT password_hash FROM users WHERE id=?').get(logged.id) as {
        password_hash: string;
      };
      if (!(await verifyPassword(currentPassword, admin.password_hash)))
        return bad(reply, 401, '当前密码不正确');
      const hash = await hashPassword(newPassword);
      const changed = db.transaction(() => {
        const current = db.prepare('SELECT password_hash FROM users WHERE id=?').get(logged.id) as {
          password_hash: string;
        };
        const session = db
          .prepare('SELECT token_hash FROM user_sessions WHERE token_hash=? AND expires_at>?')
          .get(digest(req.cookies.tr_session_v2!), now());
        if (!current || current.password_hash !== admin.password_hash || !session) return false;
        db.prepare(
          'UPDATE users SET password_hash=?,updated_at=?,version=version+1 WHERE id=?',
        ).run(hash, now(), logged.id);
        db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(logged.id);
        return true;
      })();
      if (!changed) return bad(reply, 401, '登录状态已更新，请重新登录');
      reply.clearCookie('tr_session_v2', cookieOptions);
      return { ok: true };
    },
  );
  function list(owner: number, data: { page?: number; q?: string; status?: string }) {
    const requestedPage = data.page ?? 1,
      q = data.q ?? '',
      status = data.status ?? 'all';
    const where =
      "WHERE owner_id=? AND (?='' OR instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0 OR code=? COLLATE BINARY) AND (?='all' OR enabled=?)";
    const args = [owner, q, q, q, q, status, status === 'enabled' ? 1 : 0];
    const total = (
      db.prepare('SELECT count(*) n FROM shares ' + where).get(...args) as { n: number }
    ).n;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / 20)));
    const rows = db
      .prepare('SELECT * FROM shares ' + where + ' ORDER BY updated_at DESC,id LIMIT 20 OFFSET ?')
      .all(...args, (page - 1) * 20) as Row[];
    return { items: rows.map(toShare), total, page, pages: Math.max(1, Math.ceil(total / 20)) };
  }
  app.get(
    '/api/admin/shares',
    { schema: { querystring: obj({ page: { type: 'string', pattern: '^[1-9][0-9]{0,4}$' } }) } },
    (req) => list(identity(req)!.id, { page: Number((req.query as { page?: string }).page ?? 1) }),
  );
  app.post('/api/admin/shares/search', { schema: { body: query } }, (req) =>
    list(identity(req)!.id, req.body as any),
  );
  app.get('/api/admin/shares/:id', async (req, reply) => {
    const r = db
      .prepare('SELECT * FROM shares WHERE id=? AND owner_id=?')
      .get((req.params as { id: string }).id, identity(req)!.id) as Row | undefined;
    return r ? toShare(r) : bad(reply, 404, '内容不存在');
  });
  const content = {
    title: str(120),
    body: str(102400, 0),
    enabled: { type: 'boolean' },
    attachmentId: attachmentIdSchema,
  };
  function stagedAttachment(id: string | null | undefined, owner: number) {
    if (!id) return undefined;
    const file = attachments.staged(id, owner);
    if (!file) throw new AttachmentError(404, '附件不可用或上传暂存已过期，请重新选择文件');
    return file;
  }
  function requireShareContent(body: string, hasAttachment: boolean) {
    if (!body.length && !hasAttachment) throw new AttachmentError(400, '请填写正文或添加一个附件');
  }
  function validateContent(data: { title?: string; body?: string }, reply: any) {
    if (data.title !== undefined && !data.title.trim()) {
      bad(reply, 400, '请填写标题');
      return false;
    }
    if (data.body !== undefined && Buffer.byteLength(data.body, 'utf8') > 102400) {
      bad(reply, 400, '正文不能超过 100 KiB');
      return false;
    }
    return true;
  }
  const insert = db.prepare(
    'INSERT INTO shares(id,title,body,code,enabled,version,created_at,updated_at,owner_id) VALUES(?,?,?,?,?,1,?,?,?)',
  );
  app.post(
    '/api/admin/shares',
    {
      schema: {
        body: obj({ ...content, code: { type: 'string', pattern: codePattern } }, [
          'title',
          'body',
          'enabled',
        ]),
      },
    },
    async (req, reply) => {
      const data = req.body as {
        title: string;
        body: string;
        enabled: boolean;
        code?: string;
        attachmentId?: string;
      };
      if (!validateContent(data, reply)) return;
      const id = randomUUID(),
        owner = identity(req)!.id;
      for (let i = 0; i < 30; i++)
        try {
          const created = db
            .transaction(() => {
              const file = stagedAttachment(data.attachmentId, owner);
              requireShareContent(data.body, Boolean(file));
              insert.run(
                id,
                data.title,
                data.body,
                data.code ?? randomCode(),
                +data.enabled,
                now(),
                now(),
                owner,
              );
              if (file) attachments.attach(id, file.id);
              return toShare(
                db.prepare('SELECT * FROM shares WHERE id=? AND owner_id=?').get(id, owner) as Row,
              );
            })
            .immediate();
          return reply.code(201).send(created);
        } catch (e) {
          if (data.code || (e as any).code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e;
        }
      return bad(reply, 503, '暂时无法生成可用访问码，请稍后重试');
    },
  );
  app.patch(
    '/api/admin/shares/:id',
    { schema: { body: obj({ ...content, version }, ['version']) } },
    async (req, reply) => {
      const data = req.body as {
        title?: string;
        body?: string;
        enabled?: boolean;
        version: number;
        attachmentId?: string | null;
      };
      if (!validateContent(data, reply)) return;
      const owner = identity(req)!.id;
      const result = db
        .transaction(() => {
          const row = db
            .prepare('SELECT * FROM shares WHERE id=? AND owner_id=?')
            .get((req.params as { id: string }).id, identity(req)!.id) as Row | undefined;
          if (!row) return bad(reply, 404, '内容不存在');
          if (row.version !== data.version)
            return bad(reply, 409, '内容已在其他窗口更新，请重新加载');
          const file = stagedAttachment(data.attachmentId, owner);
          const hasFile =
            data.attachmentId === undefined ? Boolean(attachments.current(row.id)) : Boolean(file);
          requireShareContent(data.body ?? row.body, hasFile);
          if (data.attachmentId !== undefined) {
            attachments.remove(row.id);
            if (file) attachments.attach(row.id, file.id);
          }
          db.prepare(
            'UPDATE shares SET title=?,body=?,enabled=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?',
          ).run(
            data.title ?? row.title,
            data.body ?? row.body,
            data.enabled === undefined ? row.enabled : +data.enabled,
            now(),
            row.id,
            identity(req)!.id,
          );
          return toShare(
            db
              .prepare('SELECT * FROM shares WHERE id=? AND owner_id=?')
              .get(row.id, identity(req)!.id) as Row,
          );
        })
        .immediate();
      if (reply.sent) return;
      const cleaned = attachments.cleanOwner(owner);
      return cleaned ? result : { ...result, cleanupPending: true };
    },
  );
  app.post(
    '/api/admin/shares/:id/rotate-code',
    {
      schema: {
        body: obj({ code: { type: 'string', pattern: codePattern }, version }, ['version']),
      },
    },
    async (req, reply) => {
      const data = req.body as { code?: string; version: number };
      return db.transaction(() => {
        const row = db
          .prepare('SELECT * FROM shares WHERE id=? AND owner_id=?')
          .get((req.params as { id: string }).id, identity(req)!.id) as Row | undefined;
        if (!row) return bad(reply, 404, '内容不存在');
        if (row.version !== data.version)
          return bad(reply, 409, '内容已在其他窗口更新，请重新加载');
        if (data.code === row.code) return bad(reply, 400, '新访问码需要与当前访问码不同');
        for (let i = 0; i < 30; i++) {
          const code = data.code ?? randomCode();
          if (code === row.code) continue;
          try {
            db.prepare(
              'UPDATE shares SET code=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?',
            ).run(code, now(), row.id, identity(req)!.id);
            return toShare(
              db
                .prepare('SELECT * FROM shares WHERE id=? AND owner_id=?')
                .get(row.id, identity(req)!.id) as Row,
            );
          } catch (e) {
            if (data.code || (e as any).code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e;
          }
        }
        return bad(reply, 503, '暂时无法生成可用访问码');
      })();
    },
  );
  app.delete(
    '/api/admin/shares/:id',
    { schema: { body: obj({ version }, ['version']) } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id,
        { version: v } = req.body as { version: number };
      const owner = identity(req)!.id;
      db.transaction(() => {
        const row = db
          .prepare('SELECT version FROM shares WHERE id=? AND owner_id=?')
          .get(id, identity(req)!.id) as { version: number } | undefined;
        if (!row) return bad(reply, 404, '内容不存在');
        if (row.version !== v) return bad(reply, 409, '内容已在其他窗口更新，请重新加载');
        db.prepare('DELETE FROM shares WHERE id=? AND owner_id=?').run(id, owner);
      }).immediate();
      if (reply.sent) return;
      const cleaned = attachments.cleanOwner(owner);
      return { ok: true, ...(!cleaned && { cleanupPending: true }) };
    },
  );
  const userFields = 'id,username,role,version,created_at,updated_at';
  const userId = (req: any) => Number(req.params.id);
  app.get('/api/admin/users', () => ({
    items: db.prepare(`SELECT ${userFields} FROM users ORDER BY id`).all(),
  }));
  app.get('/api/admin/users/:id', (req, reply) => {
    const user = db.prepare(`SELECT ${userFields} FROM users WHERE id=?`).get(userId(req));
    return user ?? bad(reply, 404, '用户不存在');
  });
  app.post(
    '/api/admin/users',
    {
      schema: {
        body: obj({ username: str(100), password: str(256, 6) }, ['username', 'password']),
      },
    },
    async (req, reply) => {
      const data = req.body as { username: string; password: string };
      const username = data.username.trim();
      if (!username) return bad(reply, 400, '请填写用户名');
      const hash = await hashPassword(data.password);
      const created = db.transaction(() => {
        if (identity(req)?.role !== 'superadmin') return undefined;
        const result = db
          .prepare(
            "INSERT INTO users(username,password_hash,role,created_at,updated_at) VALUES(?,?,'user',?,?)",
          )
          .run(username, hash, now(), now());
        return db.prepare(`SELECT ${userFields} FROM users WHERE id=?`).get(result.lastInsertRowid);
      })();
      if (!created) return bad(reply, 401, '登录状态已更新，请重新登录');
      return reply.code(201).send(created);
    },
  );
  app.patch(
    '/api/admin/users/:id',
    { schema: { body: obj({ username: str(100), password: str(256, 6), version }, ['version']) } },
    async (req, reply) => {
      const id = userId(req);
      if (id === 1) return bad(reply, 403, '最高管理员账号受保护，请通过修改密码管理自己的密码');
      const data = req.body as { username?: string; password?: string; version: number };
      if (data.username !== undefined && !data.username.trim())
        return bad(reply, 400, '请填写用户名');
      const hash = data.password === undefined ? undefined : await hashPassword(data.password);
      return db.transaction(() => {
        if (identity(req)?.role !== 'superadmin')
          return bad(reply, 401, '登录状态已更新，请重新登录');
        const row = db.prepare('SELECT * FROM users WHERE id=?').get(id) as
          | { username: string; password_hash: string; version: number }
          | undefined;
        if (!row) return bad(reply, 404, '用户不存在');
        if (row.version !== data.version) return bad(reply, 409, '账号已被更新，请重新加载');
        db.prepare(
          'UPDATE users SET username=?,password_hash=?,version=version+1,updated_at=? WHERE id=?',
        ).run(data.username?.trim() ?? row.username, hash ?? row.password_hash, now(), id);
        db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
        return db.prepare(`SELECT ${userFields} FROM users WHERE id=?`).get(id);
      })();
    },
  );
  app.delete(
    '/api/admin/users/:id',
    { schema: { body: obj({ version }, ['version']) } },
    (req, reply) => {
      const id = userId(req);
      if (id === 1) return bad(reply, 403, '不能删除最高管理员');
      db.transaction(() => {
        const row = db.prepare('SELECT version FROM users WHERE id=?').get(id) as
          | { version: number }
          | undefined;
        if (!row) return bad(reply, 404, '用户不存在');
        if (row.version !== (req.body as { version: number }).version)
          return bad(reply, 409, '账号已被更新，请重新加载');
        db.prepare('DELETE FROM users WHERE id=?').run(id);
      }).immediate();
      if (reply.sent) return;
      const cleaned = attachments.cleanOwner(id);
      return { ok: true, ...(!cleaned && { cleanupPending: true }) };
    },
  );
  if (existsSync(staticRoot + '/index.html')) {
    await app.register(fastifyStatic, { root: staticRoot, index: false });
    for (const path of ['/', '/manage', '/manage/', '/manage/login'])
      app.get(path, (_, reply) => reply.sendFile('index.html'));
  }
  app.setNotFoundHandler((_, reply) => bad(reply, 404, '页面或接口不存在'));
  return app;
}
