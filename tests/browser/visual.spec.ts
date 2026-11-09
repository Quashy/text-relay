import { test, expect, type Page } from '@playwright/test';
import { openDb } from '../../src/server/db.js';
import { hashPassword } from '../../src/server/security.js';
const password = 'contrast-test-only-password';
test.beforeAll(async () => {
  const db = openDb('./data/acceptance.db');
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT OR REPLACE INTO admin VALUES(1,?,?,?)').run(
    'contrast-owner',
    await hashPassword(password),
    Date.now(),
  );
  db.prepare('DELETE FROM shares').run();
  db.prepare('INSERT INTO shares VALUES(?,?,?,?,?,1,?,?)').run(
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
    const rgba = (s: string) => (s.match(/[\d.]+/g) || []).map(Number);
    const over = (fg: number[], bg: number[]) => {
      const a = fg[3] ?? 1;
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
        el.closest('svg,script,style,[disabled]') ||
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
async function owner(page: Page) {
  await page.goto('/manage');
  await page.locator('[name=username]').fill('contrast-owner');
  await page.locator('[name=password]').fill(password);
  await page.locator('.login-card .primary').click();
  await expect(page.locator('.dashboard')).toBeVisible();
}
for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1440, 320]) {
    test(`contrast and create modal: ${colorScheme}, ${width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
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
      if (colorScheme === 'light')
        await page.screenshot({
          path: `docs/evidence/login-${width === 320 ? 'mobile' : 'desktop'}.png`,
          fullPage: true,
        });
      await owner(page);
      await contrast(page);
      const trigger = page.locator('.dashboard-top .primary');
      await trigger.click();
      const modal = page.locator('dialog.create-dialog');
      await expect(modal).toBeVisible();
      await expect(modal).not.toHaveClass(/drawer/);
      const rect = await modal.boundingBox();
      expect(rect!.x).toBeGreaterThan(0);
      expect(Math.abs(rect!.x + rect!.width / 2 - width / 2)).toBeLessThan(2);
      expect(rect!.y).toBeGreaterThan(0);
      await expect(page.locator('#title')).toBeFocused();
      await contrast(page);
      await page.locator('#title').fill('Unsaved draft');
      await page.locator('.drawer-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(modal.locator('.drawer-footer .primary')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (colorScheme === 'light')
        await page.screenshot({
          path: `docs/evidence/create-${width === 320 ? 'mobile' : 'desktop'}.png`,
        });
      await page.keyboard.press('Escape');
      const discard = page.getByRole('dialog', { name: '放弃未保存的更改', exact: true });
      await expect(discard).toBeVisible();
      await contrast(page);
      await page.keyboard.press('Escape');
      await expect(discard).toHaveCount(0);
      await expect(page.locator('#title')).toHaveValue('Unsaved draft');
      await modal.locator('.drawer-header button').click();
      await page.locator('.danger-button').click();
      await expect(modal).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      await page.locator('.edit-button').first().click();
      await expect(page.locator('dialog.drawer')).toBeVisible();
      await contrast(page);
      await page.keyboard.press('Escape');
      await page.locator('.account button').first().click();
      await expect(page.locator('dialog.modal')).toBeVisible();
      await contrast(page);
      await page.keyboard.press('Escape');
    });
  }
