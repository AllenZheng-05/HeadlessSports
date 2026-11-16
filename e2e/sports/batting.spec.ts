import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameHook } from '../../src/core/shell/hook';
import { expectNoHintFor, waitTutorialDone } from './tutorialHelpers';
import type { BattingProbe } from '../../src/sports/batting/index';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Game = Pick<GameHook, 'phase' | 'error'> & {
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
  isBest: boolean | null;
  tutorial: boolean;
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
  /** Where the pointer rests, in viewport pixels (default the middle). */
  at?: { x: number; y: number };
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
  const at = timing.at ?? { x: size.width / 2, y: size.height / 2 };
  await page.mouse.move(at.x, at.y);
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

// ---- tutorial ----

/**
 * Record every tutorial step the sport passes through, in the page from the first frame, so a fast
 * step is not missed. Call before `page.goto`.
 */
async function recordSteps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __game?: { sport: BattingProbe | null };
      __steps: number[];
    };
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

const tutorialStep = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as { __game: { sport: BattingProbe | null } }).__game.sport
        ?.tutorialStep ?? -1,
  );

test.describe('batting tutorial', () => {
  const TUTORIAL = '/?sport=batting&source=synthetic&skipGate=1&tutorial=1&timeScale=3';

  for (const hand of ['right', 'left'] as const) {
    test(`the synthetic ${hand}-handed batter completes the tutorial and nothing is saved`, async ({
      page,
    }) => {
      test.setTimeout(60_000); // about 21 s alone at timeScale 3 (35 s on a busy machine)
      const problems = watch(page);
      await recordSteps(page);
      await page.goto(`${TUTORIAL}&hand=${hand}`);
      await waitPhase(page, 'playing');
      expect(
        await page.evaluate(() => (window as unknown as { __game: Game }).__game.tutorial),
      ).toBe(true);
      await expect(page.locator('.coach')).toBeVisible();
      await expect(page.locator('.coach-count')).toHaveText(/^Step \d of 6$/);
      // No timer, no best.
      await expect(page.locator('.hud-sub')).toBeHidden();
      // A deadline under the test timeout, so a hang says where it is stuck.
      await waitTutorialDone(page, `batting synthetic ${hand}`, 50_000);
      expect(await stepsSeen(page)).toEqual([0, 1, 2, 3, 4, 5]);
      const hook = await page.evaluate(() => {
        const g = (window as unknown as { __game: Game }).__game;
        return { result: g.result, isBest: g.isBest };
      });
      expect(hook.result).toBeNull();
      expect(hook.isBest).toBeNull();
      await expect(page.locator('.screen-tutorialdone')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/batting-tutorial-done-${hand}.png` });

      // Back to menu: the sport still has no score.
      await page.getByRole('button', { name: 'Back to menu' }).click();
      await waitPhase(page, 'menu');
      await expect(page.locator('.sport-card[data-sport="batting"] .sport-best')).toHaveText(
        'No score yet',
      );
      expect(problems).toEqual([]);
    });
  }

  test('the timing step throws slowed pitches and the last step normal ones', async ({ page }) => {
    test.setTimeout(60_000); // about 21 s alone at timeScale 3 (35 s on a busy machine)
    const problems = watch(page);
    await page.goto(TUTORIAL);
    await waitPhase(page, 'playing');
    const seen = new Map<number, number>();
    await waitTutorialDone(page, 'batting timing step', 50_000, async () => {
      const now = await page.evaluate(() => {
        const g = (window as unknown as { __game: Game & { sport: BattingProbe | null } }).__game;
        return {
          step: g.sport?.tutorialStep ?? -1,
          flight: g.sport?.stage === 'flight' ? g.sport.pitchFlightMs : 0,
        };
      });
      // The last flight seen in a step is the one that counted for it.
      if (now.flight > 0) seen.set(now.step, now.flight);
    });
    await waitPhase(page, 'tutorial-done', 5000);
    expect(seen.get(4)).toBe(1800);
    expect(seen.get(5)).toBe(800);
    expect(problems).toEqual([]);
  });

  test('Play now after the tutorial starts a normal round; S skips steps', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=batting&source=synthetic&skipGate=1&tutorial=1&timeScale=1');
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
      const g = (window as unknown as { __game: Game & { sport: BattingProbe | null } }).__game;
      return { tutorial: g.tutorial, step: g.sport?.tutorialStep ?? -2 };
    });
    expect(normal.tutorial).toBe(false);
    expect(normal.step).toBe(-1);
    await expect(page.locator('.coach')).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('tutorial: the normal hint line stays hidden, camera and mouse', async ({ page }) => {
    const problems: string[] = [];

    page.on('pageerror', (err) => problems.push(err.message));

    for (const url of [
      '/?sport=batting&source=synthetic&skipGate=1&tutorial=1&timeScale=1',

      '/?sport=batting&input=debug&skipGate=1&tutorial=1',
    ]) {
      await page.goto(url);

      await waitPhase(page, 'playing');

      await expect(page.locator('.coach')).toBeVisible();

      // The coach panel is the one instruction line; the sport's own hint steps aside.

      await expectNoHintFor(page, 3000);
    }

    expect(problems).toEqual([]);
  });

  test('mouse tutorial: Skip step and End tutorial buttons work', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=batting&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach-text')).toHaveText('Watch a pitch come in');
    await expect(page.locator('.coach-count')).toHaveText('Step 1 of 3');
    await page.getByRole('button', { name: 'Skip step' }).click();
    await expect(page.locator('.coach-count')).toHaveText('Step 2 of 3');
    await page.getByRole('button', { name: 'End tutorial' }).click();
    await waitPhase(page, 'tutorial-done', 5000);
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: a player finishes it with real clicks', async ({ page }) => {
    test.setTimeout(90_000); // watch a pitch, then timed clicks on slow and full speed pitches, about 36 s alone
    const problems = watch(page);
    await recordSteps(page);
    // A small viewport keeps the software renderer fast, so a frame is short next to the timing window.
    await page.setViewportSize({ width: 480, height: 270 });
    await page.goto('/?sport=batting&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    // The coach panel is interface, so a press on it is not a swing: rest the pointer on bare scene.
    const at = await page.evaluate(() => {
      for (let y = 10; y < window.innerHeight; y += 10) {
        for (let x = 10; x < window.innerWidth; x += 10) {
          const el = document.elementFromPoint(x, y);
          if (el !== null && el.closest('button, a, input, select, textarea, [data-ui]') === null) {
            return { x, y };
          }
        }
      }
      return null;
    });
    expect(at).not.toBeNull();
    const timing: ClickTiming = { lead: 150, at: at! };
    for (let n = 0; n < 40; n++) {
      const step = await tutorialStep(page);
      const phase = await page.evaluate(() => (window as unknown as { __game: Game }).__game.phase);
      if (phase === 'tutorial-done') break;
      if (step <= 0) {
        // Step 1 only watches: no click.
        await page.waitForTimeout(250);
        continue;
      }
      try {
        await clickAt(page, 0, timing);
      } catch {
        // No pitch to aim at yet (a step change or the tutorial ended): look again.
      }
      await page.waitForTimeout(300);
    }
    await waitPhase(page, 'tutorial-done', 20000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2]);
    expect(await result(page)).toBeNull();
    await page.screenshot({ path: `${SHOTS}/batting-tutorial-mouse-done.png` });
    expect(problems).toEqual([]);
  });
});

// ---- pass-and-play ----

interface MultiHook {
  phase: string;
  players: number;
  seat: number;
  ranking: { rank: number; name: string; score: number; headline: string }[] | null;
  result: unknown;
  isBest: boolean | null;
}

function multiHook(page: Page): Promise<MultiHook> {
  return page.evaluate(() => {
    const g = (window as unknown as { __game: MultiHook }).__game;
    return {
      phase: g.phase,
      players: g.players,
      seat: g.seat,
      ranking: g.ranking === null ? null : g.ranking.map((r) => ({ ...r })),
      result: g.result,
      isBest: g.isBest,
    };
  });
}

function sportState(page: Page): Promise<{ phase: string; seat: number; handedness: string }> {
  return page.evaluate(() => {
    const s = (
      window as unknown as {
        __game: { sport: { phase: string; seat: number; handedness: string } };
      }
    ).__game.sport;
    return { phase: s.phase, seat: s.seat, handedness: s.handedness };
  });
}

/** Wait for a handover card in the page: its title text. The error says where the game is. */
async function waitHandover(page: Page, title: string, timeout = 30000): Promise<void> {
  try {
    await expect(page.locator('.handover h1')).toHaveText(title, { timeout });
  } catch (err) {
    const now = await multiHook(page).catch(() => null);
    const sport = await sportState(page).catch(() => null);
    throw new Error(
      `Never saw the handover card "${title}"; game ${JSON.stringify(now)}, sport ${JSON.stringify(sport)}.`,
      { cause: err },
    );
  }
}

test.describe('batting pass-and-play', () => {
  test('three synthetic players bat a set each, rank in a table and nothing is saved', async ({
    page,
  }) => {
    test.setTimeout(85_000); // 33 s alone at timeScale 3, 2.5x
    const problems = watch(page);
    await page.addInitScript(() => {
      const w = window as unknown as {
        __game?: { phase: string; seat: number };
        __phases: string[];
        __seats: number[];
      };
      w.__phases = [];
      w.__seats = [];
      setInterval(() => {
        const g = w.__game;
        if (!g) return;
        if (!w.__phases.includes(g.phase)) w.__phases.push(g.phase);
        if (w.__seats[w.__seats.length - 1] !== g.seat && g.phase === 'playing')
          w.__seats.push(g.seat);
      }, 20);
    });
    await page.goto(
      '/?sport=batting&players=3&names=Mia,Sam,Zoe&source=synthetic&skipGate=1&short=1&timeScale=3',
    );
    await waitPhase(page, 'playing');
    expect(await multiHook(page)).toMatchObject({ players: 3, seat: 0 });
    await expect(page.locator('.standing')).toHaveCount(3);
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Mia');

    // A deadline under the test timeout, so a hang says where it is stuck.
    try {
      await waitPhase(page, 'results', 45_000);
    } catch (err) {
      const now = await sportState(page).catch(() => null);
      throw new Error(`Batting never reached the results; sport ${JSON.stringify(now)}.`, {
        cause: err,
      });
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/batting-multi-results.png` });
    const w = (): Promise<{ phases: string[]; seats: number[] }> =>
      page.evaluate(() => {
        const x = window as unknown as { __phases: string[]; __seats: number[] };
        return { phases: [...x.__phases], seats: [...x.__seats] };
      });
    const seen = await w();
    // One whole set each, in seat order.
    expect(seen.seats).toEqual([0, 1, 2]);
    expect(seen.phases).toContain('handover');

    const g = await multiHook(page);
    expect(g.players).toBe(3);
    expect(g.ranking).toHaveLength(3);
    expect(g.ranking?.map((r) => r.name).sort()).toEqual(['Mia', 'Sam', 'Zoe']);
    const scores = g.ranking?.map((r) => r.score) ?? [];
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(g.ranking?.[0]?.rank).toBe(1);
    for (const r of g.ranking ?? []) expect(r.headline).toMatch(/^\d+ ft$/);
    expect(g.result).toBeNull();
    expect(g.isBest).toBeNull();
    await expect(page.locator('.rank-row')).toHaveCount(3);
    await expect(page.locator('.best-badge')).toHaveCount(0);
    await expect(page.locator('.results-best')).toHaveCount(0);

    // Nothing was saved: back at the menu the sport still has no score.
    await page.keyboard.press('Escape');
    await waitPhase(page, 'menu', 10000);
    await expect(page.locator('.sport-card[data-sport="batting"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('two players with the mouse: a set each, a handover card between, a ranked table', async ({
    page,
  }) => {
    test.setTimeout(75_000); // 29 s alone in real time (6 pitches, 1 handover), 2.5x
    const problems = watch(page);
    // A small viewport keeps the software renderer fast, so a frame is short next to the timing window.
    await page.setViewportSize({ width: 480, height: 270 });
    await page.goto('/?sport=batting&players=2&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    expect(await multiHook(page)).toMatchObject({ players: 2, seat: 0 });
    const timing: ClickTiming = { lead: 150 };

    for (let n = 1; n <= 3; n++) {
      await clickAt(page, 0, timing);
      await waitResolved(page, n);
    }
    // The first set is done: the card for the next batter, with the round paused under it.
    await waitHandover(page, "Player 2, you're up", 60000);
    expect((await multiHook(page)).phase).toBe('handover');
    expect((await sportState(page)).phase).toBe('handover');
    expect((await multiHook(page)).seat).toBe(0);
    await page.screenshot({ path: `${SHOTS}/batting-handover.png` });
    await page.getByRole('button', { name: 'Ready' }).click();
    await expect(page.locator('.handover')).toHaveCount(0);
    await expect.poll(async () => (await multiHook(page)).seat, { timeout: 3000 }).toBe(1);
    expect((await multiHook(page)).phase).toBe('playing');
    // A fresh set: nothing resolved yet for the new batter.
    expect(await resolved(page)).toHaveLength(0);
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Player 2');

    for (let n = 1; n <= 3; n++) {
      await clickAt(page, 0, timing);
      await waitResolved(page, n);
    }
    await waitPhase(page, 'results', 60000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/batting-multi-mouse-results.png` });
    await expect(page.locator('.rank-row')).toHaveCount(2);
    const g = await multiHook(page);
    expect(g.result).toBeNull();
    expect(g.isBest).toBeNull();
    await expect(page.locator('.best-badge')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await waitPhase(page, 'menu', 10000);
    await expect(page.locator('.sport-card[data-sport="batting"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });
});
