import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHintFor, tutorialStuck } from './tutorialHelpers';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface ClimbingHook {
  phase: string;
  error: string | null;
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
  isBest: boolean | null;
  tutorial: boolean;
  sport: {
    height: number;
    best: number;
    grabs: number;
    stamina: number;
    status: string;
    holding: { left: boolean; right: boolean };
    layoutChecksum: number;
    pointerHand: 'left' | 'right' | null;
    pointerDragging: boolean;
    pointerHoldAt(x: number, y: number): number;
    aimImage(side: 'left' | 'right'): { x: number; y: number } | null;
    holdIndex: { left: number; right: number };
    holdScreen(index: number): { x: number; y: number };
    nextHold(side: 'left' | 'right'): number;
    tutorialStep: number;
    tutorialSteps: number;
  } | null;
  drawCalls: number;
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`pageerror: ${err.message}`);
  });
  return problems;
}

async function waitPhase(page: Page, phase: string, timeout = 30000): Promise<void> {
  try {
    await page.waitForFunction(
      (p) => (window as unknown as { __game: ClimbingHook }).__game.phase === p,
      phase,
      { timeout },
    );
  } catch (err) {
    const now = await page.evaluate(
      () =>
        `${(window as unknown as { __game: ClimbingHook }).__game.phase} (error: ${(window as unknown as { __game: ClimbingHook }).__game.error ?? 'none'})`,
    );
    throw new Error(`Never reached phase "${phase}"; stuck at ${now}.`, { cause: err });
  }
}

/**
 * Record every tutorial step the sport passes through, in the page from the first frame, so a fast
 * step is not missed. Call before `page.goto`.
 */
async function recordSteps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __game?: ClimbingHook; __steps: number[] };
    w.__steps = [];
    setInterval(() => {
      const sport = w.__game?.sport;
      if (!sport) return;
      const step = sport.tutorialStep;
      if (step >= 0 && step < sport.tutorialSteps && !w.__steps.includes(step)) {
        w.__steps.push(step);
      }
    }, 20);
  });
}

const stepsSeen = (page: Page): Promise<number[]> =>
  page.evaluate(() =>
    [...(window as unknown as { __steps: number[] }).__steps].sort((a, b) => a - b),
  );

const SYNTHETIC = '/?sport=climbing&source=synthetic&skipGate=1&short=1&timeScale=3';

test.describe('rock climbing', () => {
  test('the synthetic climber plays a full short round', async ({ page }) => {
    const problems = watch(page);
    await page.goto(SYNTHETIC);
    await waitPhase(page, 'playing');
    await page.waitForFunction(
      () => ((window as unknown as { __game: ClimbingHook }).__game.sport?.height ?? 0) > 2,
      undefined,
      {
        timeout: 60000,
      },
    );
    await page.screenshot({ path: `${SHOTS}/climbing-play.png` });
    const drawCalls = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.drawCalls,
    );
    console.info(`draw calls: ${drawCalls}`);
    expect(drawCalls).toBeLessThan(40);
    await waitPhase(page, 'results', 120000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.result,
    );
    expect(result?.score ?? 0).toBeGreaterThanOrEqual(3);
    expect(result?.detail?.grabs ?? 0).toBeGreaterThanOrEqual(6);
    console.info(`bot result: ${JSON.stringify(result)}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/climbing-results.png` });
    expect(problems).toEqual([]);
  });

  test('is playable with the mouse alone: press, drag, release, hand over hand', async ({
    page,
  }) => {
    test.setTimeout(100_000); // a whole short round with real pointer timing, about 41 s alone
    const problems = watch(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/climbing-start.png` });
    const vp = page.viewportSize()!;

    const read = (): Promise<{
      active: 'left' | 'right' | null;
      dragging: boolean;
      left: boolean;
      right: boolean;
      grabs: number;
      height: number;
      aimL: { x: number; y: number } | null;
      aimR: { x: number; y: number } | null;
    }> =>
      page.evaluate(() => {
        const s = (window as unknown as { __game: ClimbingHook }).__game.sport!;
        return {
          active: s.pointerHand,
          dragging: s.pointerDragging,
          left: s.holding.left,
          right: s.holding.right,
          grabs: s.grabs,
          height: s.height,
          aimL: s.aimImage('left'),
          aimR: s.aimImage('right'),
        };
      });
    const moveTo = async (x: number, y: number): Promise<void> => {
      await page.mouse.move(x * vp.width, y * vp.height);
      await page.waitForTimeout(120);
    };

    const h0 = (await read()).height;
    let prev = await read();
    expect(prev.active).toBe('right');
    for (let n = 1; n <= 5; n++) {
      const mover = prev.active!;
      const other = mover === 'left' ? 'right' : 'left';
      const aim = mover === 'left' ? prev.aimL : prev.aimR;
      expect(aim).not.toBeNull();
      await moveTo(aim!.x, aim!.y);
      await page.mouse.down();
      await page.waitForTimeout(250);
      const grabbed = await read();
      expect(grabbed.dragging, `n=${n}`).toBe(true);
      expect(grabbed[mover]).toBe(true);
      expect(grabbed.grabs).toBe(prev.grabs + 1);
      // Still the same hand while the button is down.
      expect(grabbed.active).toBe(mover);
      // The other hand let go of its hold the moment this hand took a new one.
      expect(grabbed[other], `n=${n} other`).toBe(false);
      // Drag down: the body is pulled up by the hand that holds.
      const hBefore = grabbed.height;
      await page.mouse.move(aim!.x * vp.width, (aim!.y + 0.28) * vp.height, { steps: 8 });
      await page.waitForTimeout(250);
      const pulled = await read();
      expect(pulled.dragging, `n=${n} pulled`).toBe(true);
      expect(pulled[mover]).toBe(true);
      expect(pulled[other]).toBe(false);
      expect(pulled.height).toBeGreaterThanOrEqual(hBefore - 0.01);
      await page.mouse.up();
      await page.waitForTimeout(200);
      const now = await read();
      // Releasing keeps the grip and the mouse changes hands.
      expect(now[mover]).toBe(true);
      expect(now[other]).toBe(false);
      expect(now.active, `n=${n} mover=${mover} grabs=${now.grabs}`).toBe(other);
      expect(now.grabs).toBe(prev.grabs + 1);
      prev = now;
    }
    expect(prev.left || prev.right).toBe(true);
    expect(prev.height - h0).toBeGreaterThan(0.6);
    await page.screenshot({ path: `${SHOTS}/climbing-debug.png` });

    // A press that is not on a hold changes nothing.
    const empty = await page.evaluate(() => {
      const s = (window as unknown as { __game: ClimbingHook }).__game.sport!;
      for (let y = 0.05; y < 1; y += 0.05) {
        for (let x = 0.05; x < 1; x += 0.05) {
          if (s.pointerHoldAt(x, y) < 0) return { x, y };
        }
      }
      return null;
    });
    expect(empty).not.toBeNull();
    await moveTo(empty!.x, empty!.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await read();
    expect(after.left).toBe(prev.left);
    expect(after.right).toBe(prev.right);
    expect(after.grabs).toBe(prev.grabs);
    expect(after.active).toBe(prev.active);

    // The round still ends with a result for the height climbed.
    await waitPhase(page, 'results', 60000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.result,
    );
    expect(result?.score ?? 0).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('the hold under the real cursor is the one that gets grabbed, at any window size and height', async ({
    page,
  }) => {
    test.setTimeout(140_000); // repeats the climb at several window sizes, about 57 s alone
    const problems = watch(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?sport=climbing&input=debug&skipGate=1&timeScale=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);

    const sizes = [
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
      { width: 900, height: 900 },
      { width: 1600, height: 600 },
      { width: 1000, height: 650 },
      { width: 1280, height: 720 },
    ];
    let side: 'left' | 'right' = 'right';
    let lastHeight = 0;
    for (let n = 0; n < sizes.length; n++) {
      const vp = sizes[n]!;
      await page.setViewportSize(vp);
      await page.waitForTimeout(500);
      const pick = await page.evaluate((sd) => {
        const s = (window as unknown as { __game: ClimbingHook }).__game.sport!;
        const index = s.nextHold(sd);
        return { index, screen: index >= 0 ? s.holdScreen(index) : null, h: s.height };
      }, side);
      expect(pick.index, `n=${n}`).toBeGreaterThanOrEqual(0);
      const px = pick.screen!.x * vp.width;
      const py = pick.screen!.y * vp.height;
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(vp.width);
      expect(py).toBeGreaterThan(0);
      expect(py).toBeLessThan(vp.height);
      await page.mouse.move(px, py);
      await page.waitForTimeout(150);
      // The hold under the tip of the real cursor is the one a press would take.
      const hover = await page.evaluate(
        ([x, y]) =>
          (window as unknown as { __game: ClimbingHook }).__game.sport!.pointerHoldAt(x!, y!),
        [pick.screen!.x, pick.screen!.y],
      );
      expect(hover, `n=${n} hover`).toBe(pick.index);
      await page.mouse.down();
      await page.waitForTimeout(300);
      const held = await page.evaluate(
        () => (window as unknown as { __game: ClimbingHook }).__game.sport!.holdIndex,
      );
      expect(held[side], `n=${n} ${side} grabbed`).toBe(pick.index);
      await page.mouse.move(px, py + 0.2 * vp.height, { steps: 8 });
      await page.waitForTimeout(300);
      await page.mouse.up();
      await page.waitForTimeout(250);
      lastHeight = pick.h;
      side = side === 'right' ? 'left' : 'right';
    }
    const end = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.sport!.height,
    );
    expect(end).toBeGreaterThan(lastHeight);
    expect(end).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });

  test('the hold layout is reproducible from the seed', async ({ browser }) => {
    const sums: number[] = [];
    for (const seed of [5, 5, 6]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await ctx.newPage();
      const problems = watch(page);
      await page.goto(`${SYNTHETIC}&seed=${seed}`);
      await waitPhase(page, 'playing');
      sums.push(
        await page.evaluate(
          () => (window as unknown as { __game: ClimbingHook }).__game.sport!.layoutChecksum,
        ),
      );
      expect(problems).toEqual([]);
      await ctx.close();
    }
    expect(sums[0]).toBe(sums[1]);
    expect(sums[0]).not.toBe(sums[2]);
  });

  // ---- tutorial ----

  const TUTORIAL = '/?sport=climbing&source=synthetic&skipGate=1&tutorial=1&timeScale=3';

  const readStep = (page: Page): Promise<number> =>
    page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.sport?.tutorialStep ?? -1,
    );

  test('tutorial: the normal hint line stays hidden, camera and mouse', async ({ page }) => {
    const problems: string[] = [];

    page.on('pageerror', (err) => problems.push(err.message));

    for (const url of [
      '/?sport=climbing&source=synthetic&skipGate=1&tutorial=1&timeScale=1',

      '/?sport=climbing&input=debug&skipGate=1&tutorial=1',
    ]) {
      await page.goto(url);

      await waitPhase(page, 'playing');

      await expect(page.locator('.coach')).toBeVisible();

      // The coach panel is the one instruction line; the sport's own hint steps aside.

      await expectNoHintFor(page, 3000);
    }

    expect(problems).toEqual([]);
  });

  test('the synthetic climber completes the tutorial and nothing is saved', async ({ page }) => {
    const problems = watch(page);
    await recordSteps(page);
    await page.goto(TUTORIAL);
    await waitPhase(page, 'playing');
    expect(
      await page.evaluate(() => (window as unknown as { __game: ClimbingHook }).__game.tutorial),
    ).toBe(true);
    await expect(page.locator('.coach')).toBeVisible();
    await expect(page.locator('.coach-count')).toHaveText(/^Step \d of 7$/);
    // No timer, no best.
    await expect(page.locator('.hud-sub')).toBeHidden();

    // Follow the steps by polling until the done screen shows.
    let overlap: string | null = null;
    let shot = false;
    // A deadline under the 180 s test timeout, so a hang says where it is stuck.
    const until = Date.now() + 150_000;
    for (;;) {
      const phase = await page.evaluate(
        () => (window as unknown as { __game: ClimbingHook }).__game.phase,
      );
      if (phase === 'tutorial-done') break;
      if (Date.now() >= until) throw await tutorialStuck(page, 'climbing synthetic', 150_000);
      const step = await readStep(page);
      // The panel never covers the score, the stamina meter or the top right controls.
      const hit = await page.evaluate(() => {
        const rect = (sel: string): DOMRect | null => {
          const el = document.querySelector<HTMLElement>(sel);
          if (el === null || el.hidden) return null;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 ? r : null;
        };
        const c = rect('.coach');
        if (c === null) return null;
        for (const sel of ['.hud-topleft', '.hud-meters', '.play-controls', '.hud-banner']) {
          const r = rect(sel);
          if (
            r !== null &&
            c.left < r.right &&
            r.left < c.right &&
            c.top < r.bottom &&
            r.top < c.bottom
          ) {
            return sel;
          }
        }
        return null;
      });
      if (hit !== null) overlap = `${hit} at step ${step}`;
      if (step === 5 && !shot) {
        shot = true;
        await page.screenshot({ path: `${SHOTS}/climbing-tutorial-play.png` });
      }
      await page.waitForTimeout(100);
    }
    await waitPhase(page, 'tutorial-done', 5000);
    expect(overlap).toBeNull();
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await page.screenshot({ path: `${SHOTS}/climbing-tutorial-done.png` });

    const hook = await page.evaluate(() => {
      const g = (window as unknown as { __game: ClimbingHook }).__game;
      return { result: g.result, isBest: g.isBest };
    });
    expect(hook.result).toBeNull();
    expect(hook.isBest).toBeNull();
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    await expect(page.locator('.screen-tutorialdone .results-headline')).toHaveText(
      'Tutorial done',
    );
    await expect(page.locator('.best-badge')).toHaveCount(0);

    // Back to menu: the sport still has no score.
    await page.getByRole('button', { name: 'Back to menu' }).click();
    await waitPhase(page, 'menu');
    await expect(page.locator('.sport-card[data-sport="climbing"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('Play now after the tutorial starts a normal round; S skips steps', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=climbing&source=synthetic&skipGate=1&tutorial=1&timeScale=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach')).toBeVisible();
    // Skip every step with the S key.
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('s');
      await page.waitForTimeout(150);
    }
    await waitPhase(page, 'tutorial-done', 10000);
    await page.getByRole('button', { name: 'Play now' }).click();
    await waitPhase(page, 'playing');
    const normal = await page.evaluate(() => {
      const g = (window as unknown as { __game: ClimbingHook }).__game;
      return { tutorial: g.tutorial, step: g.sport?.tutorialStep ?? -2 };
    });
    expect(normal.tutorial).toBe(false);
    expect(normal.step).toBe(-1);
    await expect(page.locator('.coach')).toBeHidden();
    await expect(page.locator('.hud-sub')).toContainText('s left');
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: Skip step and End tutorial buttons work', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach-text')).toHaveText('Press and hold a hold to grab it');
    // With the pointer parked off the wall, the panel says why nothing counted.
    await page.mouse.move(2, 2);
    await expect(page.locator('.coach-feedback')).toBeVisible({ timeout: 6000 });
    expect(await page.locator('.coach-feedback').textContent()).toMatch(
      /Move the pointer onto a hold|Keep the button down/,
    );
    await page.getByRole('button', { name: 'Skip step' }).click();
    await expect(page.locator('.coach-count')).toHaveText('Step 2 of 6');
    await page.getByRole('button', { name: 'End tutorial' }).click();
    await waitPhase(page, 'tutorial-done', 5000);
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: a player can finish it with press, drag and release', async ({ page }) => {
    test.setTimeout(100_000); // real pointer drags through every tutorial step, about 40 s alone
    const problems = watch(page);
    await recordSteps(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);
    const vp = page.viewportSize()!;
    const read = (): Promise<{
      step: number;
      phase: string;
      active: 'left' | 'right' | null;
      aimL: { x: number; y: number } | null;
      aimR: { x: number; y: number } | null;
    }> =>
      page.evaluate(() => {
        const g = (window as unknown as { __game: ClimbingHook }).__game;
        const s = g.sport;
        return {
          step: s?.tutorialStep ?? -1,
          phase: g.phase,
          active: s?.pointerHand ?? null,
          aimL: s?.aimImage('left') ?? null,
          aimR: s?.aimImage('right') ?? null,
        };
      });
    for (let n = 0; n < 60; n++) {
      const now = await read();
      if (now.phase === 'tutorial-done') break;
      if (now.step === 4) {
        // The hang step: just hold on for a moment.
        await page.waitForTimeout(600);
        continue;
      }
      const aim = now.active === 'left' ? now.aimL : now.aimR;
      if (aim === null) {
        await page.waitForTimeout(200);
        continue;
      }
      await page.mouse.move(aim.x * vp.width, aim.y * vp.height);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.waitForTimeout(250);
      await page.mouse.move(aim.x * vp.width, (aim.y + 0.28) * vp.height, { steps: 8 });
      await page.waitForTimeout(250);
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    await waitPhase(page, 'tutorial-done', 20000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3, 4, 5]);
    const result = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.result,
    );
    expect(result).toBeNull();
    await page.screenshot({ path: `${SHOTS}/climbing-tutorial-mouse-done.png` });
    expect(problems).toEqual([]);
  });
});
