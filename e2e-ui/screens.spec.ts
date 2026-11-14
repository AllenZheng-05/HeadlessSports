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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const CAMERA_SCREENS: { name: string; query: string; content: string }[] = [
  { name: 'menu-cam', query: 'screen=menu&cam=1', content: '.heading, .sport-card' },
  { name: 'menu-cam-8', query: 'screen=menu&n=8&cam=1', content: '.heading, .sport-card' },
  {
    name: 'howto-cam',
    query: 'screen=howto&debugkeys=1&cam=1&toggle=right',
    content: '.howto-swatch, .heading, .steps, .howto-side, .actions, .fist-hint',
  },
  {
    name: 'results-cam',
    query: 'screen=results&sport=4&cam=1',
    content: '.results-sport, .results-headline, .best-badge, .results-best, .actions',
  },
  { name: 'loading-cam', query: 'screen=loading&cancel=1&cam=1', content: '.brand, .loading-text' },
];

for (const { name, query, content } of CAMERA_SCREENS) {
  test(`camera indicator sits clear of the content: ${name}`, async ({ page }) => {
    const problems = watchErrors(page);
    await page.goto(`/ui-harness.html?${query}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `e2e-ui/screenshots/${name}.png` });
    await expect(page.locator('.camera-pill')).toHaveText('Camera on');
    await expect(page.locator('.camera-off')).toBeVisible();
    const indicator = (await page.locator('.camera-indicator').boundingBox()) as Box;
    expect(indicator).not.toBeNull();
    // Fully on the page, at 1280x720.
    expect(indicator.x).toBeGreaterThanOrEqual(0);
    expect(indicator.y).toBeGreaterThanOrEqual(0);
    const boxes = await page.locator(content).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(overlaps(indicator, box)).toBe(false);
    expect(problems).toEqual([]);
  });
}

test('the camera indicator is absent on menus when the camera is off', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=menu');
  await page.waitForTimeout(400);
  await expect(page.locator('.camera-indicator')).toBeHidden();
});

test('the menu notice is shown and stays clear of the card', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('/ui-harness.html?screen=menu&notice=1&cam=1');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'e2e-ui/screenshots/menu-notice.png' });
  const note = page.locator('.menu-notice');
  await expect(note).toHaveText('That round broke. Pick a sport to try again.');
  await expect(note).toHaveAttribute('aria-live', 'polite');
  const noteBox = (await note.boundingBox()) as Box;
  const indicator = (await page.locator('.camera-indicator').boundingBox()) as Box;
  const card = (await page.locator('.card-menu').boundingBox()) as Box;
  expect(overlaps(noteBox, card)).toBe(false);
  expect(overlaps(noteBox, indicator)).toBe(false);
  expect(problems).toEqual([]);
});

test('loading Back button and Escape cancel', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=loading&cancel=1');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect.poll(() => resolved(page)).toBe('cancelled');
  await page.goto('/ui-harness.html?screen=loading&cancel=1');
  await page.keyboard.press('Escape');
  await expect.poll(() => resolved(page)).toBe('cancelled');
});

test('the throwing hand toggle works from the keyboard', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=howto&debugkeys=1&toggle=right');
  const left = page.getByRole('button', { name: 'Left' });
  await left.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => resolved(page)).toBe('hand:left');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await expect(left).toHaveText('✓ Left');
});

test('the seated toggle on calibration reports its state', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('/ui-harness.html?screen=calibration&sport=3');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'e2e-ui/screenshots/calibration-seat.png' });
  const seat = page.locator('.cal-seat');
  await expect(seat).toHaveText('Sitting: off');
  await seat.click();
  await expect(seat).toHaveText('Sitting: on');
  await expect.poll(() => resolved(page)).toBe('seated:true');
  expect(problems).toEqual([]);
});
