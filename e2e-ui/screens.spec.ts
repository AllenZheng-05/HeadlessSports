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
  const box = await page.locator('.hand-cursor').boundingBox();
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
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cursor = page.locator('.hand-cursor');

  // Active play: a hand held over the button for well past the dwell time does nothing.
  await page.mouse.move(400, 400);
  await page.waitForTimeout(1500);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(2800);
  await expect(cursor).toBeHidden();
  await expect(control).not.toHaveClass(/hovered/);
  await expect(page.locator('.howto-overlay')).toBeHidden();
  expect(await isPaused(page)).toBe(false);

  // The real mouse still works on the same button.
  await page.mouse.move(400, 400);
  await page.waitForTimeout(200);

  // Paused (the out-of-frame pause): the cursor is back and a hold activates the button.
  await page.evaluate(() =>
    (
      window as unknown as { __ui: { ui: { showPause(p: string | null): void } } }
    ).__ui.ui.showPause('lost'),
  );
  await page.waitForTimeout(1500);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(500);
  await expect(cursor).toBeVisible();
  expect(await isPaused(page)).toBe(false);
  await page.waitForTimeout(1200);
  await expect(page.locator('.howto-overlay')).toBeVisible();
  expect(await isPaused(page)).toBe(true);
  // and the mitt can hold over Resume to close it
  const resume = (await page.getByRole('button', { name: 'Resume' }).boundingBox()) as Box;
  await page.mouse.move(6, 6);
  await page.waitForTimeout(1500);
  await page.mouse.move(resume.x + resume.width / 2, resume.y + resume.height / 2);
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
