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

/** How far ahead of the ball a click must be sent, learned from clicks that do nothing. */
interface ClickTiming {
  lead: number;
}

/**
 * Measure how long a real press from the test process takes to reach the sport, in page ms. The
 * Playwright round trip is far from free with the software renderer while the scene is drawing (100
 * to 300 ms), so it is measured with the same call, under the same load. The probe presses are made
 * between pitches, where the sport ignores a click, then two frames are added for the input to be
 * applied and delivered. Does nothing when there is no safe moment left.
 */
async function calibrateClick(page: Page, timing: ClickTiming): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __md?: number; __mdOn?: boolean };
    if (w.__mdOn) return;
    w.__mdOn = true;
    window.addEventListener('mousedown', () => (w.__md = performance.now()), true);
  });
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  const lat: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = await page.evaluate(() => {
      const s = (window as unknown as { __game: { sport: BattingProbe } }).__game.sport;
      return s.stage === 'result' || s.stage === 'reset' ? performance.now() : -1;
    });
    if (t0 < 0) break;
    await page.mouse.down();
    await page.mouse.up();
    const md = await page.evaluate(() => (window as unknown as { __md: number }).__md);
    if (i >= 1) lat.push(md - t0);
  }
  if (lat.length === 0) return;
  const frame = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const a = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - a)));
      }),
  );
  timing.lead = Math.max(...lat) + frame;
}

/**
 * Click the mouse (real `page.mouse` presses) so that the bat meets the ball `offsetMs` after it
 * arrives, leading by the measured click timing. Waits for the next pitch first. Returns the arrival
 * that was aimed at.
 */
async function clickAt(page: Page, offsetMs: number, timing: ClickTiming): Promise<number> {
  await calibrateClick(page, timing);
  const arrival = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const g = (window as unknown as { __game: { sport: BattingProbe } }).__game;
        const started = performance.now();
        const tick = (): void => {
          const s = g.sport;
          if (s.arrivalMs > 0 && s.arrivalMs - s.clockMs > 400) resolve(s.arrivalMs);
          else if (performance.now() - started > 15000) reject(new Error('no pitch to swing at'));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  // The arrival is read live: a long stall shifts the timeline, and the arrival with it.
  await page.waitForFunction(
    ([offset, ahead, travel]) => {
      const s = (window as unknown as { __game: { sport: BattingProbe } }).__game.sport;
      return s.arrivalMs > 0 && s.clockMs >= s.arrivalMs + offset - travel - ahead;
    },
    [offsetMs, timing.lead, 130] as const,
    { timeout: 15000, polling: 'raf' },
  );
  await page.mouse.down();
  await page.mouse.up();
  return arrival;
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
      expect(r?.headline).toMatch(/^\d+ ft$/);
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

    test('mouse: a well-timed click hits, a late click is too late', async ({ page }) => {
      const problems = watch(page);
      // A small viewport keeps the software renderer fast, so a frame (the click's timing resolution)
      // is short compared with the timing window.
      await page.setViewportSize({ width: 480, height: 270 });
      await page.goto(`/?sport=batting&input=debug&skipGate=1&short=1&hand=${hand}`);
      await waitPhase(page, 'playing');
      const timing: ClickTiming = { lead: 150 };

      // Pitch 1: contact on the ball.
      await clickAt(page, 0, timing);
      await waitResolved(page, 1);
      const first = (await resolved(page))[0]!;
      expect(first.kind).toBe('hit');
      expect(first.distance).toBeGreaterThan(0);
      expect(Math.abs(first.timingError ?? 999)).toBeLessThanOrEqual(160);

      // Pitch 2: the bat arrives about 290 ms after the ball (a click, no aiming: only timing matters).
      await clickAt(page, 290, timing);
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
