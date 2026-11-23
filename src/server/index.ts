import { resolve } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
try {
  process.loadEnvFile('.env');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN)
  throw Error('生产环境必须配置 APP_ORIGIN');
const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const databasePath = process.env.DATABASE_PATH ?? './data/textrelay.db';
const db = openDb(databasePath);
const app = await createApp({
  db,
  attachmentDir: process.env.ATTACHMENT_DIR || resolve(databasePath + '.attachments'),
  origin,
  secure: process.env.COOKIE_SECURE !== 'false',
  publicRead: process.env.PUBLIC_READ_ENABLED !== 'false',
  trustedProxy: process.env.TRUSTED_PROXY?.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimit: process.env.NODE_ENV !== 'test',
  logger: true,
});
const cleanup = setInterval(
  () => db.prepare('DELETE FROM user_sessions WHERE expires_at<=?').run(Date.now()),
  60000,
);
cleanup.unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(cleanup);
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
