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
  debugInput: { press(code: string): void; release(code: string): void } | null;
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

  test('keyboard and mouse: a valid throw, then a foul round', async ({ page }) => {
    const problems = watch(page);
    const call = (fn: string, code: string): Promise<void> =>
      page.evaluate(
        ([f, c]) => {
          const d = (window as unknown as { __game: JavelinHook }).__game
            .debugInput as unknown as Record<string, (code: string) => void>;
          d[f as string]!(c as string);
        },
        [fn, code] as const,
      );

    await page.goto('/?sport=javelin&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(400);
    expect(await sportPhase(page)).toBe('ready');
    // Raise the arm (open hand: needs the hold) and lower it.
    await call('press', 'KeyU');
    await page.waitForTimeout(900);
    await call('release', 'KeyU');
    await waitSportPhase(page, 'run', 5000);
    await call('press', 'ArrowUp');
    await page.waitForFunction(
      () => {
        const s = (window as unknown as { __game: JavelinHook }).__game.sport;
        return s !== null && s.distanceToLine < 9.5 && s.distanceToLine > 7;
      },
      undefined,
      { timeout: 30000 },
    );
    await call('press', 'KeyT');
    await page.waitForTimeout(600);
    await call('release', 'KeyT');
    await call('release', 'ArrowUp');
    await waitPhase(page, 'results', 60000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: JavelinHook }).__game.result,
    );
    console.info(`debug throw: ${JSON.stringify(result)}`);
    expect(result!.score).toBeGreaterThan(10);
    expect(problems).toEqual([]);

    // Second round: never throw. The athlete crosses the line: foul, score 0.
    await page.goto('/?sport=javelin&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(400);
    await call('press', 'KeyU');
    await page.waitForTimeout(900);
    await call('release', 'KeyU');
    await waitSportPhase(page, 'run', 5000);
    await call('press', 'ArrowUp');
    await waitPhase(page, 'results', 60000);
    const foul = await page.evaluate(
      () => (window as unknown as { __game: JavelinHook }).__game.result,
    );
    console.info(`debug foul: ${JSON.stringify(foul)}`);
    expect(foul!.score).toBe(0);
    expect(foul!.headline).toBe('No mark');
    expect(problems).toEqual([]);
  });
});
