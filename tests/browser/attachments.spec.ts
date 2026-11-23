import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { openDb } from '../../src/server/db.js';
import { hashPassword } from '../../src/server/security.js';

const password = 'attachments-browser-test-password';
const title = '小文件浏览器验收';
const filename = '中文 验收文件.md';
const bytes = Buffer.from('# TextRelay\n\n小文件浏览器验收\n');

test('desktop owner uploads and deletes; signed-out mobile visitor downloads the original file', async ({
  page,
  browser,
}) => {
  const db = openDb('./data/acceptance.db');
  let username: string;
  try {
    const root = db.prepare('SELECT username FROM users WHERE id=1').get() as
      | { username: string }
      | undefined;
    const hash = await hashPassword(password);
    username = root?.username ?? 'attachment-test-owner';
    if (root) db.prepare('UPDATE users SET password_hash=? WHERE id=1').run(hash);
    else
      db.prepare(
        "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,?,?,'superadmin',0,0)",
      ).run(username, hash);
  } finally {
    db.close();
  }

  await page.goto('/manage/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '新建分享', exact: true }).first().click();
  await page.locator('#title').fill(title);
  await page
    .locator('#share-file')
    .setInputFiles({ name: filename, mimeType: 'text/markdown', buffer: bytes });
  await page.getByRole('button', { name: '创建分享', exact: true }).click();
  const row = page.locator('.share-row').filter({ hasText: title });
  await expect(row).toBeVisible();
  const code = (await row.locator('.row-code code').textContent())!;
  const mobile = await browser.newContext({
    baseURL: 'http://localhost:3000',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const visitor = await mobile.newPage();
    await visitor.goto('/');
    await visitor.locator('#access-code').fill(code);
    await visitor.getByRole('button', { name: '查看内容' }).click();
    const link = visitor.getByRole('link', { name: /下载附件/ });
    await expect(link).toBeVisible();
    await expect(visitor.getByRole('button', { name: '复制全文' })).toHaveCount(0);
    const received = visitor.waitForEvent('download');
    await link.click();
    const download = await received;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await download.failure()).toBeNull();
    const localPath = await download.path();
    expect(await readFile(localPath)).toEqual(bytes);
  } finally {
    await mobile.close();
    await row.getByRole('button', { name: '删除 ' + title }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(row).toHaveCount(0);
  }
});
