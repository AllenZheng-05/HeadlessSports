import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface Pitch {
  index: number;
  kind: string;
  called: string;
  matched: boolean;
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
    called: string;
    callText: string;
    bubble: { visible: boolean; text: string; sub: string };
    aimMarker: { visible: boolean; x: number; y: number };
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

      // The catcher sets up first; then the call appears in a speech bubble.
      await waitSportPhase(page, 'call', 20000);
      await page.waitForFunction(
        () => (window as unknown as { __game: PitchingHook }).__game.sport?.bubble.visible === true,
        undefined,
        { timeout: 20000 },
      );
      const bubble = page.getByTestId('catcher-bubble');
      await expect(bubble).toBeVisible();
      const firstCall = await page.evaluate(
        () => (window as unknown as { __game: PitchingHook }).__game.sport!.callText,
      );
      await expect(bubble).toContainText(firstCall);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-call.png` });

      // Sign: the call stays up while the pitcher shows the called pitch.
      await waitSportPhase(page, 'sign', 20000);
      await page.waitForTimeout(500);
      await expect(bubble).toBeVisible();
      // The aim marker shows from the call until the release.
      await page.waitForFunction(
        () => (window as unknown as { __game: PitchingHook }).__game.sport?.aimMarker.visible,
        undefined,
        { timeout: 5000 },
      );
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-sign.png` });
      const drawCalls = await page.evaluate(
        () => (window as unknown as { __game: PitchingHook }).__game.drawCalls,
      );
      console.info(`draw calls: ${drawCalls}`);
      expect(drawCalls).toBeLessThan(55);

      await waitSportPhase(page, 'windup', 60000);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-windup.png` });

      // The ball in the air, with the grid visible; the marker and the call are gone.
      await waitSportPhase(page, 'flight', 60000);
      expect(
        await page.evaluate(
          () => (window as unknown as { __game: PitchingHook }).__game.sport!.aimMarker.visible,
        ),
      ).toBe(false);
      if (seed === 1) await page.screenshot({ path: `${SHOTS}/pitching-flight.png` });
      // The short round's result beat is brief, so wait for the pitch to be recorded.
      await page.waitForFunction(
        () =>
          ((window as unknown as { __game: PitchingHook }).__game.sport?.pitches.length ?? 0) > 0,
        undefined,
        { timeout: 60000 },
      );
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
      // The bot reads the call and throws the called pitch every time.
      for (const p of thrown) {
        expect(p.kind).toBe(p.called);
        expect(p.matched).toBe(true);
      }
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

  test('keyboard and mouse: read the call, show it, aim with the ring, throw', async ({ page }) => {
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
    const sportNow = (): Promise<{
      called: string;
      reading: string;
      marker: { visible: boolean; x: number; y: number };
      bubbleVisible: boolean;
    }> =>
      page.evaluate(() => {
        const sp = (window as unknown as { __game: PitchingHook }).__game.sport!;
        return {
          called: sp.called,
          reading: sp.reading,
          marker: sp.aimMarker,
          bubbleVisible: sp.bubble.visible,
        };
      });

    await page.goto('/?sport=pitching&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    // The call comes first, and the bubble is up before a pitch can be picked.
    await waitSportPhase(page, 'call', 10000);
    await expect(page.getByTestId('catcher-bubble')).toBeVisible({ timeout: 10000 });
    await waitSportPhase(page, 'sign', 20000);
    await page.waitForTimeout(300);

    const throwWith = async (mouseX: number, mouseY: number): Promise<Pitch> => {
      await waitSportPhase(page, 'sign', 30000);
      await page.mouse.move(mouseX, mouseY);
      await page.waitForTimeout(200);
      // Show the called pitch: a closed fist is a fastball, an open hand a curve. E toggles the fist.
      const now = await sportNow();
      expect(now.bubbleVisible).toBe(true);
      if (now.reading !== now.called) {
        await press('KeyE');
        await release('KeyE');
      }
      await waitSportPhase(page, 'windup', 15000);
      await page.waitForTimeout(500);
      await page.mouse.move(mouseX, mouseY);
      await page.waitForTimeout(100);
      // The aim marker shows before the release, and the pitch goes where it points.
      const aim = (await sportNow()).marker;
      expect(aim.visible).toBe(true);
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
      const last = all[all.length - 1]!;
      expect(Math.abs(last.x - aim.x)).toBeLessThan(0.02);
      expect(Math.abs(last.y - aim.y)).toBeLessThan(0.02);
      expect(last.matched).toBe(true);
      return last;
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
