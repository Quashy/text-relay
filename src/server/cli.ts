import { openDb } from './db.js';
import { hashPassword } from './security.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, chmodSync, renameSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
try {
  process.loadEnvFile('.env');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const db = openDb(process.env.DATABASE_PATH ?? './data/textrelay.db');
const command = process.argv[2];
async function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw Error('密码必须在交互终端输入，不接受命令行或重定向');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const handler = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\u0003') {
          finish();
          reject(Error('已取消'));
          return;
        }
        if (c === '\r' || c === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (c === '\u007f') {
          value = value.slice(0, -1);
        } else if (c >= ' ') value += c;
      }
    };
    function finish() {
      stdin.off('data', handler);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    }
    stdin.on('data', handler);
  });
}
try {
  if (command === 'init' || command === 'reset') {
    const exists = !!db.prepare('SELECT id FROM admin WHERE id=1').get();
    if (command === 'init' && exists) throw Error('管理员已存在；重置请使用 reset');
    if (command === 'reset' && !exists) throw Error('管理员尚未初始化');
    const rl = createInterface({ input: stdin, output: stdout });
    const username = command === 'init' ? (await rl.question('管理员用户名：')).trim() : '';
    rl.close();
    if (command === 'init' && (!username || username.length > 100))
      throw Error('用户名需要 1–100 个字符');
    const password = await secret('设置密码（12–256 个字符，不回显）：');
    if (password.length < 12 || password.length > 256) throw Error('密码长度需要 12–256 个字符');
    if (password !== (await secret('再次输入密码：'))) throw Error('两次密码不一致');
    const hash = await hashPassword(password);
    db.transaction(() => {
      if (command === 'init')
        db.prepare('INSERT INTO admin VALUES(1,?,?,?)').run(username, hash, Date.now());
      else
        db.prepare('UPDATE admin SET password_hash=?,updated_at=? WHERE id=1').run(
          hash,
          Date.now(),
        );
      db.prepare('DELETE FROM sessions').run();
    })();
    console.log('管理员已更新，所有旧会话已失效。');
  } else if (command === 'backup') {
    const target = resolve(
      process.argv[3] ??
        './backups/textrelay-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db',
    );
    if (existsSync(target) || existsSync(target + '.tmp')) throw Error('目标文件已存在');
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    await db.backup(target + '.tmp');
    const { default: Database } = await import('better-sqlite3');
    const check = new Database(target + '.tmp', { readonly: true });
    if (check.pragma('integrity_check', { simple: true }) !== 'ok')
      throw Error('快照完整性校验失败');
    check.close();
    chmodSync(target + '.tmp', 0o600);
    renameSync(target + '.tmp', target);
    const sha = createHash('sha256').update(readFileSync(target)).digest('hex');
    writeFileSync(
      target + '.json',
      JSON.stringify(
        { created_at: new Date().toISOString(), sha256: sha, schema: 1, app_version: '1.0.0' },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log('已生成一致性快照：' + target);
  } else if (command === 'clear-sessions') {
    db.prepare('DELETE FROM sessions').run();
    console.log('旧会话已清除。');
  } else
    throw Error(
      '用法：npm run admin -- init | reset | clear-sessions；npm run backup -- [目标路径]',
    );
} finally {
  db.close();
}
