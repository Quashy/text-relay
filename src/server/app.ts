import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Db } from './db.js';
import { digest, hashPassword, verifyPassword, randomCode, Limiter } from './security.js';
import type { Share } from '../shared/types.js';
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
const toShare = (r: Row): Share => ({ ...r, enabled: !!r.enabled });
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
  await app.register(cookie);
  const bad = (reply: any, status: number, message: string) => reply.code(status).send({ message });
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: o.secure ?? true,
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
        req.headers['content-type']?.split(';')[0] !== 'application/json'
      )
        return bad(reply, 403, '请求来源验证失败，请刷新后重试');
    }
    if (
      route.startsWith('/api/admin/') ||
      ['/api/auth/session', '/api/auth/logout', '/api/auth/password'].includes(route)
    ) {
      const token = req.cookies.tr_session;
      const session =
        token &&
        db
          .prepare('SELECT expires_at FROM sessions WHERE token_hash=? AND expires_at>?')
          .get(digest(token), now());
      if (!session) return bad(reply, 401, '请先登录管理员账号');
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { code?: string; statusCode?: number; validation?: unknown };
    if (err.validation || err.statusCode === 400)
      return bad(reply, 400, '输入格式不正确，请检查后重试');
    if (err.statusCode === 413) return bad(reply, 413, '内容过长，请缩短后重试');
    const code = (err as Error & { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') return bad(reply, 409, '访问码已被占用，请换一个');
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
          : db
              .prepare(
                'SELECT body,updated_at FROM shares WHERE code=? COLLATE BINARY AND enabled=1',
              )
              .get(code);
      return row ?? bad(reply, 404, '访问码无效或内容不可用');
    },
  );
  app.post(
    '/api/auth/login',
    { schema: { body: obj({ username: str(100), password: str(256) }, ['username', 'password']) } },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      const admin = db.prepare('SELECT * FROM admin WHERE id=1').get() as
        | { username: string; password_hash: string }
        | undefined;
      // Compute the same expensive hash for unknown usernames.
      const hash = admin?.password_hash ?? (await hashPassword('unconfigured-account-placeholder'));
      const valid = await verifyPassword(password, hash);
      if (!admin || admin.username !== username || !valid)
        return bad(reply, 401, '账号或密码不正确');
      const token = randomBytes(32).toString('hex'),
        expires = now() + 8 * 60 * 60 * 1000;
      const created = db.transaction(() => {
        const current = db.prepare('SELECT password_hash FROM admin WHERE id=1').get() as
          | { password_hash: string }
          | undefined;
        if (current?.password_hash !== hash) return false;
        db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), expires, now());
        return true;
      })();
      if (!created) return bad(reply, 401, '账号或密码已更新，请重新登录');
      reply.setCookie('tr_session', token, { ...cookieOptions, maxAge: 8 * 60 * 60 });
      return { username: admin.username, expires_at: expires };
    },
  );
  app.get('/api/auth/session', (req) => ({
    username: (db.prepare('SELECT username FROM admin WHERE id=1').get() as { username: string })
      .username,
    expires_at: (
      db
        .prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
        .get(digest(req.cookies.tr_session!)) as { expires_at: number }
    ).expires_at,
  }));
  app.post('/api/auth/logout', async (req, reply) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(req.cookies.tr_session!));
    reply.clearCookie('tr_session', cookieOptions);
    return { ok: true };
  });
  app.post(
    '/api/auth/password',
    {
      schema: {
        body: obj({ currentPassword: str(256), newPassword: str(256, 12) }, [
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
      const admin = db.prepare('SELECT password_hash FROM admin WHERE id=1').get() as {
        password_hash: string;
      };
      if (!(await verifyPassword(currentPassword, admin.password_hash)))
        return bad(reply, 401, '当前密码不正确');
      const hash = await hashPassword(newPassword);
      const changed = db.transaction(() => {
        const current = db.prepare('SELECT password_hash FROM admin WHERE id=1').get() as {
          password_hash: string;
        };
        const session = db
          .prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?')
          .get(digest(req.cookies.tr_session!), now());
        if (current.password_hash !== admin.password_hash || !session) return false;
        db.prepare('UPDATE admin SET password_hash=?,updated_at=? WHERE id=1').run(hash, now());
        db.prepare('DELETE FROM sessions').run();
        return true;
      })();
      if (!changed) return bad(reply, 401, '登录状态已更新，请重新登录');
      reply.clearCookie('tr_session', cookieOptions);
      return { ok: true };
    },
  );
  function list(data: { page?: number; q?: string; status?: string }) {
    const requestedPage = data.page ?? 1,
      q = data.q ?? '',
      status = data.status ?? 'all';
    const where =
      "WHERE (?='' OR instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0 OR code=? COLLATE BINARY) AND (?='all' OR enabled=?)";
    const args = [q, q, q, q, status, status === 'enabled' ? 1 : 0];
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
    (req) => list({ page: Number((req.query as { page?: string }).page ?? 1) }),
  );
  app.post('/api/admin/shares/search', { schema: { body: query } }, (req) => list(req.body as any));
  app.get('/api/admin/shares/:id', async (req, reply) => {
    const r = db
      .prepare('SELECT * FROM shares WHERE id=?')
      .get((req.params as { id: string }).id) as Row | undefined;
    return r ? toShare(r) : bad(reply, 404, '内容不存在');
  });
  const content = { title: str(120), body: str(102400), enabled: { type: 'boolean' } };
  function validateContent(data: { title?: string; body?: string }, reply: any) {
    if (data.title !== undefined && !data.title.trim()) {
      bad(reply, 400, '请填写标题');
      return false;
    }
    if (
      data.body !== undefined &&
      (Buffer.byteLength(data.body, 'utf8') > 102400 || data.body.length === 0)
    ) {
      bad(reply, 400, '正文须为 1 至 100 KiB 的纯文本');
      return false;
    }
    return true;
  }
  const insert = db.prepare(
    'INSERT INTO shares(id,title,body,code,enabled,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)',
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
      const data = req.body as { title: string; body: string; enabled: boolean; code?: string };
      if (!validateContent(data, reply)) return;
      const id = randomUUID();
      for (let i = 0; i < 30; i++)
        try {
          insert.run(
            id,
            data.title,
            data.body,
            data.code ?? randomCode(),
            +data.enabled,
            now(),
            now(),
          );
          return reply
            .code(201)
            .send(toShare(db.prepare('SELECT * FROM shares WHERE id=?').get(id) as Row));
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
      };
      if (!validateContent(data, reply)) return;
      return db.transaction(() => {
        const row = db
          .prepare('SELECT * FROM shares WHERE id=?')
          .get((req.params as { id: string }).id) as Row | undefined;
        if (!row) return bad(reply, 404, '内容不存在');
        if (row.version !== data.version)
          return bad(reply, 409, '内容已在其他窗口更新，请重新加载');
        db.prepare(
          'UPDATE shares SET title=?,body=?,enabled=?,version=version+1,updated_at=? WHERE id=?',
        ).run(
          data.title ?? row.title,
          data.body ?? row.body,
          data.enabled === undefined ? row.enabled : +data.enabled,
          now(),
          row.id,
        );
        return toShare(db.prepare('SELECT * FROM shares WHERE id=?').get(row.id) as Row);
      })();
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
          .prepare('SELECT * FROM shares WHERE id=?')
          .get((req.params as { id: string }).id) as Row | undefined;
        if (!row) return bad(reply, 404, '内容不存在');
        if (row.version !== data.version)
          return bad(reply, 409, '内容已在其他窗口更新，请重新加载');
        if (data.code === row.code) return bad(reply, 400, '新访问码需要与当前访问码不同');
        for (let i = 0; i < 30; i++) {
          const code = data.code ?? randomCode();
          if (code === row.code) continue;
          try {
            db.prepare('UPDATE shares SET code=?,version=version+1,updated_at=? WHERE id=?').run(
              code,
              now(),
              row.id,
            );
            return toShare(db.prepare('SELECT * FROM shares WHERE id=?').get(row.id) as Row);
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
      return db.transaction(() => {
        const row = db.prepare('SELECT version FROM shares WHERE id=?').get(id) as
          | { version: number }
          | undefined;
        if (!row) return bad(reply, 404, '内容不存在');
        if (row.version !== v) return bad(reply, 409, '内容已在其他窗口更新，请重新加载');
        db.prepare('DELETE FROM shares WHERE id=?').run(id);
        return { ok: true };
      })();
    },
  );
  const staticRoot = resolve(o.staticRoot ?? 'dist/client');
  if (existsSync(staticRoot + '/index.html')) {
    await app.register(fastifyStatic, { root: staticRoot, index: false });
    for (const path of ['/', '/manage', '/manage/', '/manage/login'])
      app.get(path, (_, reply) => reply.sendFile('index.html'));
  }
  app.setNotFoundHandler((_, reply) => bad(reply, 404, '页面或接口不存在'));
  return app;
}
