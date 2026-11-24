import { settleMotion } from './motion';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { openBrowserDb } from './fixture';
import { hashPassword } from '../../src/server/security.js';
const password = 'contrast-test-only-password';
test.beforeAll(async () => {
  const db = openBrowserDb();
  db.exec('DROP TRIGGER IF EXISTS protect_superadmin_identity');
  db.prepare('DELETE FROM user_sessions').run();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(1,?,?,'superadmin',0,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,updated_at=excluded.updated_at",
  ).run('contrast-owner', await hashPassword(password), Date.now());
  db.prepare('DELETE FROM shares').run();
  db.prepare('INSERT INTO shares VALUES(?,?,?,?,?,1,?,?,1)').run(
    'contrast-fixture',
    'Contrast sample',
    'A plain text sample',
    'Ab12',
    1,
    Date.now(),
    Date.now(),
  );
  db.close();
});
async function contrast(page: Page) {
  const failures = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const over = (fg: number[], bg: number[]) => {
      const a = fg[3] / 255;
      return fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    };
    const lum = (c: number[]) =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
    const failures: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (
        !Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
        ) ||
        el.closest('svg,script,style,[disabled],[aria-hidden=true],[inert]') ||
        !el.getClientRects().length
      )
        continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden') continue;
      const ancestors: Element[] = [];
      for (let p: Element | null = el; p; p = p.parentElement) ancestors.unshift(p);
      let bg = [255, 255, 255];
      for (const p of ancestors) bg = over(rgba(getComputedStyle(p).backgroundColor), bg);
      const fg = over(rgba(style.color), bg);
      const a = lum(fg),
        b = lum(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        failures.push(`${el.tagName}.${el.className}: ${ratio.toFixed(2)} ${style.color} on ${bg}`);
    }
    return failures;
  });
  expect(failures).toEqual([]);
}
async function activeTransitionDuration(popup: Locator) {
  return popup.evaluate((el) => {
    const transition = el.getAnimations().find((animation) => animation instanceof CSSTransition);
    return Number(transition?.effect?.getTiming().duration ?? 0);
  });
}

async function scrollLock(page: Page) {
  return page.evaluate(() => [
    document.documentElement.style.overflow,
    document.body.style.overflow,
  ]);
}

async function owner(page: Page) {
  await page.goto('/manage');
  await page.locator('[name=username]').fill('contrast-owner');
  await page.locator('[name=password]').fill(password);
  await page.locator('.login-card .primary').click();
  await expect(page.locator('.dashboard')).toBeVisible();
}
for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1440, 320]) {
    test(`contrast and create modal: ${colorScheme}, ${width}px`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByRole('button', { name: '查看内容' })).toBeVisible();
      await contrast(page);
      await page.locator('#access-code').fill('Ab12');
      await page.locator('.access-card .primary').click();
      await expect(page.locator('.plain-text')).toBeVisible();
      await contrast(page);
      await page.goto('/manage');
      await expect(page.locator('.login-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await contrast(page);
      await page.locator('[name=username]').focus();
      await contrast(page);
      await page.locator('.login-card .primary').hover();
      await contrast(page);
      await settleMotion(page);
      await page.screenshot({
        path: testInfo.outputPath(`login-${width === 320 ? 'mobile' : 'desktop'}.png`),
        fullPage: true,
      });
      await owner(page);
      const initialScrollLock = await scrollLock(page);
      await contrast(page);
      const trigger = page.locator('.dashboard-top .primary');
      await trigger.click();
      const modal = page.getByRole('dialog', { name: /^(新建|编辑)分享$/ });
      await expect(modal).toBeVisible();
      await expect(modal).not.toHaveClass(/drawer/);
      const rect = await modal.boundingBox();
      expect(rect!.x).toBeGreaterThan(0);
      expect(Math.abs(rect!.x + rect!.width / 2 - width / 2)).toBeLessThan(2);
      expect(rect!.y).toBeGreaterThan(0);
      await expect(page.locator('#title')).toBeFocused();
      await contrast(page);
      await page.locator('#title').fill('Unsaved draft');
      const submit = modal.getByRole('button', { name: '创建分享', exact: true });
      await expect(submit).toBeInViewport({ ratio: 1 });
      const scroll = modal.locator('[data-slot=scroll-area-viewport]');
      await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(submit).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await settleMotion(page);
      await page.screenshot({
        path: testInfo.outputPath(`create-${width === 320 ? 'mobile' : 'desktop'}.png`),
      });
      if (width === 320) {
        await scroll.evaluate((el) => (el.scrollTop = 0));
        await submit.click();
        await expect(modal.getByRole('alert')).toBeInViewport({ ratio: 1 });
        await expect(submit).toBeInViewport({ ratio: 1 });
      }
      await page.keyboard.press('Escape');
      const discard = page.getByRole('alertdialog', { name: '放弃未保存的更改？', exact: true });
      await expect(discard).toBeVisible();
      await expect(discard.getByRole('heading')).toHaveText('放弃未保存的更改？');
      await expect(discard.locator('.secondary')).toBeFocused();
      await expect(discard).toHaveAttribute('aria-describedby', 'discard-description');
      await contrast(page);
      await settleMotion(page);
      await page.screenshot({
        path: testInfo.outputPath(`discard-${width === 320 ? 'mobile' : 'desktop'}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(discard).toHaveCount(0);
      await expect(page.locator('#title')).toHaveValue('Unsaved draft');
      await modal.locator('.drawer-header button').click();
      await page.locator('.danger-button').click();
      await expect(modal).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect.poll(() => scrollLock(page)).toEqual(initialScrollLock);
      const editTrigger = page.locator('.edit-button').first();
      await editTrigger.click();
      await expect(modal).toBeVisible();
      await expect(modal).not.toHaveClass(/drawer/);
      await expect(page.locator('#title')).toHaveValue('Contrast sample');
      await expect(page.locator('#body')).toHaveValue('A plain text sample');
      await expect(modal.locator('.existing-code code')).toHaveText('Ab12');
      await expect(page.locator('#title')).toBeFocused();
      await contrast(page);
      await settleMotion(page);
      const editRect = await modal.boundingBox();
      expect(Math.abs(editRect!.x + editRect!.width / 2 - width / 2)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`edit-${width === 320 ? 'mobile' : 'desktop'}.png`),
      });
      await page.locator('#title').fill('Unsaved edit');
      await page.keyboard.press('Escape');
      await expect(discard).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(discard).toHaveCount(0);
      await expect(page.locator('#title')).toHaveValue('Unsaved edit');
      await modal.locator('.drawer-header button').click();
      await page.locator('.danger-button').click();
      await expect(modal).toHaveCount(0);
      await expect(editTrigger).toBeFocused();
      await expect.poll(() => scrollLock(page)).toEqual(initialScrollLock);
      await editTrigger.click();
      await expect(page.locator('#title')).toHaveValue('Contrast sample');
      await expect(modal.locator('.existing-code code')).toHaveText('Ab12');
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      await page.getByRole('button', { name: '修改密码', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '修改密码', exact: true })).toBeVisible();
      await contrast(page);
      await page.keyboard.press('Escape');
    });
  }

for (const editorMode of ['new', 'edit'] as const)
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`modal motion lifecycle: ${editorMode}, ${reducedMotion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await owner(page);
      const initialScrollLock = await scrollLock(page);
      if (reducedMotion === 'no-preference') {
        const session = await page.context().newCDPSession(page);
        await session.send('Animation.enable');
        await session.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
      }
      const trigger = page
        .locator(editorMode === 'new' ? '.dashboard-top .primary' : '.edit-button')
        .first();
      await trigger.click();
      const modal = page.locator('.share-dialog');
      await expect(modal).toHaveCSS('width', '1024px');
      if (reducedMotion === 'no-preference') {
        await expect
          .poll(() => activeTransitionDuration(modal), { intervals: [16, 32, 64] })
          .toBeGreaterThan(0);
      } else {
        const hasMotion = await modal.evaluate((el) =>
          el
            .getAnimations()
            .some((animation) => Number(animation.effect?.getTiming().duration) > 1),
        );
        expect(hasMotion).toBe(false);
      }
      await expect(modal).toHaveCSS('opacity', '1');
      await modal.locator('.drawer-header button').click();
      if (reducedMotion === 'no-preference') {
        await expect(modal).toHaveAttribute('data-ending-style', '');
        await expect
          .poll(() => activeTransitionDuration(modal), { intervals: [16, 32, 64] })
          .toBeGreaterThan(0);
        // Changing the system setting mid-exit must still finish dismissal.
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      await expect(modal).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect.poll(() => scrollLock(page)).toEqual(initialScrollLock);
      await trigger.click();
      await expect(modal.locator('#title')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

for (const { width, reducedMotion } of [
  { width: 1440, reducedMotion: 'no-preference' },
  { width: 320, reducedMotion: 'reduce' },
] as const) {
  test(`delete confirmation returns keyboard focus: ${width}px, ${reducedMotion}`, async ({
    page,
  }) => {
    const firstTitle = '删除焦点样例 A';
    const lastTitle = '删除焦点样例 B';
    const firstId = 'delete-focus-first';
    const db = openBrowserDb();
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM shares WHERE owner_id=1').run();
        const insert = db.prepare('INSERT INTO shares VALUES(?,?,?,?,1,1,?,?,1)');
        insert.run(firstId, firstTitle, 'First synthetic share', 'Df01', 1, 1);
        insert.run('delete-focus-last', lastTitle, 'Last synthetic share', 'Df02', 2, 2);
      })();
    } finally {
      db.close();
    }

    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await owner(page);

    const rows = page.locator('.share-row');
    const newShare = page.locator('.dashboard-top').getByRole('button', { name: '新建分享' });
    const dialog = page.getByRole('alertdialog', {
      name: '删除这段分享？',
      exact: true,
      includeHidden: true,
    });
    const cancel = dialog.getByRole('button', { name: '取消', exact: true });
    const confirm = dialog.getByRole('button', { name: '确认删除', exact: true });
    const menuTrigger = (title: string) =>
      page.getByRole('button', { name: '更多操作 ' + title, exact: true });

    async function openDelete(title: string) {
      await menuTrigger(title).press('ArrowDown');
      const menu = page.getByRole('menu');
      const item = menu.getByRole('menuitem', { name: '删除 ' + title, exact: true });
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('End');
      await expect(item).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(title);
      await expect(cancel).toBeFocused();
    }

    async function cancelDelete(title: string) {
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(menuTrigger(title)).toBeFocused();
    }

    async function deleteAndRefresh(title: string, remaining: number) {
      await openDelete(title);
      let refreshStarted = false;
      const allowRefresh = Promise.withResolvers<void>();
      await page.route(
        '**/api/admin/shares/search',
        async (route) => {
          refreshStarted = true;
          await allowRefresh.promise;
          await route.continue();
        },
        { times: 1 },
      );
      try {
        await confirm.press('Enter');
        await expect.poll(() => refreshStarted).toBe(true);
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      } finally {
        allowRefresh.resolve();
      }
      await expect(dialog).toHaveCount(0);
      await expect(rows).toHaveCount(remaining);
      await expect(newShare).toBeFocused();
    }

    await expect(rows).toHaveCount(2);
    await openDelete(firstTitle);
    await cancelDelete(firstTitle);
    await expect(rows).toHaveCount(2);

    const failure = '暂时无法删除这段分享';
    await page.route(
      '**/api/admin/shares/' + firstId,
      async (route) => {
        expect(route.request().method()).toBe('DELETE');
        await route.fulfill({ status: 409, json: { message: failure } });
      },
      { times: 1 },
    );
    await openDelete(firstTitle);
    await confirm.press('Enter');
    const alert = dialog.getByRole('alert');
    await expect(alert).toHaveText(failure);
    await expect(alert).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await cancelDelete(firstTitle);
    await expect(rows).toHaveCount(2);

    await deleteAndRefresh(firstTitle, 1);
    await expect(menuTrigger(lastTitle)).toBeVisible();
    await deleteAndRefresh(lastTitle, 0);
    await expect(page.getByText('暂无分享', { exact: true })).toBeVisible();
  });
}
