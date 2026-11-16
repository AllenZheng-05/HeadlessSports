import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SCREENS: { name: string; query: string }[] = [
  { name: 'loading', query: 'screen=loading' },
  { name: 'gatefail', query: 'screen=gatefail' },
  { name: 'gatewarn', query: 'screen=gatewarn' },
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

test('hand cursor: a fist over a card selects it, an open hand or a sliding fist does not', async ({
  page,
}) => {
  await page.goto('/ui-harness.html?screen=menu&hand=1');
  const card = page.locator('.sport-card[data-sport="archery"]');
  const box = (await card.boundingBox()) as Box;
  const nx = (box.x + box.width / 2) / 1280;
  const ny = (box.y + box.height / 2) / 720;

  // a new screen ignores the hand for 1.2 s and wants it seen outside every button first
  await setHand(page, 'right', 0.01, 0.01, false);
  await page.waitForTimeout(1500);

  // an open hand over the card shows the hover and never selects
  await setHand(page, 'right', nx, ny, false);
  await page.waitForTimeout(2500);
  await expect(card).toHaveClass(/hovered/);
  expect(await resolved(page)).toBeNull();

  // a fist that arrives already closed does not select either
  await setHand(page, 'right', 0.01, 0.01, true);
  await page.waitForTimeout(500);
  await setHand(page, 'right', nx, ny, true);
  await page.waitForTimeout(1500);
  expect(await resolved(page)).toBeNull();

  // open, then close over the card: selected
  await setHand(page, 'right', nx, ny, false);
  await page.waitForTimeout(400);
  await setHand(page, 'right', nx, ny, true);
  await expect.poll(() => resolved(page), { timeout: 2000 }).toBe('archery');
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

test('gate warning: Details reveals the numbers and Play anyway continues', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=gatewarn');
  await expect(page.getByRole('heading', { name: 'This device may struggle' })).toBeVisible();
  const details = page.locator('#gate-details');
  await expect(details).toBeHidden();
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(details).toBeVisible();
  await expect(details).toContainText('14.2');
  await expect(details).toContainText('at least 24');
  expect(await resolved(page)).toBeNull();
  await page.getByRole('button', { name: 'Play anyway' }).click();
  await expect.poll(() => resolved(page)).toBe('resolved');
});

test('gate warning: Enter plays anyway', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=gatewarn');
  await page.keyboard.press('Enter');
  await expect.poll(() => resolved(page)).toBe('resolved');
});

test('terminal gate screen has no way forward and says what is missing', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=gatefail');
  await expect(
    page.getByRole('heading', { name: 'This browser cannot run the game' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play anyway' })).toHaveCount(0);
  await expect(page.locator('.screen-gatefail')).toContainText('WebGL 2');
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

test('the dominant hand toggle works from the keyboard', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=howto&debugkeys=1&toggle=right');
  const left = page.getByRole('button', { name: 'Left' });
  await left.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => resolved(page)).toBe('hand:left');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await expect(left).toHaveText('✓ Left');
});

test('a sport without a dominant hand has no toggle, and says "With the mouse"', async ({
  page,
}) => {
  await page.goto('/ui-harness.html?screen=howto&sport=0&debugkeys=1&toggle=right');
  await expect(page.locator('.debug-title')).toHaveText('With the mouse');
  await expect(page.locator('.hand-toggle')).toHaveCount(0);
  await expect(page.locator('.fist-hint')).toHaveCount(0);
  await page.goto('/ui-harness.html?screen=howto&sport=1&debugkeys=1&toggle=right');
  await expect(page.locator('.hand-toggle')).toHaveCount(1);
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

// ---- how-to card fit, pointer cursor and the in-play how-to overlay ----

const REAL_SPORT_IDS = [
  'climbing',
  'bowling',
  'batting',
  'archery',
  'javelin',
  'pitching',
  'warmup',
];
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
];

for (const viewport of VIEWPORTS) {
  for (const mode of ['debug', 'camera'] as const) {
    for (const id of REAL_SPORT_IDS) {
      test(`how-to card fits ${viewport.width}x${viewport.height}: ${id}, ${mode} input`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const input = mode === 'debug' ? '&input=debug' : '&cam=1';
        await page.goto(`/ui-harness.html?screen=howto&sport=${id}${input}`);
        await page.waitForTimeout(700);
        if (id === 'bowling') {
          await page.screenshot({
            path: `e2e-ui/screenshots/howto-fit-${mode}-${viewport.width}.png`,
          });
        }
        for (const selector of ['.card-howto', '.card-howto .actions .btn-big']) {
          const box = (await page.locator(selector).first().boundingBox()) as Box;
          expect(box).not.toBeNull();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
        // Nothing is hidden behind a scrollbar: the whole body is on show.
        const clipped = await page
          .locator('.howto-body')
          .evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(clipped).toBeLessThanOrEqual(1);
        const back = (await page.getByRole('button', { name: 'Back' }).boundingBox()) as Box;
        expect(back.y + back.height).toBeLessThanOrEqual(viewport.height);
      });
    }
  }
}

async function cursorCentre(page: Page): Promise<{ x: number; y: number } | null> {
  const box = await page.locator('.hc-right').boundingBox();
  if (box === null) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('mouse: the cursor sits exactly on the pointer on every screen', async ({ page }) => {
  const points = [
    { x: 333, y: 271 },
    { x: 1020, y: 90 },
    { x: 17, y: 700 },
  ];
  for (const screen of ['menu', 'howto&sport=bowling', 'results&sport=4']) {
    await page.goto(`/ui-harness.html?screen=${screen}&input=debug`);
    await page.waitForTimeout(600);
    for (const p of points) {
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(150);
      const c = await cursorCentre(page);
      expect(c).not.toBeNull();
      expect(Math.abs((c?.x ?? 0) - p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((c?.y ?? 0) - p.y)).toBeLessThanOrEqual(1);
    }
  }
});

test('mouse: hovering never selects, clicking does', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=menu&input=debug');
  const card = page.locator('.sport-card[data-sport="archery"]');
  const box = (await card.boundingBox()) as Box;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(6, 6);
  await page.waitForTimeout(1500);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(2500);
  expect(await resolved(page)).toBeNull();
  await page.mouse.click(cx, cy);
  await expect.poll(() => resolved(page)).toBe('archery');
});

async function isPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __ui: { paused: boolean } }).__ui.paused);
}

test('the how-to overlay opens, pauses and resumes during play', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('/ui-harness.html?screen=playing&sport=bowling&input=debug');
  await page.waitForTimeout(600);
  const overlay = page.locator('.howto-overlay');
  await expect(overlay).toBeHidden();
  await expect(page.locator('.quit')).toBeVisible();

  // mouse: open, read, Resume
  await page.getByRole('button', { name: /How to play/ }).click();
  await expect(overlay).toBeVisible();
  expect(await isPaused(page)).toBe(true);
  await expect(overlay).toContainText('Bowling');
  await expect(overlay).toContainText('Close your fist');
  await page.screenshot({ path: 'e2e-ui/screenshots/howto-overlay.png' });
  const box = (await page.locator('.howto-overlay .card').boundingBox()) as Box;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(overlay).toBeHidden();
  expect(await isPaused(page)).toBe(false);

  // keyboard: H opens, Escape closes (and does not quit)
  await page.keyboard.press('h');
  await expect(overlay).toBeVisible();
  expect(await isPaused(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  expect(await isPaused(page)).toBe(false);
  expect(await resolved(page)).toBeNull();

  // H again closes it as well
  await page.keyboard.press('H');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('h');
  await expect(overlay).toBeHidden();

  // Escape with no overlay still quits, and so does the Quit button
  await page.keyboard.press('Escape');
  await expect.poll(() => resolved(page)).toBe('quit');
  expect(problems).toEqual([]);
});

test('the Quit button still works while the overlay is closed', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=playing&sport=bowling&input=debug');
  await page.getByRole('button', { name: 'Quit' }).click();
  await expect.poll(() => resolved(page)).toBe('quit');
});

test('hand cursor: dead during active play, back when paused', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=playing&sport=bowling&hand=1');
  await page.waitForTimeout(300);
  const control = page.getByRole('button', { name: /How to play/ });
  const box = (await control.boundingBox()) as Box;
  const cx = (box.x + box.width / 2) / 1280;
  const cy = (box.y + box.height / 2) / 720;
  const cursor = page.locator('.hc-right');

  // Active play: an open hand, then a fist, over the button does nothing.
  await setHand(page, 'right', 0.3, 0.5, false);
  await page.waitForTimeout(1500);
  await setHand(page, 'right', cx, cy, false);
  await page.waitForTimeout(800);
  await setHand(page, 'right', cx, cy, true);
  await page.waitForTimeout(1500);
  await expect(cursor).toBeHidden();
  await expect(control).not.toHaveClass(/hovered/);
  await expect(page.locator('.howto-overlay')).toBeHidden();
  expect(await isPaused(page)).toBe(false);

  // Paused (the out-of-frame pause): the cursor is back and a fist activates the button.
  await setHand(page, 'right', 0.3, 0.5, false);
  await page.evaluate(() =>
    (
      window as unknown as { __ui: { ui: { showPause(p: string | null): void } } }
    ).__ui.ui.showPause('lost'),
  );
  await page.waitForTimeout(1500);
  await setHand(page, 'right', cx, cy, false);
  await page.waitForTimeout(700);
  await expect(cursor).toBeVisible();
  expect(await isPaused(page)).toBe(false);
  await setHand(page, 'right', cx, cy, true);
  await expect(page.locator('.howto-overlay')).toBeVisible();
  expect(await isPaused(page)).toBe(true);
  // and the mitt can close it from Resume with a fist
  const resume = (await page.getByRole('button', { name: 'Resume' }).boundingBox()) as Box;
  await setHand(page, 'right', 0.01, 0.01, false);
  await page.waitForTimeout(1500);
  await setHand(
    page,
    'right',
    (resume.x + resume.width / 2) / 1280,
    (resume.y + resume.height / 2) / 720,
    false,
  );
  await page.waitForTimeout(500);
  await setHand(
    page,
    'right',
    (resume.x + resume.width / 2) / 1280,
    (resume.y + resume.height / 2) / 720,
    true,
  );
  await expect.poll(() => isPaused(page), { timeout: 4000 }).toBe(false);
});

test('hand cursor: the real mouse and H still work on in-round buttons', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=playing&sport=bowling&hand=1');
  await page.waitForTimeout(300);
  await page.keyboard.press('h');
  await expect(page.locator('.howto-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.howto-overlay')).toBeHidden();
  await page.getByRole('button', { name: /How to play/ }).click();
  await expect(page.locator('.howto-overlay')).toBeVisible();
});

test('Turn camera on: shown in mouse mode on lobby screens, clear of other controls', async ({
  page,
}) => {
  const problems = watchErrors(page);
  for (const screen of ['title', 'menu', 'howto&sport=bowling', 'results&sport=4']) {
    await page.goto(`/ui-harness.html?screen=${screen}&input=debug`);
    await page.waitForTimeout(700);
    const button = page.getByRole('button', { name: 'Turn camera on' });
    await expect(button).toBeVisible();
    await page.screenshot({ path: `e2e-ui/screenshots/camera-on-${screen.split('&')[0]}.png` });
    const b = (await button.boundingBox()) as Box;
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeGreaterThan(640);
    expect(b.y + b.height).toBeLessThan(120);
    for (const sel of ['.card', '.menu-notice']) {
      for (const other of await page.locator(sel).all()) {
        const o = await other.boundingBox();
        // Cards have large rounded corners: ignore the outermost 24 px of the box.
        if (o !== null) {
          const inner = { x: o.x + 24, y: o.y + 24, width: o.width - 48, height: o.height - 48 };
          expect(overlaps(b, inner)).toBe(false);
        }
      }
    }
  }
  expect(problems).toEqual([]);
});

test('Turn camera on: works by mouse and keyboard, is not a game press, hidden in play', async ({
  page,
}) => {
  await page.goto('/ui-harness.html?screen=menu&input=debug');
  const button = page.getByRole('button', { name: 'Turn camera on' });
  await button.click();
  await expect.poll(() => resolved(page)).toBe('camera-on');
  await page.goto('/ui-harness.html?screen=title&input=debug');
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => resolved(page)).toBe('camera-on');
  await page.goto('/ui-harness.html?screen=playing&sport=bowling&input=debug');
  await expect(button).toBeHidden();
});

test('Turn camera on: absent in camera mode', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=menu&cam=1');
  await page.waitForTimeout(400);
  await expect(page.getByRole('button', { name: 'Turn camera on' })).toBeHidden();
});

test('the calibration outline changes pose with the step', async ({ page }) => {
  const arms = async (query: string): Promise<string[]> => {
    await page.goto(`/ui-harness.html?screen=calibration&sport=1${query}`);
    await page.waitForTimeout(900);
    return page
      .locator('.guide-arm')
      .evaluateAll((els) => els.map((e) => (e as SVGElement).style.transform));
  };
  expect(await arms('&step=position')).toEqual(['rotate(14deg)', 'rotate(-14deg)']);
  expect(await arms('&step=handedness')).toEqual(['rotate(14deg)', 'rotate(-165deg)']);
  expect(await arms('&step=hold-still')).toEqual(['rotate(90deg)', 'rotate(-90deg)']);
  await page.screenshot({ path: 'e2e-ui/screenshots/calibration-tpose.png' });
});

type Side = 'left' | 'right';

async function setHand(page: Page, side: Side, nx: number, ny: number, down: boolean) {
  await page.evaluate(
    ([s, x, y, d]) =>
      (
        window as unknown as {
          __ui: { fake: { setHand(s: string, x: number, y: number, d: boolean): void } };
        }
      ).__ui.fake.setHand(s, x, y, d),
    [side, nx, ny, down] as const,
  );
}

async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('hand cursors: two hands show two cursors that each stay with their own hand', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await page.goto('/ui-harness.html?screen=menu&hand=1');
  await page.waitForTimeout(500);
  await expect(page.locator('.hc-left')).toBeHidden();
  await expect(page.locator('.hc-right')).toBeHidden();
  await setHand(page, 'left', 0.2, 0.15, false);
  await setHand(page, 'right', 0.8, 0.85, false);
  await page.waitForTimeout(400);
  await expect(page.locator('.hc-left')).toBeVisible();
  await expect(page.locator('.hc-right')).toBeVisible();
  await expect(page.locator('.hc-left .hc-tag')).toHaveText('L');
  await expect(page.locator('.hc-right .hc-tag')).toHaveText('R');
  // Both hands move for several seconds, crossing each other's height and sides.
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const l = { x: 0.15 + 0.5 * f, y: 0.1 + 0.2 * Math.sin(f * 6) };
    const r = { x: 0.85 - 0.5 * f, y: 0.9 - 0.2 * Math.sin(f * 6) };
    await setHand(page, 'left', l.x, l.y, false);
    await setHand(page, 'right', r.x, r.y, false);
    await page.waitForTimeout(300);
    const lc = (await centreOf(page, '.hc-left')) as { x: number; y: number };
    const rc = (await centreOf(page, '.hc-right')) as { x: number; y: number };
    expect(Math.abs(lc.x - l.x * 1280)).toBeLessThan(90);
    expect(Math.abs(lc.y - l.y * 720)).toBeLessThan(90);
    expect(Math.abs(rc.x - r.x * 1280)).toBeLessThan(90);
    expect(Math.abs(rc.y - r.y * 720)).toBeLessThan(90);
  }
  // Losing one hand removes only that cursor.
  await page.evaluate(() =>
    (window as unknown as { __ui: { fake: { clearHand(s: string): void } } }).__ui.fake.clearHand(
      'left',
    ),
  );
  await page.waitForTimeout(200);
  await expect(page.locator('.hc-left')).toBeHidden();
  await expect(page.locator('.hc-right')).toBeVisible();
  expect(problems).toEqual([]);
});

test('hand cursors: a fist chooses a button, an open hand never does, the other hand can roam', async ({
  page,
}) => {
  await page.goto('/ui-harness.html?screen=menu&hand=1');
  await page.waitForTimeout(300);
  const card = (await page.locator('.sport-card').nth(1).boundingBox()) as Box;
  const nx = (card.x + card.width / 2) / 1280;
  const ny = (card.y + card.height / 2) / 720;
  // Both hands start away from every button for longer than the screen guard.
  await setHand(page, 'left', 0.5, 0.04, false);
  await setHand(page, 'right', 0.5, 0.96, false);
  await page.waitForTimeout(1800);
  // An open hand over the button, for a long time: highlight, no selection.
  await setHand(page, 'left', nx, ny, false);
  await page.waitForTimeout(3000);
  await expect(page.locator('.sport-card').nth(1)).toHaveClass(/hovered/);
  expect(await resolved(page)).toBeNull();
  // The other hand roaming elsewhere (open) changes nothing.
  await setHand(page, 'right', 0.5, 0.96, false);
  await page.waitForTimeout(300);
  expect(await resolved(page)).toBeNull();
  // A fist from that hand chooses it.
  await setHand(page, 'left', nx, ny, true);
  await expect.poll(() => resolved(page), { timeout: 3000 }).not.toBeNull();
});

// ---- tutorial ----

test('how-to card: the Tutorial button is there only for a sport that has a tutorial', async ({
  page,
}) => {
  const problems = watchErrors(page);
  for (const mode of ['&input=debug', '&cam=1']) {
    await page.goto(`/ui-harness.html?screen=howto&sport=climbing${mode}`);
    await page.waitForTimeout(500);
    const button = page.getByRole('button', { name: 'Tutorial' });
    await expect(button).toBeVisible();
    // Beside Start and Back, never first.
    const names = await page
      .locator('.card-howto .actions .btn')
      .evaluateAll((els) => els.map((e) => e.textContent));
    expect(names).toEqual(['Start', 'Tutorial', 'Back']);
    if (mode === '&cam=1') await page.screenshot({ path: 'e2e-ui/screenshots/howto-tutorial.png' });
  }
  for (const id of ['bowling', 'batting', 'archery', 'javelin', 'pitching', 'warmup']) {
    await page.goto(`/ui-harness.html?screen=howto&sport=${id}&input=debug`);
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Tutorial' })).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test('how-to card: clicking Tutorial resolves, Start still starts, Escape still goes back', async ({
  page,
}) => {
  await page.goto('/ui-harness.html?screen=howto&sport=climbing&input=debug');
  await page.getByRole('button', { name: 'Tutorial' }).click();
  await expect.poll(() => resolved(page)).toBe('tutorial');
  await page.goto('/ui-harness.html?screen=howto&sport=climbing&input=debug');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => resolved(page)).toBe('start');
  await page.goto('/ui-harness.html?screen=howto&sport=climbing&input=debug');
  await page.keyboard.press('Escape');
  await expect.poll(() => resolved(page)).toBe('back');
});

test('hand cursor: a fist chooses the Tutorial button', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=howto&sport=climbing&hand=1&cam=1');
  const button = page.getByRole('button', { name: 'Tutorial' });
  const box = (await button.boundingBox()) as Box;
  const nx = (box.x + box.width / 2) / 1280;
  const ny = (box.y + box.height / 2) / 720;
  await setHand(page, 'right', 0.5, 0.02, false);
  await page.waitForTimeout(1500);
  await setHand(page, 'right', nx, ny, false);
  await page.waitForTimeout(500);
  await setHand(page, 'right', nx, ny, true);
  await expect.poll(() => resolved(page), { timeout: 3000 }).toBe('tutorial');
});

test('the Tutorial done screen offers Play now and Back to menu', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('/ui-harness.html?screen=tutorialdone&sport=climbing&cam=1');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'e2e-ui/screenshots/tutorialdone.png' });
  await expect(page.locator('.results-headline')).toHaveText('Tutorial done');
  await expect(page.locator('.best-badge')).toHaveCount(0);
  const card = (await page.locator('.card-tutorialdone').boundingBox()) as Box;
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y + card.height).toBeLessThanOrEqual(720);
  const indicator = (await page.locator('.camera-indicator').boundingBox()) as Box;
  for (const box of await page
    .locator('.results-sport, .results-headline, .body, .actions')
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    )) {
    expect(overlaps(indicator, box)).toBe(false);
  }
  await page.getByRole('button', { name: 'Play now' }).click();
  await expect.poll(() => resolved(page)).toBe('play');
  await page.goto('/ui-harness.html?screen=tutorialdone&sport=climbing');
  await page.getByRole('button', { name: 'Back to menu' }).click();
  await expect.poll(() => resolved(page)).toBe('menu');
  expect(problems).toEqual([]);
});

const COACH_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
];
const LONG_TEXT = 'Open one hand, reach higher, grab again and keep a firm grip on it';
const HUD_ITEMS = [
  '.hud-topleft',
  '.hud-meters .meter',
  '.hud-table-host',
  '.hud-banner',
  '.play-controls',
  '.mirror',
  '.camera-indicator',
  '.hud-hint',
];

for (const viewport of COACH_VIEWPORTS) {
  for (const sport of ['climbing', 'bowling']) {
    for (const variant of ['', '&text=' + encodeURIComponent(LONG_TEXT), '&confirm=1']) {
      test(`coach panel clears the HUD at ${viewport.width}x${viewport.height}: ${sport}${variant ? ' ' + variant.slice(1, 12) : ''}`, async ({
        page,
      }) => {
        const problems = watchErrors(page);
        await page.setViewportSize(viewport);
        await page.goto(`/ui-harness.html?screen=playing&sport=${sport}&tutorial=1${variant}`);
        await page.waitForTimeout(900);
        if (sport === 'bowling' && variant === '') {
          await page.screenshot({
            path: `e2e-ui/screenshots/coach-${sport}-${viewport.width}.png`,
          });
        }
        const coach = (await page.locator('.coach').boundingBox()) as Box;
        expect(coach).not.toBeNull();
        expect(coach.x).toBeGreaterThanOrEqual(0);
        expect(coach.y).toBeGreaterThanOrEqual(0);
        expect(coach.x + coach.width).toBeLessThanOrEqual(viewport.width);
        expect(coach.y + coach.height).toBeLessThanOrEqual(viewport.height);
        for (const selector of HUD_ITEMS) {
          for (const el of await page.locator(selector).all()) {
            if (!(await el.isVisible())) continue;
            const b = await el.boundingBox();
            if (b === null || b.width === 0) continue;
            expect(overlaps(coach, b), `${selector} overlaps the coach panel`).toBe(false);
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
}

test('coach panel: in a tutorial the sport hint steps aside', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=playing&sport=climbing&tutorial=1');
  await page.waitForTimeout(500);
  await expect(page.locator('.hud-hint')).toBeHidden();
  await page.goto('/ui-harness.html?screen=playing&sport=climbing');
  await page.waitForTimeout(500);
  await expect(page.locator('.hud-hint')).toBeVisible();
  await expect(page.locator('.coach')).toBeHidden();
});

test('coach panel: Skip step, S, End tutorial and the overlay entries', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('/ui-harness.html?screen=playing&sport=climbing&tutorial=1&input=debug');
  await page.waitForTimeout(500);
  await expect(page.locator('.coach-count')).toHaveText('Step 2 of 7');
  await expect(page.locator('.coach-text')).toHaveText(
    'Reach for a hold and make a fist to grab it',
  );
  await expect(page.locator('.coach-detail')).toHaveText('Use either hand.');
  await expect(page.locator('.coach-feedback')).toHaveText('Move closer to a hold');
  await page.getByRole('button', { name: 'Skip step' }).click();
  await expect.poll(() => resolved(page)).toBe('skip');
  await page.evaluate(() => {
    (window as unknown as { __ui: { resolved: string | null } }).__ui.resolved = null;
  });
  await page.keyboard.press('s');
  await expect.poll(() => resolved(page)).toBe('skip');
  // The how-to overlay offers the same two controls, for a player whose hands are the pointer.
  await page.keyboard.press('h');
  await expect(page.locator('.howto-overlay .overlay-skip')).toBeVisible();
  await expect(page.locator('.howto-overlay .overlay-end')).toBeVisible();
  await page.screenshot({ path: 'e2e-ui/screenshots/howto-overlay-tutorial.png' });
  const box = (await page.locator('.howto-overlay .card').boundingBox()) as Box;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await page.locator('.howto-overlay .overlay-end').click();
  await expect.poll(() => resolved(page)).toBe('end');
  await expect(page.locator('.howto-overlay')).toBeHidden();
  expect(problems).toEqual([]);
});

test('coach panel: the confirmation replaces the step text', async ({ page }) => {
  await page.goto('/ui-harness.html?screen=playing&sport=climbing&tutorial=1&confirm=1');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e-ui/screenshots/coach-confirm.png' });
  await expect(page.locator('.coach-text')).toHaveText('Nice');
  await expect(page.locator('.coach-feedback')).toBeHidden();
});

test('hand cursor: while the round is paused a fist chooses Skip step, never during play', async ({
  page,
}) => {
  await page.goto('/ui-harness.html?screen=playing&sport=climbing&tutorial=1&hand=1');
  await page.waitForTimeout(300);
  const skip = page.locator('.coach-skip');
  const box = (await skip.boundingBox()) as Box;
  const cx = (box.x + box.width / 2) / 1280;
  const cy = (box.y + box.height / 2) / 720;
  // Active play: a fist over the button does nothing.
  await setHand(page, 'right', 0.3, 0.3, false);
  await page.waitForTimeout(1500);
  await setHand(page, 'right', cx, cy, false);
  await page.waitForTimeout(600);
  await setHand(page, 'right', cx, cy, true);
  await page.waitForTimeout(1200);
  expect(await resolved(page)).toBeNull();
  // Paused (out of frame): the cursor is back and a fist skips the step.
  await setHand(page, 'right', 0.3, 0.3, false);
  await page.evaluate(() =>
    (
      window as unknown as { __ui: { ui: { showPause(p: string | null): void } } }
    ).__ui.ui.showPause('lost'),
  );
  await page.waitForTimeout(1500);
  await setHand(page, 'right', cx, cy, false);
  await page.waitForTimeout(700);
  await setHand(page, 'right', cx, cy, true);
  await expect.poll(() => resolved(page), { timeout: 3000 }).toBe('skip');
});
