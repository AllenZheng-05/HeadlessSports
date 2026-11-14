import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface Pitch {
  index: number;
  kind: string;
  target: number;
  balk: boolean;
  x: number;
  y: number;
  kmh: number;
  points: number;
  tier: string;
  cell: number;
}

interface PitchingHook {
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
    index: number;
    kind: string;
    reading: string;
    target: number;
    score: number;
    pitches: Pitch[];
    ignoredThrows: number;
    ignoredWrongHand: number;
    usedFallback: boolean;
    ball: { visible: boolean; x: number; y: number; z: number };
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
      (p) => (window as unknown as { __game: PitchingHook }).__game.phase === p,
      phase,
      { timeout },
    );
  } catch (err) {
    const now = await page.evaluate(() => {
      const g = (window as unknown as { __game: PitchingHook }).__game;
      return `${g.phase} (error: ${g.error ?? 'none'}, sport phase: ${g.sport?.phase ?? 'none'})`;
    });
    throw new Error(`Never reached phase "${phase}"; stuck at ${now}.`, { cause: err });
  }
}

async function waitSportPhase(page: Page, phase: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (p) => (window as unknown as { __game: PitchingHook }).__game.sport?.phase === p,
    phase,
    { timeout },
  );
}

const pitches = (page: Page): Promise<Pitch[]> =>
  page.evaluate(() => (window as unknown as { __game: PitchingHook }).__game.sport?.pitches ?? []);

test.describe('pitching', () => {
  for (const seed of [1, 2]) {
    test(`the synthetic pitcher plays a full short round (seed ${seed})`, async ({ page }) => {
      const problems = watch(page);
      await page.goto(
        `/?sport=pitching&source=synthetic&skipGate=1&short=1&timeScale=2&seed=${seed}`,
      );
      await waitPhase(page, 'playing');

      // Sign: the grid, the catcher and the hint with the pitcher still deciding.
      await waitSportPhase(page, 'sign', 20000);
      await page.waitForTimeout(500);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-sign.png` });
      const drawCalls = await page.evaluate(
        () => (window as unknown as { __game: PitchingHook }).__game.drawCalls,
      );
      console.info(`draw calls: ${drawCalls}`);
      expect(drawCalls).toBeLessThan(55);

      await waitSportPhase(page, 'windup', 60000);
      await page.waitForTimeout(300);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-windup.png` });

      // The ball in the air, with the grid visible.
      await waitSportPhase(page, 'flight', 60000);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-flight.png` });
      await waitSportPhase(page, 'result', 60000);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-result.png` });

      await waitPhase(page, 'results', 170000);
      const result = await page.evaluate(
        () => (window as unknown as { __game: PitchingHook }).__game.result,
      );
      const thrown = await pitches(page);
      console.info(`result ${JSON.stringify(result)}`);
      console.info(`pitches ${JSON.stringify(thrown)}`);
      console.info(
        (
          await page.evaluate(
            () => (window as unknown as { __game: PitchingHook }).__game.sport?.log ?? [],
          )
        ).join(' | '),
      );
      expect(result).not.toBeNull();
      expect(result!.detail?.pitches).toBe(3);
      expect(result!.detail?.balks).toBe(0);
      expect(result!.score).toBeGreaterThan(0);
      expect(thrown).toHaveLength(3);
      if (seed === 1) await page.waitForTimeout(600);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-results.png` });
      expect(problems).toEqual([]);
    });
  }

  test('the slow-motion pitch is visible in the air', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=pitching&source=synthetic&skipGate=1&short=1&timeScale=0.25');
    await waitPhase(page, 'playing');
    await waitSportPhase(page, 'flight', 170000);
    await page.waitForTimeout(250);
    const ball = await page.evaluate(
      () => (window as unknown as { __game: PitchingHook }).__game.sport?.ball,
    );
    console.info(`ball in flight ${JSON.stringify(ball)}`);
    expect(ball?.visible).toBe(true);
    await page.screenshot({ path: `${SHOTS}/pitching-flight-slow.png` });
    expect(problems).toEqual([]);
  });

  test('keyboard and mouse: pick a pitch, throw, and the mouse moves the ball', async ({
    page,
  }) => {
    const problems = watch(page);
    const press = (code: string): Promise<void> =>
      page.evaluate(
        (c) => (window as unknown as { __game: PitchingHook }).__game.debugInput?.press(c),
        code,
      );
    const release = (code: string): Promise<void> =>
      page.evaluate(
        (c) => (window as unknown as { __game: PitchingHook }).__game.debugInput?.release(c),
        code,
      );

    await page.goto('/?sport=pitching&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await waitSportPhase(page, 'sign', 10000);
    await page.waitForTimeout(300);

    const throwWith = async (mouseX: number, mouseY: number): Promise<Pitch> => {
      await waitSportPhase(page, 'sign', 30000);
      await page.mouse.move(mouseX, mouseY);
      // E toggles the throwing hand's fist (closed fastball, open curve). The hand holds still, so
      // the sign picks whichever the hand shows after the hold.
      await press('KeyE');
      await release('KeyE');
      await waitSportPhase(page, 'windup', 15000);
      await page.waitForTimeout(500);
      await page.mouse.move(mouseX, mouseY);
      await press('KeyT');
      await page.waitForTimeout(500);
      await release('KeyT');
      const before = (await pitches(page)).length;
      await page.waitForFunction(
        (n) =>
          ((window as unknown as { __game: PitchingHook }).__game.sport?.pitches.length ?? 0) > n,
        before,
        {
          timeout: 20000,
        },
      );
      const all = await pitches(page);
      return all[all.length - 1]!;
    };

    const left = await throwWith(40, 360);
    const right = await throwWith(1240, 360);
    console.info(`left ${JSON.stringify(left)} right ${JSON.stringify(right)}`);
    expect(left.balk).toBe(false);
    expect(right.balk).toBe(false);
    expect(left.points).toBeGreaterThanOrEqual(0);
    expect(left.x).toBeLessThan(right.x);
    expect(['fastball', 'curve']).toContain(left.kind);

    // The third pitch ends the short round.
    await throwWith(640, 360);
    await waitPhase(page, 'results', 30000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: PitchingHook }).__game.result,
    );
    expect(result!.detail?.pitches).toBe(3);
    expect(problems).toEqual([]);
  });
});
