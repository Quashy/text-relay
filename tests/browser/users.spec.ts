import { test, expect } from '@playwright/test';
import { openBrowserDb } from './fixture';
import { hashPassword } from '../../src/server/security.js';
import { settleMotion } from './motion';
const password = '123456';
test.beforeAll(async () => {
  const db = openBrowserDb();
  db.exec('DROP TRIGGER IF EXISTS protect_superadmin_identity');
  db.prepare(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,'quashy',?,'superadmin',0,0) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash",
  ).run(await hashPassword(password));
  db.prepare('DELETE FROM users WHERE id<>1').run();
  db.prepare('DELETE FROM shares').run();
  db.prepare('DELETE FROM user_sessions').run();
  db.prepare(
    "INSERT INTO shares VALUES('root-share','Root private','root content','Rt01',1,1,0,0,1)",
  ).run();
  db.close();
});
async function login(page: any, username: string, pw = password) {
  await page.goto('/manage');
  await page.locator('[name=username]').fill(username);
  await page.locator('[name=password]').fill(pw);
  await page.locator('.login-card .primary').click();
  await expect(page.locator('.dashboard')).toBeVisible();
}
test('superadmin user management, colleague private workspace, account edits and deletion', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'quashy');
  await page.getByRole('tab', { name: '用户管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
  await expect(page.getByText('不可删除或更名')).toBeVisible();
  const users = page.getByRole('table', { name: '用户列表' }).locator('tbody').getByRole('row');
  await page.getByRole('button', { name: '新建用户', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建用户', exact: true });
  await expect(page.locator('#account-username')).toBeFocused();
  await page.locator('#account-username').fill('colleague-test');
  await expect(page.locator('#account-password')).toHaveAttribute('minlength', '6');
  await page.locator('#account-password').fill('12345');
  await page.locator('#account-confirm').fill('12345');
  expect(
    await page
      .locator('#account-password')
      .evaluate((input: HTMLInputElement) => input.validity.tooShort),
  ).toBe(true);
  await form.getByRole('button', { name: '保存用户', exact: true }).click();
  await expect(form).toBeVisible();
  await expect(page.locator('table[aria-label="用户列表"] tbody > tr')).toHaveCount(1);
  await page.locator('#account-password').fill(password);
  await page.locator('#account-confirm').fill(password);
  await form.getByRole('button', { name: '保存用户', exact: true }).click();
  await expect(form).toHaveCount(0);
  const row = users.filter({ hasText: 'colleague-test' });
  await expect(row).toBeVisible();
  await settleMotion(page);
  await page.screenshot({ path: testInfo.outputPath('users-desktop.png'), fullPage: true });
  const context = await browser.newContext();
  const colleague = await context.newPage();
  await colleague.setViewportSize({ width: 390, height: 844 });
  await login(colleague, 'colleague-test');
  await expect(colleague.getByRole('tab', { name: '用户管理', exact: true })).toHaveCount(0);
  await expect(colleague.locator('.share-row')).toHaveCount(0);
  await colleague.locator('.dashboard-top .primary').click();
  await colleague.locator('#title').fill('Colleague private');
  await colleague.locator('#body').fill('Only the colleague can manage this');
  await colleague.getByRole('radio', { name: '自定义', exact: true }).click();
  await colleague.locator('#new-code').fill('Co01');
  await colleague.getByRole('button', { name: '创建分享', exact: true }).click();
  await expect(colleague.locator('.share-row')).toHaveCount(1);
  await settleMotion(colleague);
  await colleague.screenshot({ path: testInfo.outputPath('colleague-mobile.png'), fullPage: true });
  await page.getByRole('tab', { name: '我的分享', exact: true }).click();
  await expect(page.locator('.share-row')).toHaveCount(1);
  await expect(page.locator('.share-row')).toContainText('Root private');
  await expect(page.locator('.share-row')).not.toContainText('Colleague private');
  await page.getByRole('tab', { name: '用户管理', exact: true }).click();
  await row.getByRole('button', { name: '编辑用户', exact: true }).click();
  await page.locator('#account-username').fill('colleague-renamed');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('alertdialog', { name: '放弃未保存的更改？', exact: true });
  await expect(discard.getByRole('button', { name: '继续编辑', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(discard).toHaveCount(0);
  await expect(page.locator('#account-username')).toHaveValue('colleague-renamed');
  await page.locator('#account-password').fill('12345');
  await page.locator('#account-confirm').fill('12345');
  expect(
    await page
      .locator('#account-password')
      .evaluate((input: HTMLInputElement) => input.validity.tooShort),
  ).toBe(true);
  await page.locator('#account-password').fill('654321');
  await page.locator('#account-confirm').fill('654321');
  await page
    .getByRole('dialog', { name: '编辑用户', exact: true })
    .getByRole('button', { name: '保存用户', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await colleague.reload();
  await expect(colleague.locator('.login-card')).toBeVisible();
  await login(colleague, 'colleague-renamed', '654321');
  await expect(colleague.locator('.share-row')).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 900 });
  await settleMotion(page);
  await page.screenshot({ path: testInfo.outputPath('users-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const deleteUser = page.getByRole('button', { name: '删除用户 colleague-renamed', exact: true });
  await deleteUser.click();
  const deletion = page.getByRole('alertdialog', { name: '删除用户', exact: true });
  await expect(deletion.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(deletion).toHaveCount(0);
  await expect(deleteUser).toBeFocused();
  await deleteUser.click();
  await expect(deletion.getByText(/全部分享和登录会话/)).toBeVisible();
  await expect(deletion.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await settleMotion(page);
  await page.screenshot({ path: testInfo.outputPath('delete-user-mobile.png') });
  await deletion.getByRole('button', { name: '删除账号及分享', exact: true }).click();
  await expect(deletion).toHaveCount(0);
  await expect(users).toHaveCount(1);
  await colleague.reload();
  await expect(colleague.locator('.login-card')).toBeVisible();
  await colleague.goto('/');
  await colleague.locator('#access-code').fill('Co01');
  await colleague.locator('.access-card .primary').click();
  await expect(colleague.getByRole('alert')).not.toBeEmpty();
  await context.close();
});
