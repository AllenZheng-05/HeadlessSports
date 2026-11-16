import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
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

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (b === null) throw new Error(`no box for ${selector}`);
  return b;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(b: Box, viewport: { width: number; height: number }): boolean {
  return (
    b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height
  );
}

test.describe('Players control', () => {
  test('is on the archery how-to card, reports the choice and marks it with text', async ({
    page,
  }) => {
    const problems = watchErrors(page);
    await page.goto('/ui-harness.html?screen=howto&sport=archery&input=debug&multi=1');
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'e2e-ui/screenshots/players-howto.png' });
    const opts = page.locator('.players-opt');
    await expect(opts).toHaveCount(4);
    await expect(opts.nth(0)).toHaveText('✓ 1');
    await opts.nth(2).click();
    await expect.poll(() => resolved(page)).toBe('players:3');
    await expect(opts.nth(2)).toHaveText('✓ 3');
    await expect(opts.nth(0)).toHaveText('1');
    expect(problems).toEqual([]);
  });

  test('is absent for a sport without multiplayer and present for one with it', async ({
    page,
  }) => {
    // The warm-up and the harness stand-in sports have no `multiplayer`; every real sport does.
    for (const id of ['warmup', '1']) {
      await page.goto(`/ui-harness.html?screen=howto&sport=${id}&input=debug&multi=1`);
      await page.waitForTimeout(500);
      await expect(page.locator('.players-toggle')).toHaveCount(0);
    }
    await page.goto('/ui-harness.html?screen=howto&sport=bowling&input=debug&multi=1');
    await page.waitForTimeout(500);
    await expect(page.locator('.players-toggle')).toHaveCount(1);
  });

  for (const viewport of VIEWPORTS) {
    for (const mode of ['debug', 'camera'] as const) {
      test(`the how-to card still fits ${viewport.width}x${viewport.height}, ${mode} input`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const input = mode === 'debug' ? '&input=debug' : '&cam=1';
        await page.goto(`/ui-harness.html?screen=howto&sport=archery&multi=1${input}`);
        await page.waitForTimeout(700);
        await page.screenshot({
          path: `e2e-ui/screenshots/players-howto-fit-${mode}-${viewport.width}.png`,
        });
        for (const selector of ['.card-howto', '.card-howto .actions .btn-big']) {
          expect(inside(await box(page, selector), viewport), selector).toBe(true);
        }
        const clipped = await page
          .locator('.howto-body')
          .evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(clipped).toBeLessThanOrEqual(1);
        const back = await box(page, '.card-howto .actions .btn-secondary:last-child');
        expect(back.y + back.height).toBeLessThanOrEqual(viewport.height);
      });
    }
  }
});

test.describe('names screen', () => {
  test('types names with the keyboard: Enter goes to the next field and starts on the last', async ({
    page,
  }) => {
    const problems = watchErrors(page);
    await page.goto('/ui-harness.html?screen=names&seats=3&input=debug');
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'e2e-ui/screenshots/names.png' });
    const inputs = page.locator('.name-input');
    await expect(inputs).toHaveCount(3);
    await expect(inputs.nth(0)).toBeFocused();
    await expect(inputs.nth(1)).toHaveValue('Player 2');

    // The prefilled text is selected, so typing replaces it.
    await page.keyboard.type('Ana');
    await expect(inputs.nth(0)).toHaveValue('Ana');
    await page.keyboard.press('Enter');
    await expect(inputs.nth(1)).toBeFocused();
    await page.keyboard.type('Bartholomew Jones');
    // The field stops at 12 characters.
    expect((await inputs.nth(1).inputValue()).length).toBe(12);
    await page.keyboard.press('Enter');
    await expect(inputs.nth(2)).toBeFocused();
    expect(await resolved(page)).toBeNull();
    await page.keyboard.type('Cy');
    await page.keyboard.press('Enter');
    await expect.poll(() => resolved(page)).toBe('Ana,Bartholomew ,Cy');
    expect(problems).toEqual([]);
  });

  test('mouse play adds a labelled dominant-hand choice per player, reachable by keyboard', async ({
    page,
  }) => {
    await page.goto('/ui-harness.html?screen=names&seats=3&hands=1&input=debug');
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'e2e-ui/screenshots/names-hands.png' });
    const groups = page.locator('.name-hand');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(1)).toHaveAttribute('aria-label', 'Player 2 dominant hand');
    await expect(groups.nth(1).locator('[aria-pressed="true"]')).toHaveText('\u2713 Left');
    // Tab from the first name goes through its hand choice.
    await page.locator('.name-input').first().focus();
    await page.keyboard.press('Tab');
    await expect(groups.nth(0).locator('button').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(groups.nth(0).locator('[aria-pressed="true"]')).toHaveText('\u2713 Right');
  });

  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.width}x${viewport.height} with four players and the hand choice`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/ui-harness.html?screen=names&seats=4&hands=1&input=debug');
      await page.waitForTimeout(700);
      expect(inside(await box(page, '.card-names'), viewport)).toBe(true);
      expect(inside(await box(page, '.card-names .btn-big'), viewport)).toBe(true);
      for (let i = 0; i < 4; i++) {
        expect(inside(await box(page, `.name-row:nth-child(${i + 1}) .name-hand`), viewport)).toBe(
          true,
        );
        expect(
          (await box(page, `.name-row:nth-child(${i + 1}) .name-input`)).width,
        ).toBeGreaterThan(200);
      }
    });
  }

  test('each field carries its player colour, name and a distinct swatch', async ({ page }) => {
    await page.goto('/ui-harness.html?screen=names&seats=3&input=debug');
    await page.waitForTimeout(700);
    const colours = await page
      .locator('.name-row .seat-chip')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(new Set(colours).size).toBe(3);
    await expect(page.locator('.name-colour')).toHaveText(['Coral', 'Blue', 'Sunny']);
  });

  test('Start and Back buttons work with the mouse', async ({ page }) => {
    await page.goto('/ui-harness.html?screen=names&seats=2&input=debug');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => resolved(page)).toBe('Mia,Player 2');
    await page.goto('/ui-harness.html?screen=names&seats=2&input=debug');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect.poll(() => resolved(page)).toBe('null');
  });

  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.width}x${viewport.height} with four players`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/ui-harness.html?screen=names&seats=4&input=debug');
      await page.waitForTimeout(700);
      expect(inside(await box(page, '.card-names'), viewport)).toBe(true);
      expect(inside(await box(page, '.card-names .btn-big'), viewport)).toBe(true);
    });
  }
});

test.describe('handover card', () => {
  test('says whose turn it is in their colour, with the standings, and Ready resolves', async ({
    page,
  }) => {
    const problems = watchErrors(page);
    await page.goto('/ui-harness.html?screen=handover&seats=3&who=1&input=debug');
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'e2e-ui/screenshots/handover.png' });
    await expect(page.locator('.handover h1')).toHaveText("Sam, you're up");
    await expect(page.locator('.handover-row')).toHaveCount(3);
    await expect(page.locator('.handover-row.current .handover-name')).toHaveText('Sam');
    const border = await page
      .locator('.card-handover')
      .evaluate((el) => getComputedStyle(el).borderTopColor);
    // Sam is the second seat: the blue.
    expect(border).toBe('rgb(90, 169, 230)');
    await page.getByRole('button', { name: 'Ready' }).click();
    await expect.poll(() => resolved(page)).toBe('ready');
    expect(problems).toEqual([]);
  });

  test('a camera card shows the swap-places line when asked, and the card still fits', async ({
    page,
  }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(
        '/ui-harness.html?screen=handover&seats=4&who=3&lead=2&cam=1&hint=1&hand=pose',
      );
      await page.waitForTimeout(700);
      await expect(page.locator('.handover-swap')).toHaveText(
        'Swap places, or make a fist on Ready',
      );
      await expect(page.locator('.handover-swap')).toBeVisible();
      await expect(page.locator('.handover-row.leading .handover-lead')).toHaveCount(1);
      expect(inside(await box(page, '.card-handover'), viewport)).toBe(true);
      expect(inside(await box(page, '.handover-ready'), viewport)).toBe(true);
      expect(inside(await box(page, '.handover-swap'), viewport)).toBe(true);
    }
  });

  test('Enter is Ready', async ({ page }) => {
    await page.goto('/ui-harness.html?screen=handover&seats=2&who=1&input=debug');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await expect.poll(() => resolved(page)).toBe('ready');
  });

  test('a fist from the hand cursor presses Ready, an open hand over it does not', async ({
    page,
  }) => {
    await page.goto('/ui-harness.html?screen=handover&seats=2&who=1&hand=pose');
    const ready = await box(page, '.handover-ready');
    const nx = (ready.x + ready.width / 2) / 1280;
    const ny = (ready.y + ready.height / 2) / 720;
    const setHand = (x: number, y: number, down: boolean): Promise<void> =>
      page.evaluate(
        ([hx, hy, d]) =>
          (
            window as unknown as {
              __ui: { fake: { setHand(s: string, x: number, y: number, d: boolean): void } };
            }
          ).__ui.fake.setHand('right', hx as number, hy as number, d as boolean),
        [x, y, down] as const,
      );
    // A new card ignores the hand for a moment and wants it seen away from the buttons first.
    await setHand(0.01, 0.01, false);
    await page.waitForTimeout(1500);
    await setHand(nx, ny, false);
    await page.waitForTimeout(2200);
    expect(await resolved(page)).toBeNull();
    await setHand(nx, ny, true);
    await expect.poll(() => resolved(page), { timeout: 2500 }).toBe('ready');
  });

  test('the step-in card offers Back, and Escape cancels', async ({ page }) => {
    await page.goto('/ui-harness.html?screen=handover&seats=2&who=0&stepin=1&cam=1');
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'e2e-ui/screenshots/stepin.png' });
    await expect(page.locator('.handover h1')).toHaveText('Mia, step in');
    await expect(page.locator('.fist-hint')).toContainText('fist');
    await page.keyboard.press('Escape');
    await expect.poll(() => resolved(page)).toBe('cancel');
  });

  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.width}x${viewport.height} with four players and a long name`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/ui-harness.html?screen=handover&seats=4&who=3&input=debug');
      await page.waitForTimeout(700);
      expect(inside(await box(page, '.card-handover'), viewport)).toBe(true);
      expect(inside(await box(page, '.handover-ready'), viewport)).toBe(true);
      const title = await box(page, '.handover h1');
      expect(inside(title, viewport)).toBe(true);
    });
  }
});

test.describe('results table', () => {
  test('ranks four players, ties share a rank, and names the winner', async ({ page }) => {
    const problems = watchErrors(page);
    await page.goto('/ui-harness.html?screen=multiresults&seats=4&input=debug');
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'e2e-ui/screenshots/multiresults.png' });
    await expect(page.locator('.results-headline')).toHaveText('Sam wins');
    await expect(page.locator('.rank-num')).toHaveText(['1', '2', '2', '4']);
    await expect(page.locator('.rank-name')).toHaveText(['Sam', 'Mia', 'Zoe', 'Alexander J']);
    await expect(page.locator('.rank-score')).toHaveText(['31 pts', '24 pts', '24 pts', '9 pts']);
    await expect(page.getByText('New best')).toHaveCount(0);
    await expect(page.getByText('Personal best')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a tie for first says so', async ({ page }) => {
    await page.goto('/ui-harness.html?screen=multiresults&seats=3&scores=20,20,5&input=debug');
    await page.waitForTimeout(500);
    await expect(page.locator('.results-headline')).toHaveText("It's a tie");
    await expect(page.locator('.rank-num')).toHaveText(['1', '1', '3']);
  });

  test('offers Play again, Change names and Back to menu', async ({ page }) => {
    await page.goto('/ui-harness.html?screen=multiresults&seats=2&input=debug');
    await page.getByRole('button', { name: 'Change names' }).click();
    await expect.poll(() => resolved(page)).toBe('change');
  });

  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.width}x${viewport.height} with four players`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/ui-harness.html?screen=multiresults&seats=4&input=debug');
      await page.waitForTimeout(700);
      expect(inside(await box(page, '.card-multi-results'), viewport)).toBe(true);
      for (const name of ['Play again', 'Change names', 'Back to menu']) {
        const b = await page.getByRole('button', { name }).boundingBox();
        expect(b && inside(b, viewport), name).toBe(true);
      }
    });
  }
});

test.describe('standings strip in play', () => {
  const HUD_PARTS = [
    '.hud-topleft',
    '.hud-meters',
    '.hud-table',
    '.hud-banner',
    '.hud-hint',
    '.play-controls',
    '.mirror',
    '.camera-indicator',
  ];

  for (const viewport of VIEWPORTS) {
    for (const seats of [2, 4]) {
      test(`clears every other HUD element at ${viewport.width}x${viewport.height} with ${seats} players`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/ui-harness.html?screen=playing&seats=${seats}`);
        await page.waitForTimeout(900);
        await page.screenshot({
          path: `e2e-ui/screenshots/standings-${seats}-${viewport.width}.png`,
        });
        const chips = await page.locator('.standing').count();
        expect(chips).toBe(seats);
        const strip = await box(page, '.standings');
        expect(inside(strip, viewport)).toBe(true);
        for (const selector of HUD_PARTS) {
          const target = page.locator(selector).first();
          if ((await target.count()) === 0 || !(await target.isVisible())) continue;
          const b = await target.boundingBox();
          if (b === null) continue;
          expect(overlaps(strip, b), `${selector} overlaps the standings strip`).toBe(false);
        }
        // The current player is marked in text as well as outline.
        await expect(page.locator('.standing.current .standing-name')).toHaveText('Sam');
        expect(
          await page
            .locator('.standing.current')
            .evaluate((el) => getComputedStyle(el, '::before').content),
        ).toContain('▶');
      });
    }
  }
});
