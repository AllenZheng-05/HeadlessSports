import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SCREENS: { name: string; query: string }[] = [
  { name: 'loading', query: 'screen=loading' },
  { name: 'gatefail', query: 'screen=gatefail' },
  { name: 'title', query: 'screen=title' },
  { name: 'camintro', query: 'screen=camintro' },
  { name: 'camerror', query: 'screen=camerror' },
  { name: 'menu', query: 'screen=menu' },
  { name: 'howto', query: 'screen=howto&debugkeys=1' },
  { name: 'calibration', query: 'screen=calibration' },
  { name: 'playing', query: 'screen=playing' },
  { name: 'pause', query: 'screen=pause&problem=step-back' },
  { name: 'results', query: 'screen=results&sport=4' },
];

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function resolved(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as unknown as { __ui: { resolved: string | null } }).__ui.resolved,
  );
}

for (const { name, query } of SCREENS) {
  test(`screen: ${name}`, async ({ page }) => {
    const problems = watchErrors(page);
    await page.goto(`/ui-harness.html?${query}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `e2e-ui/screenshots/${name}.png` });
    expect(problems).toEqual([]);
  });
}

const SCREENS_1080: { name: string; query: string }[] = [
  { name: 'title', query: 'screen=title&sport=4' },
  { name: 'menu', query: 'screen=menu&sport=4' },
  { name: 'results', query: 'screen=results&sport=4' },
  { name: 'playing', query: 'screen=playing' },
  { name: 'howto', query: 'screen=howto&debugkeys=1' },
  { name: 'calibration', query: 'screen=calibration' },
];

for (const { name, query } of SCREENS_1080) {
  test(`screen 1080p: ${name}`, async ({ page }) => {
    const problems = watchErrors(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/ui-harness.html?${query}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `e2e-ui/screenshots/${name}-1080.png` });
    expect(problems).toEqual([]);
  });
}

test('menu with eight sports fits', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=menu&n=8');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'e2e-ui/screenshots/menu-8.png' });
  const box = await page.locator('.card-menu').boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(720);
});

test('clicking Start on the title resolves', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=title');
  expect(await resolved(page)).toBeNull();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => resolved(page)).toBe('resolved');
});

test('keyboard Tab and Enter activate a menu card', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=menu');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const ids = ['climbing', 'bowling', 'batting', 'archery', 'javelin'];
  await expect.poll(() => resolved(page)).not.toBeNull();
  expect(ids).toContain(await resolved(page));
});

test('hand cursor: holding over a card selects it, leaving early does not', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=menu&hand=1');
  const card = page.locator('.sport-card[data-sport="archery"]');
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  // a new screen ignores the hand for 1.2 s and wants it seen outside every button first
  await page.mouse.move(6, 6);
  await page.waitForTimeout(1500);

  // move away before one second: nothing happens
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(700);
  await expect(card).toHaveClass(/hovered/);
  await page.mouse.move(6, 6);
  await page.waitForTimeout(900);
  expect(await resolved(page)).toBeNull();

  // hold for 1.3 s: selected
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(1300);
  expect(await resolved(page)).toBe('archery');
});

test('Escape on the how-to screen resolves back', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=howto');
  await page.keyboard.press('Escape');
  await expect.poll(() => resolved(page)).toBe('back');
});

test('the raised-fist event starts the how-to screen', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=howto&hand=pose');
  await page.keyboard.press('r');
  await expect.poll(() => resolved(page)).toBe('start');
});

test('gate fail Details toggle reveals the numbers', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=gatefail');
  const details = page.locator('#gate-details');
  await expect(details).toBeHidden();
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(details).toBeVisible();
  await expect(details).toContainText('14.2');
  await expect(details).toContainText('at least 24');
});

test('long banner stays clear of the score block and the table', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=playing&banner=Nice%20throw%2C%20keep%20going%20now');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'e2e-ui/screenshots/playing-longbanner.png' });
  const banner = await page.locator('.hud-banner').boundingBox();
  const score = await page.locator('.hud-topleft').boundingBox();
  const table = await page.locator('.hud-table-host').boundingBox();
  expect(banner).not.toBeNull();
  expect((banner?.x ?? 0) + (banner?.width ?? 0)).toBeLessThanOrEqual(table?.x ?? 0);
  expect(banner?.x ?? 0).toBeGreaterThanOrEqual((score?.x ?? 0) + (score?.width ?? 0));
});
