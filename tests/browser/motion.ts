import type { Page } from '@playwright/test';
export async function settleMotion(page: Page) {
  await page.evaluate(async () => {
    await Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    );
  });
}
