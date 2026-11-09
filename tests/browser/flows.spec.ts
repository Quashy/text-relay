import { settleMotion } from './motion';
import { test, expect } from '@playwright/test';
import { openDb } from '../../src/server/db.js';
import { hashPassword } from '../../src/server/security.js';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const password = 'browser-test-only-password';
const body =
  '  项目协作小记\n\n1. 保留每一次换行。\n2. 让文字轻松抵达。\n\t<script>window.hacked=true</script>  \n';
test.beforeAll(async () => {
  const db = openDb('./data/acceptance.db');
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM admin').run();
  db.prepare('DELETE FROM shares').run();
  db.prepare('INSERT INTO admin VALUES(1,?,?,?)').run(
    'test-owner',
    await hashPassword(password),
    Date.now(),
  );
  const insert = db.prepare('INSERT INTO shares VALUES(?,?,?,?,?,1,?,?)');
  const samples = [
    ['项目协作小记', body, 'Ab12', 1],
    ['一段写给周一的灵感', '把复杂的事讲清楚，把简单的事做好。\n\n每一小步，都算数。', 'R7k2', 1],
    [
      '团队常用链接',
      '设计资料：https://example.com/design\n协作文档：https://example.com/docs',
      'L9m3',
      1,
    ],
    ['暂存的会议纪要', '这是暂停分享的示例内容。', 'N4c8', 0],
  ];
  for (const [title, text, code, enabled] of samples)
    insert.run(randomUUID(), title, text, code, enabled, Date.now(), Date.now());
  db.close();
  mkdirSync('docs/evidence', { recursive: true });
});
test.afterAll(() => {
  const db = openDb('./data/acceptance.db');
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM admin').run();
  db.close();
});
test('desktop public reading, exact clipboard and safe plain-text rendering', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让文字， 轻松抵达。' })).toBeVisible();
  expect(await page.locator('#access-code').getAttribute('autocapitalize')).toBe('none');
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/public-desktop.png', fullPage: true });
  await page.getByLabel('访问码 区分大小写').fill('Ab12');
  await page.getByRole('button', { name: '查看内容' }).click();
  await expect(page.locator('.plain-text')).toHaveText(body, { useInnerText: false });
  expect(await page.evaluate(() => 'hacked' in window)).toBe(false);
  expect(await page.locator('.plain-text').textContent()).toBe(body);
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text: string) => {
      (window as typeof window & { clipboardWriteInput?: string }).clipboardWriteInput = text;
      await writeText(text);
    };
  });
  await page.getByRole('button', { name: '复制全文' }).click();
  await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
  // The app must pass the original string unchanged to the Clipboard API.
  expect(
    await page.evaluate(
      () => (window as typeof window & { clipboardWriteInput?: string }).clipboardWriteInput,
    ),
  ).toBe(body);
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  // Windows native text clipboards can convert every LF to CRLF. Accept only
  // that exact conversion, never trim whitespace or normalize arbitrary CRs.
  const allowedClipboardValues =
    process.platform === 'win32' ? [body, body.replace(/\n/g, '\r\n')] : [body];
  expect(allowedClipboardValues).toContain(clipboardText);
  // Exercise an actual paste into a browser text field, including blank lines,
  // tabs, leading/trailing spaces, and the final newline.
  await page.evaluate(() => {
    const target = document.createElement('textarea');
    target.id = 'clipboard-paste-verification';
    document.body.append(target);
  });
  const pasteTarget = page.locator('#clipboard-paste-verification');
  await pasteTarget.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await expect(pasteTarget).toHaveValue(body);
  await pasteTarget.evaluate((element) => element.remove());
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/reader-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
async function login(page: any) {
  await page.goto('/manage/login');
  await page.getByLabel('账号', { exact: true }).fill('test-owner');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文字分享.' })).toBeVisible();
  await expect(page.locator('.share-row')).toHaveCount(4);
}
test('desktop admin create, edit, search, toggle, rotate, reuse and delete', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/manage-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '新建分享', exact: true }).first().click();
  await page.getByLabel('标题 仅在后台显示').fill('验收用分享');
  await page.getByRole('textbox', { name: /^正文/ }).fill('original\n  body');
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('访问码 四位字母或数字，区分大小写').fill('Ui01');
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '创建分享', exact: true }).click();
  const row = page.locator('.share-row').filter({ hasText: '验收用分享' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: /^正文/ }).fill('updated\n  body');
  await page.getByRole('button', { name: '保存更改' }).click();
  await expect(row).toContainText('updated');
  await page.getByRole('textbox', { name: '搜索分享' }).fill('Ui01');
  await expect(page.locator('.share-row')).toHaveCount(1);
  await row.getByRole('button', { name: '停用验收用分享', exact: true }).click();
  await expect(row.getByRole('button', { name: '启用验收用分享', exact: true })).toBeVisible();
  await row.getByRole('button', { name: '启用验收用分享', exact: true }).click();
  await row.getByRole('button', { name: '换码 验收用分享' }).click();
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('新访问码', { exact: true }).fill('Ui02');
  await page.getByRole('button', { name: '确认换码' }).click();
  await expect(page.locator('.share-row')).toHaveCount(0);
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(page.locator('.share-row')).toHaveCount(5);
  await row.getByRole('button', { name: '删除 验收用分享' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索分享' }).fill('无匹配项');
  await expect(page.getByText('没有找到相关文字')).toBeVisible();
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/search-empty.png', fullPage: true });
});
test('mobile layout, full-screen editor and keyboard dialog focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/manage-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '新建分享', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '新建分享' })).toBeVisible();
  await page.getByLabel('标题 仅在后台显示').fill('手机测试');
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/editor-mobile.png', fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '放弃更改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/');
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/public-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('访问码 区分大小写').fill('Ab12');
  await page.getByRole('button', { name: '查看内容' }).click();
  await expect(page.locator('.plain-text')).toBeVisible();
  await settleMotion(page);
  await page.screenshot({ path: 'docs/evidence/reader-mobile.png', fullPage: true });
});
test('search ignores stale replies after a newer query', async ({ page }) => {
  await login(page);
  await page.route('**/api/admin/shares/search', async (route) => {
    const data = route.request().postDataJSON();
    const response = await route.fetch();
    if (data.q === '项目') await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({ response });
  });
  const search = page.getByRole('textbox', { name: '搜索分享' });
  await search.fill('项目');
  await page.waitForTimeout(300);
  await search.fill('灵感');
  await expect(page.locator('.share-row')).toHaveCount(1);
  await expect(page.locator('.share-row')).toContainText('一段写给周一的灵感');
  await page.waitForTimeout(1000);
  await expect(page.locator('.share-row')).toContainText('一段写给周一的灵感');
});
test('narrow screen has no overflow, clipboard fallback, invalid code feedback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('访问码 区分大小写').fill('ab');
  await page.getByRole('button', { name: '查看内容' }).click();
  await expect(page.getByRole('alert')).toContainText('恰好四位');
  await page.getByLabel('访问码 区分大小写').fill('Ab12');
  await page.getByRole('button', { name: '查看内容' }).click();
  await expect(page.locator('.plain-text')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(Error('denied')) },
    });
  });
  await page.getByRole('button', { name: '复制全文' }).click();
  await expect(page.getByRole('status')).toContainText('手动复制');
  const selected = await page.getByRole('textbox', { name: '手动复制正文' }).evaluate((el) => ({
    value: (el as HTMLTextAreaElement).value,
    start: (el as HTMLTextAreaElement).selectionStart,
    end: (el as HTMLTextAreaElement).selectionEnd,
  }));
  expect(selected.value).toBe(body);
  expect(selected.start).toBe(0);
  expect(selected.end).toBe(body.length);
});

test('a delayed mutation reload uses the current search filters', async ({ page }) => {
  await login(page);
  await page.route('**/api/admin/shares/*', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '停用项目协作小记', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索分享' }).fill('灵感');
  await expect(page.locator('.share-row')).toHaveCount(1);
  await expect(page.locator('.share-row')).toContainText('一段写给周一的灵感');
  await page.waitForTimeout(1400);
  await expect(page.locator('.share-row')).toHaveCount(1);
  await expect(page.locator('.share-row')).toContainText('一段写给周一的灵感');
});
test('password change revokes sessions and logout returns to the login page', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByLabel('当前密码', { exact: true }).fill(password);
  await page.getByLabel('新密码（至少 12 位）', { exact: true }).fill('new-browser-test-password');
  await page.getByLabel('再次输入新密码', { exact: true }).fill('new-browser-test-password');
  await page.getByRole('button', { name: '保存密码' }).click();
  await expect(page.getByRole('alert')).toContainText('密码已更新');
  await page.getByLabel('账号', { exact: true }).fill('test-owner');
  await page.getByLabel('密码', { exact: true }).fill('new-browser-test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文字分享.' })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});
