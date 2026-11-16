import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHintFor, waitTutorialDone } from './tutorialHelpers';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface JavelinRecord {
  foul: boolean;
  distance: number;
  runSpeed: number;
  throwSpeed: number;
  angleDeg: number;
  lineGap: number;
}

interface JavelinHook {
  phase: string;
  error: string | null;
  tutorial: boolean;
  isBest: boolean | null;
  result: {
    score: number;
    headline: string;
    lines?: string[];
    detail?: Record<string, number>;
  } | null;
  sport: {
    phase: string;
    position: number;
    distanceToLine: number;
    speed: number;
    attempt: number;
    best: number;
    records: JavelinRecord[];
    ignoredThrows: number;
    log: string[];
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
      (p) => (window as unknown as { __game: JavelinHook }).__game.phase === p,
      phase,
      { timeout },
    );
  } catch (err) {
    const now = await page.evaluate(() => {
      const g = (window as unknown as { __game: JavelinHook }).__game;
      return `${g.phase} (error: ${g.error ?? 'none'}, sport phase: ${g.sport?.phase ?? 'none'})`;
    });
    throw new Error(`Never reached phase "${phase}"; stuck at ${now}.`, { cause: err });
  }
}

const sportPhase = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __game: JavelinHook }).__game.sport?.phase ?? '');

async function waitSportPhase(page: Page, phase: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (p) => (window as unknown as { __game: JavelinHook }).__game.sport?.phase === p,
    phase,
    { timeout },
  );
}

test.describe('javelin', () => {
  for (const seed of [1, 2, 3]) {
    test(`the synthetic athlete plays a full short round (seed ${seed})`, async ({ page }) => {
      const problems = watch(page);
      await page.goto(
        `/?sport=javelin&source=synthetic&skipGate=1&short=1&timeScale=2&seed=${seed}`,
      );
      await waitPhase(page, 'playing');

      // Mid-run, with the foul-line meter.
      await page.waitForFunction(
        () => ((window as unknown as { __game: JavelinHook }).__game.sport?.position ?? 0) > 12,
        undefined,
        { timeout: 90000 },
      );
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/javelin-run.png` });
      const drawCalls = await page.evaluate(
        () => (window as unknown as { __game: JavelinHook }).__game.drawCalls,
      );
      console.info(`draw calls: ${drawCalls}`);
      expect(drawCalls).toBeLessThan(45);

      // Javelin in the air.
      await waitSportPhase(page, 'flight', 90000);
      if (seed === 1) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/javelin-flight.png` });
      }
      if (seed === 1) {
        await waitSportPhase(page, 'result', 30000);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/javelin-landed.png` });
      }

      await waitPhase(page, 'results', 150000);
      const result = await page.evaluate(
        () => (window as unknown as { __game: JavelinHook }).__game.result,
      );
      const recs = await page.evaluate(
        () => (window as unknown as { __game: JavelinHook }).__game.sport?.records ?? [],
      );
      console.info(`seed ${seed}: ${JSON.stringify(result)} records ${JSON.stringify(recs)}`);
      console.info(
        (
          await page.evaluate(
            () => (window as unknown as { __game: JavelinHook }).__game.sport?.log ?? [],
          )
        ).join(' | '),
      );
      expect(result).not.toBeNull();
      expect(recs).toHaveLength(1);
      if (seed === 1) {
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${SHOTS}/javelin-results.png` });
      }
      if (seed === 1) expect(result!.score).toBeGreaterThan(10);
      expect(problems).toEqual([]);
    });
  }

  test('the synthetic athlete plays all three attempts', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=javelin&source=synthetic&skipGate=1&timeScale=4&seed=5');
    await waitPhase(page, 'playing');
    await waitPhase(page, 'results', 160000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: JavelinHook }).__game.result,
    );
    console.info(`three attempts: ${JSON.stringify(result)}`);
    expect(result!.lines).toBeDefined();
    expect(result!.detail?.attempts).toBe(3);
    expect(result!.score).toBeGreaterThan(10);
    expect(problems).toEqual([]);
  });

  const gameResult = (page: Page): Promise<JavelinHook['result']> =>
    page.evaluate(() => (window as unknown as { __game: JavelinHook }).__game.result);
  const lineGapBelow = (page: Page, metres: number): Promise<unknown> =>
    page.waitForFunction(
      (m) => {
        const s = (window as unknown as { __game: JavelinHook }).__game.sport;
        return s !== null && s.phase === 'run' && s.distanceToLine < m;
      },
      metres,
      { timeout: 30000 },
    );
  async function startMouseRound(page: Page): Promise<void> {
    await page.goto('/?sport=javelin&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(400);
    expect(await sportPhase(page)).toBe('ready');
    // No start gesture: the run begins by itself after the get-ready beat.
    await waitSportPhase(page, 'run', 8000);
    await page.mouse.move(600, 400);
  }

  test('mouse: holding runs, letting go before the line is a scoring throw', async ({ page }) => {
    const problems = watch(page);
    await startMouseRound(page);
    await page.mouse.down();
    await lineGapBelow(page, 4);
    await page.mouse.up();
    await waitSportPhase(page, 'flight', 5000);
    await waitPhase(page, 'results', 60000);
    const result = await gameResult(page);
    console.info(`mouse throw: ${JSON.stringify(result)}`);
    expect(result!.score).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });

  test('mouse: pressing during the get-ready beat starts the run when it ends', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/?sport=javelin&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.mouse.move(600, 400);
    await page.mouse.down();
    expect(await sportPhase(page)).toBe('ready');
    await waitSportPhase(page, 'run', 8000);
    await page.waitForFunction(
      () => ((window as unknown as { __game: JavelinHook }).__game.sport?.speed ?? 0) > 3,
      undefined,
      { timeout: 8000 },
    );
    await page.mouse.up();
    await waitPhase(page, 'results', 60000);
    expect(problems).toEqual([]);
  });

  test('mouse: letting go after the line is a foul', async ({ page }) => {
    const problems = watch(page);
    await startMouseRound(page);
    await page.mouse.down();
    await lineGapBelow(page, -0.1);
    await page.mouse.up();
    await waitPhase(page, 'results', 60000);
    const result = await gameResult(page);
    console.info(`mouse late release: ${JSON.stringify(result)}`);
    expect(result!.score).toBe(0);
    expect(result!.headline).toBe('No mark');
    expect(problems).toEqual([]);
  });

  test('mouse: holding across the line is a foul', async ({ page }) => {
    const problems = watch(page);
    await startMouseRound(page);
    await page.mouse.down();
    await waitPhase(page, 'results', 60000);
    const result = await gameResult(page);
    expect(result!.score).toBe(0);
    expect(result!.headline).toBe('No mark');
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test('a faster-running bot throws farther than a slower one with the same arm', async ({
    page,
  }) => {
    const problems = watch(page);
    const distances: Record<string, number> = {};
    const speeds: Record<string, number> = {};
    for (const variant of ['slow', 'fast']) {
      await page.goto(
        `/?sport=javelin&source=synthetic&skipGate=1&short=1&timeScale=4&seed=7&botRun=${variant}`,
      );
      await waitPhase(page, 'playing');
      await waitPhase(page, 'results', 150000);
      const recs = await page.evaluate(
        () => (window as unknown as { __game: JavelinHook }).__game.sport?.records ?? [],
      );
      expect(recs).toHaveLength(1);
      expect(recs[0]!.foul).toBe(false);
      distances[variant] = recs[0]!.distance;
      speeds[variant] = recs[0]!.runSpeed;
    }
    console.info(`slow ${JSON.stringify(distances)} run speeds ${JSON.stringify(speeds)}`);
    expect(speeds.fast!).toBeGreaterThan(speeds.slow! + 1.5);
    expect(distances.fast!).toBeGreaterThan(distances.slow! + 3);
    expect(problems).toEqual([]);
  });

  test('a whole-body jog (arm pump, torso bob, small knees) runs the athlete and throws', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto(
      '/?sport=javelin&source=synthetic&skipGate=1&short=1&timeScale=4&seed=3&botStyle=jog',
    );
    await waitPhase(page, 'playing');
    await page.waitForFunction(
      () => ((window as unknown as { __game: JavelinHook }).__game.sport?.speed ?? 0) > 3,
      undefined,
      { timeout: 60000 },
    );
    await waitPhase(page, 'results', 150000);
    const recs = await page.evaluate(
      () => (window as unknown as { __game: JavelinHook }).__game.sport?.records ?? [],
    );
    console.info(`jog bot: ${JSON.stringify(recs)}`);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.foul).toBe(false);
    expect(recs[0]!.runSpeed).toBeGreaterThan(2.5);
    expect(recs[0]!.distance).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  // ---- tutorial ----

  /**
   * Record every tutorial step the sport passes through, in the page from the first frame, so a
   * fast step is not missed. Call before `page.goto`.
   */
  async function recordSteps(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const w = window as unknown as { __game?: JavelinHook; __steps: number[] };
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
  const readStep = (page: Page): Promise<number> =>
    page.evaluate(
      () => (window as unknown as { __game: JavelinHook }).__game.sport?.tutorialStep ?? -1,
    );
  const waitStep = (page: Page, step: number, timeout: number): Promise<unknown> =>
    page.waitForFunction(
      (n) => ((window as unknown as { __game: JavelinHook }).__game.sport?.tutorialStep ?? -1) >= n,
      step,
      { timeout },
    );

  test('tutorial: the normal hint line stays hidden, camera and mouse', async ({ page }) => {
    const problems: string[] = [];

    page.on('pageerror', (err) => problems.push(err.message));

    for (const url of [
      '/?sport=javelin&source=synthetic&skipGate=1&tutorial=1&timeScale=1',

      '/?sport=javelin&input=debug&skipGate=1&tutorial=1',
    ]) {
      await page.goto(url);

      await waitPhase(page, 'playing');

      await expect(page.locator('.coach')).toBeVisible();

      // The coach panel is the one instruction line; the sport's own hint steps aside.

      await expectNoHintFor(page, 3000);
    }

    expect(problems).toEqual([]);
  });

  test('the synthetic athlete completes the tutorial and nothing is saved', async ({ page }) => {
    test.setTimeout(180_000); // about 2.5x the 66 s whole run (timeScale 3, machine busy)
    const problems = watch(page);
    await recordSteps(page);
    await page.goto('/?sport=javelin&source=synthetic&skipGate=1&tutorial=1&timeScale=3');
    await waitPhase(page, 'playing');
    expect(
      await page.evaluate(() => (window as unknown as { __game: JavelinHook }).__game.tutorial),
    ).toBe(true);
    await expect(page.locator('.coach')).toBeVisible();
    await expect(page.locator('.coach-count')).toHaveText(/^Step \d of 6$/);
    // No try count, no best.
    await expect(page.locator('.hud-score')).toHaveText('Practice');
    await expect(page.locator('.hud-sub')).not.toContainText('Best');

    let shot = false;
    // A deadline well under the 180 s test timeout, so a hang says where it is stuck.
    await waitTutorialDone(page, 'javelin synthetic', 150_000, async () => {
      if (!shot && (await readStep(page)) === 4) {
        shot = true;
        await page.screenshot({ path: `${SHOTS}/javelin-tutorial-play.png` });
      }
    });
    await waitPhase(page, 'tutorial-done', 5000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3, 4, 5]);
    await page.screenshot({ path: `${SHOTS}/javelin-tutorial-done.png` });

    const hook = await page.evaluate(() => {
      const g = (window as unknown as { __game: JavelinHook }).__game;
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
    await expect(page.locator('.sport-card[data-sport="javelin"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('Play now after the tutorial starts a normal round; S skips steps', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=javelin&source=synthetic&skipGate=1&tutorial=1&timeScale=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach')).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('s');
      await page.waitForTimeout(150);
    }
    await waitPhase(page, 'tutorial-done', 10000);
    await page.getByRole('button', { name: 'Play now' }).click();
    await waitPhase(page, 'playing');
    const normal = await page.evaluate(() => {
      const g = (window as unknown as { __game: JavelinHook }).__game;
      return { tutorial: g.tutorial, step: g.sport?.tutorialStep ?? -2 };
    });
    expect(normal.tutorial).toBe(false);
    expect(normal.step).toBe(-1);
    await expect(page.locator('.coach')).toBeHidden();
    await expect(page.locator('.hud-score')).toHaveText('Try 1/3');
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: Skip step and End tutorial buttons work', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=javelin&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach-text')).toHaveText('Press and hold the button to run');
    // Nothing held: after a pause the panel says what to do.
    await expect(page.locator('.coach-feedback')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.coach-feedback')).toHaveText('Press and hold the mouse button');
    await page.getByRole('button', { name: 'Skip step' }).click();
    await expect(page.locator('.coach-count')).toHaveText('Step 2 of 3');
    await page.getByRole('button', { name: 'End tutorial' }).click();
    await waitPhase(page, 'tutorial-done', 5000);
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: a player can finish it with hold and release', async ({ page }) => {
    test.setTimeout(180_000); // real mouse holds through every step, 72 s measured under load
    const problems = watch(page);
    await recordSteps(page);
    await page.goto('/?sport=javelin&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await page.mouse.move(600, 400);

    // Step 1: hold to run.
    await waitSportPhase(page, 'run', 8000);
    await page.mouse.down();
    await waitStep(page, 1, 15000);
    // Step 2: keep running, let go before the line.
    await lineGapBelow(page, 4);
    await page.mouse.up();
    await waitStep(page, 2, 20000);
    // Step 3: once more.
    await waitSportPhase(page, 'run', 8000);
    await page.mouse.down();
    await lineGapBelow(page, 4);
    await page.mouse.up();
    await waitPhase(page, 'tutorial-done', 30000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2]);
    expect(await gameResult(page)).toBeNull();
    await page.screenshot({ path: `${SHOTS}/javelin-tutorial-mouse-done.png` });
    expect(problems).toEqual([]);
  });
});
