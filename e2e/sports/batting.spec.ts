import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameHook } from '../../src/core/shell/hook';
import type { BattingProbe } from '../../src/sports/batting/index';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Game = Pick<GameHook, 'phase' | 'error'> & {
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
};

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
      (p) => (window as unknown as { __game?: Game }).__game?.phase === p,
      phase,
      { timeout },
    );
  } catch (err) {
    const now = await page.evaluate(() => {
      const g = (window as unknown as { __game?: Game }).__game;
      return g ? `${g.phase} (error: ${g.error ?? 'none'})` : 'no __game';
    });
    throw new Error(`Never reached phase "${phase}"; stuck at ${now}.`, { cause: err });
  }
}

function result(page: Page): Promise<Game['result']> {
  return page.evaluate(() => (window as unknown as { __game: Game }).__game.result);
}

function resolved(page: Page): Promise<BattingProbe['results'][number][]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __game: { sport: BattingProbe } }).__game.sport;
    return s.results.map((r) => ({ ...r }));
  });
}

async function waitResolved(page: Page, count: number, timeout = 20000): Promise<void> {
  await page.waitForFunction(
    (n) =>
      (window as unknown as { __game: { sport: BattingProbe } }).__game.sport.results.length >= n,
    count,
    { timeout },
  );
}

/**
 * Press S inside the page, on the animation frame where the swing will start `offsetMs` after the
 * ball arrives minus the bat's travel time. The key is applied on the next update, so the press is
 * made one measured frame early. Waits for the next pitch to be in its wind-up first and sets the
 * mouse height so the bat meets the ball.
 */
function swingAt(page: Page, offsetMs: number): Promise<{ arrival: number; clock: number }> {
  return page.evaluate(
    (offset) =>
      new Promise<{ arrival: number; clock: number }>((resolve, reject) => {
        const g = (
          window as unknown as {
            __game: {
              sport: BattingProbe;
              debugInput: {
                press(c: string): void;
                release(c: string): void;
                moveTo(x: number, y: number): void;
              };
            };
          }
        ).__game;
        const started = performance.now();
        let lastClock = -1;
        let frameMs = 16;
        let armed = false;
        let arrival = 0;
        const tick = (): void => {
          const s = g.sport;
          if (performance.now() - started > 15000) {
            reject(new Error('no pitch to swing at'));
            return;
          }
          if (lastClock >= 0 && s.clockMs > lastClock) frameMs = s.clockMs - lastClock;
          lastClock = s.clockMs;
          if (!armed && s.arrivalMs > 0 && s.arrivalMs - s.clockMs > 400) {
            armed = true;
            // Bat 0.1 m below the ball: hands height (sw) = (ball - 0.1 - 0.95) / 0.4; mouse y = 0.5 - sw / 2.
            const sw = (s.targetHeightM - 0.1 - 0.95) / 0.4;
            g.debugInput.moveTo(0.5, 0.5 - sw / 2);
          }
          // The arrival is read live: a long stall shifts the timeline, and the arrival with it.
          arrival = s.arrivalMs;
          if (armed && arrival > 0 && s.clockMs >= arrival + offset - 130 - frameMs) {
            g.debugInput.press('KeyS');
            g.debugInput.release('KeyS');
            resolve({ arrival, clock: s.clockMs });
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    offsetMs,
  );
}

for (const hand of ['right', 'left'] as const) {
  test.describe(`batting, ${hand}-handed`, () => {
    test('the synthetic player finishes a short round and hits the ball', async ({ page }) => {
      const problems = watch(page);
      await page.goto(
        `/?sport=batting&source=synthetic&skipGate=1&short=1&timeScale=2&hand=${hand}`,
      );
      await waitPhase(page, 'playing');

      await waitPhase(page, 'results', 150000);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/batting-results-${hand}.png` });
      const r = await result(page);
      expect(r?.detail?.pitches).toBe(3);
      expect(r?.detail?.hits ?? 0).toBeGreaterThanOrEqual(1);
      expect(r?.score ?? 0).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });

    test('the batter stands side-on on the correct side and the pitcher runs a set, wind-up, release cycle', async ({
      page,
    }) => {
      const problems = watch(page);
      await page.goto(
        `/?sport=batting&source=synthetic&skipGate=1&short=1&timeScale=2&hand=${hand}`,
      );
      await waitPhase(page, 'playing');
      // A right-hander is on the screen-left of the plate (x < 0), a left-hander on the screen-right.
      const b = await page.evaluate(
        () => (window as unknown as { __game: { sport: BattingProbe } }).__game.sport.batter,
      );
      expect(Math.sign(b.x)).toBe(hand === 'right' ? -1 : 1);
      expect(Math.abs(b.yaw)).toBeCloseTo(Math.PI / 2, 5);
      expect(Math.sign(b.yaw)).toBe(hand === 'right' ? -1 : 1);

      // Sample the stage on every animation frame until the first pitch has been released.
      const seq = await page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const g = (window as unknown as { __game: { sport: BattingProbe } }).__game;
            const seen: string[] = [];
            const started = performance.now();
            const tick = (): void => {
              const st = g.sport.stage;
              if (seen[seen.length - 1] !== st) seen.push(st);
              if (st === 'flight' || performance.now() - started > 30000) resolve(seen);
              else requestAnimationFrame(tick);
            };
            tick();
          }),
      );
      const order = ['reset', 'set', 'windup', 'flight'];
      expect(seq.filter((x) => order.includes(x))).toEqual(order);
      expect(problems).toEqual([]);
    });

    // A screenshot takes about 0.7 s of real time, so the screenshots are taken at a quarter speed.
    test('slow motion: the ball in the air and the hit ball in flight', async ({ page }) => {
      const problems = watch(page);
      await page.goto(
        `/?sport=batting&source=synthetic&skipGate=1&short=1&timeScale=0.25&hand=${hand}`,
      );
      await waitPhase(page, 'playing');
      await page.waitForFunction(
        () => {
          const s = (window as unknown as { __game: { sport: BattingProbe | null } }).__game.sport;
          return (
            s !== null &&
            s.arrivalMs > 0 &&
            s.arrivalMs - s.clockMs < 420 &&
            s.arrivalMs - s.clockMs > 250
          );
        },
        undefined,
        { timeout: 90000, polling: 'raf' },
      );
      // The ball is in the air, and the whole scene stays well under the draw-call budget.
      const probe = await page.evaluate(() => {
        const g = (window as unknown as { __game: { sport: BattingProbe; drawCalls: number } })
          .__game;
        return { ball: g.sport.ball, drawCalls: g.drawCalls };
      });
      expect(probe.ball.visible).toBe(true);
      expect(probe.drawCalls).toBeLessThan(50);
      await page.screenshot({ path: `${SHOTS}/batting-pitch-${hand}.png` });
      await waitResolved(page, 1, 60000);
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${SHOTS}/batting-hit-${hand}.png` });
      expect((await resolved(page))[0]!.kind).toBe('hit');
      expect(problems).toEqual([]);
    });

    test('keyboard and mouse: a well-timed press hits, a late press is too late', async ({
      page,
    }) => {
      const problems = watch(page);
      // A small viewport keeps the software renderer fast, so a frame (the press's timing resolution)
      // is short compared with the timing window.
      await page.setViewportSize({ width: 480, height: 270 });
      await page.goto(`/?sport=batting&input=debug&skipGate=1&short=1&hand=${hand}`);
      await waitPhase(page, 'playing');

      // Pitch 1: contact on the ball.
      await swingAt(page, 0);
      await waitResolved(page, 1);
      const first = (await resolved(page))[0]!;
      expect(first.kind).toBe('hit');
      expect(first.distance).toBeGreaterThan(0);
      expect(Math.abs(first.timingError ?? 999)).toBeLessThanOrEqual(160);

      // Pitch 2: the bat arrives about 260 ms after the ball.
      await swingAt(page, 260);
      await waitResolved(page, 2);
      const second = (await resolved(page))[1]!;
      expect(second.kind).toBe('miss');
      expect(second.label).toBe('Too late');
      expect(second.distance).toBe(0);

      // Pitch 3: no swing is a strike, then the round ends.
      await waitResolved(page, 3);
      expect((await resolved(page))[2]!.kind).toBe('strike');
      await waitPhase(page, 'results', 30000);
      const r = await result(page);
      expect(r?.detail?.pitches).toBe(3);
      expect(r?.detail?.hits).toBe(1);
      expect(r?.score ?? 0).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  });
}
