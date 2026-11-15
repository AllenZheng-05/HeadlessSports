import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
});
