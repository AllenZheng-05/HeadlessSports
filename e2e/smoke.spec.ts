import { expect, test } from '@playwright/test';

test('app loads with no console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`pageerror: ${err.message}`);
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Headless Sports');

  expect(problems).toEqual([]);
});
