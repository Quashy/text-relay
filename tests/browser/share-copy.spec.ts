import { test, expect, type Page } from '@playwright/test';
import { openBrowserDb } from './fixture';
import { hashPassword } from '../../src/server/security.js';

const password = 'clipboard-test-only-password';
let username = 'copy-owner';
test.beforeEach(async () => {
  const db = openBrowserDb();
  db.prepare('DELETE FROM user_sessions').run();
  db.prepare('DELETE FROM users WHERE id<>1').run();
  db.prepare('DELETE FROM shares').run();
  const root = db.prepare('SELECT username FROM users WHERE id=1').get() as
    | { username: string }
    | undefined;
  if (root) {
    username = root.username;
    db.prepare('UPDATE users SET password_hash=? WHERE id=1').run(await hashPassword(password));
  } else
    db.prepare(
      "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,?,?,'superadmin',0,0)",
    ).run(username, await hashPassword(password));
  db.prepare(
    "INSERT INTO shares VALUES('copy-seed','Existing share','Body stays plain','Ab12',1,1,0,0,1)",
  ).run();
  db.close();
});

async function login(page: any) {
  await page.goto('/manage');
  await page.locator('[name=username]').fill(username);
  await page.locator('[name=password]').fill(password);
  await page.locator('.login-card .primary').click();
  await expect(page.locator('.share-row')).toHaveCount(1);
}
async function prepare(page: any, manual?: string) {
  await page.locator('.dashboard-top .primary').click();
  await page.locator('#title').fill('New copied share');
  await page.locator('#body').fill('Body stays separate from the sharing message');
  if (manual) {
    await page.getByRole('radio', { name: '自定义', exact: true }).click();
    await page.locator('#new-code').fill(manual);
  }
}
const message = (page: Page, code: string, title = 'New copied share') =>
  `标题：${title}\n地址：${new URL('/', page.url()).href}\n访问码：${code}`;

for (const mobile of [false, true])
  test.describe(mobile ? 'touch mobile' : 'desktop', () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    test('creation copies the actual returned code during activation; list copies the same three lines; edit does not copy', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await login(page);
      await page.evaluate(() => {
        const state = window as any;
        state.copyTexts = [];
        const write = navigator.clipboard.write.bind(navigator.clipboard);
        const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.write = (items) => {
          state.writeActivation = navigator.userActivation.isActive;
          state.startedBeforeResponse = !state.createResponseDelivered;
          const result = write(items);
          void items[0]
            .getType('text/plain')
            .then((b) => b.text())
            .then((text) => state.copyTexts.push(text));
          return result;
        };
        navigator.clipboard.writeText = (text) => {
          state.copyTexts.push(text);
          return writeText(text);
        };
      });
      await page.route('**/api/admin/shares', async (route) => {
        const response = await route.fetch();
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          (window as any).createResponseDelivered = true;
        });
        await route.fulfill({ response });
      });
      await prepare(page);
      await page.getByRole('button', { name: '创建分享', exact: true }).click();
      const row = page.locator('.share-row').filter({ hasText: 'New copied share' });
      await expect(row).toBeVisible();
      const code = (await row.locator('.row-code:visible code').textContent())!;
      const expected = message(page, code);
      await expect(page.locator('.toast')).toContainText('链接和访问码已复制');
      expect(await page.evaluate(() => (window as any).writeActivation)).toBe(true);
      expect(await page.evaluate(() => (window as any).startedBeforeResponse)).toBe(true);
      expect(await page.evaluate(() => (window as any).copyTexts[0])).toBe(expected);
      const native = await page.evaluate(() => navigator.clipboard.readText());
      expect([expected, expected.replace(/\n/g, '\r\n')]).toContain(native);
      await row.getByRole('button', { name: '复制分享链接和访问码 ' + code, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).copyTexts.at(-1))).toBe(expected);
      await page.getByRole('button', { name: '复制分享链接和访问码 Ab12', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => (window as any).copyTexts.at(-1)))
        .toBe(message(page, 'Ab12', 'Existing share'));
      await page.evaluate(() => navigator.clipboard.writeText('keep on edit'));
      await row.getByRole('button', { name: '编辑', exact: true }).click();
      await page.locator('#title').fill('Edited without copying');
      await page.getByRole('button', { name: '保存更改', exact: true }).click();
      await expect(
        page.locator('.share-row').filter({ hasText: 'Edited without copying' }),
      ).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('keep on edit');
      const edited = page.locator('.share-row').filter({ hasText: 'Edited without copying' });
      await edited
        .getByRole('button', { name: '复制分享链接和访问码 ' + code, exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => (window as any).copyTexts.at(-1)))
        .toBe(message(page, code, 'Edited without copying'));
    });

    test('denied automatic and list copy give accurate selectable fallback; retry works', async ({
      page,
    }, testInfo) => {
      await login(page);
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            write: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
            writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
          },
        }),
      );
      await prepare(page, 'Cp01');
      await page.getByRole('button', { name: '创建分享', exact: true }).click();
      const fallback = page.getByRole('dialog', { name: '复制分享信息', exact: true });
      await expect(fallback).toBeVisible();
      await expect(fallback).toContainText('分享已创建');
      await expect(fallback).toContainText('未能写入剪贴板');
      await expect(page.locator('.toast')).toHaveCount(0);
      const field = page.getByRole('textbox', { name: '手动复制分享信息', exact: true });
      await expect(field).toHaveValue(message(page, 'Cp01'));
      await expect(field).toBeFocused();
      const selection = await field.evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]);
      expect(selection).toEqual([0, message(page, 'Cp01').length]);
      await fallback.getByRole('button', { name: '重试复制', exact: true }).click();
      await expect(fallback.getByRole('status')).toContainText('复制仍未成功');
      await page.screenshot({
        path: testInfo.outputPath(`share-copy-fallback-${mobile ? 'mobile' : 'desktop'}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await expect(fallback).toHaveCount(0);
      const button = page.getByRole('button', { name: '复制分享链接和访问码 Cp01', exact: true });
      await button.click();
      await expect(fallback).toBeVisible();
      await expect(field).toHaveValue(message(page, 'Cp01'));
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text: string) => {
              (window as any).retriedText = text;
            },
          },
        }),
      );
      await fallback.getByRole('button', { name: '重试复制', exact: true }).click();
      await expect(fallback).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).retriedText)).toBe(message(page, 'Cp01'));
      await expect(page.locator('.toast')).toContainText('链接和访问码已复制');
      await expect(button).toBeFocused();
    });
  });

test('missing Clipboard API keeps the successful share and all three lines available for manual copying', async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await prepare(page, 'Cp02');
  await page.getByRole('button', { name: '创建分享', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '手动复制分享信息' })).toHaveValue(
    message(page, 'Cp02'),
  );
  await page.getByRole('button', { name: '关闭复制窗口' }).click();
  await expect(page.locator('.share-row').filter({ hasText: 'New copied share' })).toBeVisible();
});

test('a failed create never copies a placeholder or reports success', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.evaluate(() => navigator.clipboard.writeText('unchanged clipboard'));
  await prepare(page, 'Ab12');
  await page.getByRole('button', { name: '创建分享', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新建分享', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('alert')).toContainText(/访问码.*占用/);
  await expect(page.getByRole('dialog', { name: '复制分享信息', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged clipboard');
  expect(errors).toEqual([]);
});

for (const allowed of [true, false])
  test(`writeText-only browser reports ${allowed ? 'success' : 'failure'} accurately`, async ({
    page,
  }) => {
    await login(page);
    await page.evaluate((allowed) => {
      Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (!allowed) throw new DOMException('activation expired', 'NotAllowedError');
            (window as any).legacyCopyText = text;
          },
        },
      });
    }, allowed);
    await prepare(page, 'Cp03');
    await page.getByRole('button', { name: '创建分享', exact: true }).click();
    if (allowed) {
      await expect(page.locator('.toast')).toContainText('链接和访问码已复制');
      expect(await page.evaluate(() => (window as any).legacyCopyText)).toBe(message(page, 'Cp03'));
    } else {
      await expect(page.getByRole('textbox', { name: '手动复制分享信息' })).toHaveValue(
        message(page, 'Cp03'),
      );
      await expect(page.locator('.toast')).toHaveCount(0);
    }
  });

for (const [from, to] of [
  [639, 641],
  [641, 639],
] as const) {
  test(`list copy fallback restores focus across breakpoint: ${from} to ${to}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: from, height: 844 });
    await login(page);
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      }),
    );

    const row = page.locator('.share-row').filter({ hasText: 'Existing share' });
    const copy = row.getByRole('button', { name: '复制分享链接和访问码 Ab12', exact: true });
    const fallback = page.getByRole('dialog', {
      name: '复制分享信息',
      exact: true,
      includeHidden: true,
    });
    const field = fallback.getByRole('textbox', { name: '手动复制分享信息', exact: true });
    await copy.press('Enter');
    await expect(field).toHaveValue(message(page, 'Ab12', 'Existing share'));
    await expect(field).toBeFocused();

    await page.setViewportSize({ width: to, height: 844 });
    await expect(fallback).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fallback).toHaveCount(0);
    await expect(copy).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeFocused();

    await copy.press('Enter');
    await expect(field).toBeFocused();
    await fallback.getByRole('button', { name: '关闭复制窗口', exact: true }).click();
    await expect(fallback).toHaveCount(0);
    await expect(copy).toBeFocused();
  });
}
