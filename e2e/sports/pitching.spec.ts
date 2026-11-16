import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHintFor, tutorialStuck, waitSeatUp } from './tutorialHelpers';

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
  isBest: boolean | null;
  tutorial: boolean;
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
    tutorialStep: number;
    tutorialSteps: number;
    cellScreen(cell: number): { x: number; y: number };
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

/**
 * Record every tutorial step the sport passes through, in the page from the first frame, so a fast
 * step is not missed. Call before `page.goto`.
 */
async function recordSteps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __game?: { sport: { tutorialStep: number; tutorialSteps: number } | null };
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
    test.setTimeout(100_000); // runs at timeScale 0.25 by design, about 35 to 53 s
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

  test('mouse: pick the called pitch with a button, hold to aim, release to throw', async ({
    page,
  }) => {
    test.setTimeout(100_000); // a whole short round with real pointer timing, about 42 s alone
    const problems = watch(page);
    const sportNow = (): Promise<{
      called: string;
      kind: string;
      marker: { visible: boolean; x: number; y: number };
      bubbleVisible: boolean;
    }> =>
      page.evaluate(() => {
        const sp = (window as unknown as { __game: PitchingHook }).__game.sport!;
        return {
          called: sp.called,
          kind: sp.kind,
          marker: sp.aimMarker,
          bubbleVisible: sp.bubble.visible,
        };
      });
    const fastball = page.getByTestId('pitch-fastball');
    const curve = page.getByTestId('pitch-curve');
    const buttonFor = (kind: string): typeof fastball => (kind === 'curve' ? curve : fastball);

    await page.goto('/?sport=pitching&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    // The buttons are there from the start, with the fastball picked, but dead until the call shows.
    await expect(fastball).toBeVisible();
    await expect(curve).toBeVisible();
    await expect(fastball).toHaveAttribute('aria-pressed', 'true');
    await expect(curve).toHaveAttribute('aria-pressed', 'false');
    await expect(fastball).toBeDisabled();
    await waitSportPhase(page, 'call', 10000);
    await expect(page.getByTestId('catcher-bubble')).toBeVisible({ timeout: 10000 });
    await expect(fastball).toBeEnabled();

    const throwAt = async (x: number, y: number, shot = false): Promise<Pitch> => {
      // The call comes up, and the pitch is picked with the matching button.
      await page.waitForFunction(
        () => (window as unknown as { __game: PitchingHook }).__game.sport?.bubble.visible === true,
        undefined,
        { timeout: 30000 },
      );
      await expect(fastball).toBeEnabled();
      const now = await sportNow();
      const count0 = (await pitches(page)).length;
      expect(now.kind).toBe('fastball');
      await buttonFor(now.called).click();
      await expect(buttonFor(now.called)).toHaveAttribute('aria-pressed', 'true');
      expect((await sportNow()).kind).toBe(now.called);
      if (shot) await page.screenshot({ path: `${SHOTS}/pitching-mouse-buttons.png` });
      // Clicking a button never throws or shows the ring.
      expect((await sportNow()).marker.visible).toBe(false);
      await waitSportPhase(page, 'windup', 15000);
      expect((await pitches(page)).length).toBe(count0);

      // Press and hold on the field: the ring follows the pointer; let go to throw.
      await page.mouse.move(640, 400);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 6 });
      await page.waitForTimeout(150);
      const aim = (await sportNow()).marker;
      expect(aim.visible).toBe(true);
      if (shot) await page.screenshot({ path: `${SHOTS}/pitching-mouse-aim.png` });
      const before = (await pitches(page)).length;
      await page.mouse.up();
      await page.waitForFunction(
        (n) =>
          ((window as unknown as { __game: PitchingHook }).__game.sport?.pitches.length ?? 0) > n,
        before,
        { timeout: 20000 },
      );
      const all = await pitches(page);
      const last = all[all.length - 1]!;
      expect(last.balk).toBe(false);
      expect(Math.abs(last.x - aim.x)).toBeLessThan(0.02);
      expect(Math.abs(last.y - aim.y)).toBeLessThan(0.02);
      expect(last.kind).toBe(now.called);
      expect(last.called).toBe(now.called);
      expect(last.matched).toBe(true);
      return last;
    };

    const left = await throwAt(300, 330, true);
    const right = await throwAt(980, 330);
    console.info(`left ${JSON.stringify(left)} right ${JSON.stringify(right)}`);
    expect(left.x).toBeLessThan(right.x);

    // The third pitch ends the short round. Throw the other pitch on purpose: it is legal but
    // is not what was called.
    await page.waitForFunction(
      () => (window as unknown as { __game: PitchingHook }).__game.sport?.bubble.visible === true,
      undefined,
      { timeout: 30000 },
    );
    const last = await sportNow();
    const other = last.called === 'curve' ? 'fastball' : 'curve';
    await buttonFor(other).click();
    await waitSportPhase(page, 'windup', 15000);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await waitPhase(page, 'results', 30000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: PitchingHook }).__game.result,
    );
    expect(result!.detail?.pitches).toBe(3);
    const thrown = await pitches(page);
    expect(thrown[2]!.kind).toBe(other);
    expect(thrown[2]!.matched).toBe(false);
    expect(problems).toEqual([]);
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
  const multiHook = (page: Page): Promise<MultiHook> =>
    page.evaluate(() => {
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

  async function waitHandover(page: Page, title: string, timeout = 30000): Promise<void> {
    try {
      await expect(page.locator('.handover h1')).toHaveText(title, { timeout });
    } catch (err) {
      const now = await multiHook(page).catch(() => null);
      throw new Error(`Never saw the handover card "${title}"; game ${JSON.stringify(now)}.`, {
        cause: err,
      });
    }
  }

  test('three synthetic players throw the same calls, rank in a table and nothing is saved', async ({
    page,
  }) => {
    test.setTimeout(95_000); // 38 s alone at three times speed, 2.5x
    const problems = watch(page);
    // Record each seat's set of calls in the page, from the first frame.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __game?: { sport: { seat: number; pitches: { called: string; target: number }[] } | null };
        __sets: Record<number, string[]>;
      };
      w.__sets = {};
      setInterval(() => {
        const sp = w.__game?.sport;
        if (!sp) return;
        const now = sp.pitches.map((p) => p.called + '@' + p.target);
        const have = w.__sets[sp.seat] ?? [];
        if (now.length > have.length) w.__sets[sp.seat] = now;
      }, 20);
    });
    await page.goto(
      '/?sport=pitching&players=3&names=Mia,Sam,Zoe&source=synthetic&skipGate=1&short=1&timeScale=3',
    );
    await waitPhase(page, 'playing');
    expect(await multiHook(page)).toMatchObject({ players: 3, seat: 0 });
    await expect(page.locator('.standing')).toHaveCount(3);
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Mia');

    for (const seat of [1, 2]) {
      await waitSeatUp(page, 'pitching, three synthetic players', seat, 40_000);
    }
    await waitPhase(page, 'results', 40_000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/pitching-multi-results.png` });
    const sets = await page.evaluate(
      () => (window as unknown as { __sets: Record<number, string[]> }).__sets,
    );
    expect(Object.keys(sets)).toEqual(['0', '1', '2']);
    expect(sets[0]).toHaveLength(3);
    // Call n is the same for every player.
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);

    const g = await multiHook(page);
    expect(g.ranking).toHaveLength(3);
    expect(g.ranking?.map((r) => r.name).sort()).toEqual(['Mia', 'Sam', 'Zoe']);
    const scores = g.ranking?.map((r) => r.score) ?? [];
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(g.ranking?.[0]?.rank).toBe(1);
    expect(g.ranking?.[0]?.headline).toMatch(/ pts$/);
    expect(g.result).toBeNull();
    expect(g.isBest).toBeNull();
    await expect(page.locator('.rank-row')).toHaveCount(3);
    await expect(page.locator('.best-badge')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await waitPhase(page, 'menu', 10000);
    await expect(page.locator('.sport-card[data-sport="pitching"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('two players with the mouse: a set each through a handover card, then a ranked table', async ({
    page,
  }) => {
    test.setTimeout(140_000); // 56 s alone, real time (6 pitches), 2.5x
    const problems = watch(page);
    await page.goto('/?sport=pitching&players=2&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    expect(await multiHook(page)).toMatchObject({ players: 2, seat: 0 });
    const fastball = page.getByTestId('pitch-fastball');
    const curve = page.getByTestId('pitch-curve');
    const sportNow = (): Promise<{ called: string; seat: number; count: number }> =>
      page.evaluate(() => {
        const sp = (window as unknown as { __game: PitchingHook }).__game.sport as unknown as {
          called: string;
          seat: number;
          pitches: unknown[];
        };
        return { called: sp.called, seat: sp.seat, count: sp.pitches.length };
      });

    const throwOne = async (): Promise<void> => {
      await page.waitForFunction(
        () => (window as unknown as { __game: PitchingHook }).__game.sport?.bubble.visible === true,
        undefined,
        { timeout: 30000 },
      );
      const now = await sportNow();
      await (now.called === 'curve' ? curve : fastball).click();
      await waitSportPhase(page, 'windup', 15000);
      await page.mouse.move(640, 400);
      await page.mouse.down();
      await page.mouse.move(640, 330, { steps: 4 });
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForFunction(
        (n) =>
          ((window as unknown as { __game: PitchingHook }).__game.sport?.pitches.length ?? 0) > n,
        now.count,
        { timeout: 20000 },
      );
    };

    for (let i = 0; i < 3; i++) await throwOne();
    await waitHandover(page, "Player 2, you're up");
    await page.screenshot({ path: `${SHOTS}/pitching-handover.png` });
    expect((await multiHook(page)).phase).toBe('handover');
    await waitSportPhase(page, 'handover', 5000);
    // The round is paused under the card: still the first seat until the next player is ready.
    expect((await multiHook(page)).seat).toBe(0);
    await page.getByRole('button', { name: 'Ready' }).click();
    await expect(page.locator('.handover')).toHaveCount(0);
    await expect.poll(async () => (await sportNow()).seat, { timeout: 5000 }).toBe(1);
    // A fresh set: no pitches yet, and the fastball picked again.
    expect((await sportNow()).count).toBe(0);
    await expect(fastball).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Player 2');
    for (let i = 0; i < 3; i++) await throwOne();

    await waitPhase(page, 'results', 40000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/pitching-multi-mouse-results.png` });
    await expect(page.locator('.rank-row')).toHaveCount(2);
    const g = await multiHook(page);
    expect(g.result).toBeNull();
    await expect(page.locator('.best-badge')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await waitPhase(page, 'menu', 10000);
    await expect(page.locator('.sport-card[data-sport="pitching"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  // ---- tutorial ----

  const TUTORIAL = '/?sport=pitching&source=synthetic&skipGate=1&tutorial=1&timeScale=3';

  const stepIs = async (page: Page, n: number, timeout: number): Promise<void> => {
    try {
      await page.waitForFunction(
        (want) =>
          (window as unknown as { __game: PitchingHook }).__game.sport?.tutorialStep === want,
        n,
        { timeout },
      );
    } catch (err) {
      const stuck = await tutorialStuck(page, `pitching, waiting for step ${n}`, timeout);
      throw new Error(stuck.message, { cause: err });
    }
  };

  test('tutorial: the normal hint line stays hidden, camera and mouse', async ({ page }) => {
    const problems: string[] = [];

    page.on('pageerror', (err) => problems.push(err.message));

    for (const url of [
      '/?sport=pitching&source=synthetic&skipGate=1&tutorial=1&timeScale=1',

      '/?sport=pitching&input=debug&skipGate=1&tutorial=1',
    ]) {
      await page.goto(url);

      await waitPhase(page, 'playing');

      await expect(page.locator('.coach')).toBeVisible();

      // The coach panel is the one instruction line; the sport's own hint steps aside.

      await expectNoHintFor(page, 3000);
    }

    expect(problems).toEqual([]);
  });

  test('the synthetic pitcher completes the tutorial and nothing is saved', async ({ page }) => {
    test.setTimeout(150_000); // seven steps at timeScale 3, about 60 s alone
    const problems = watch(page);
    await recordSteps(page);
    await page.goto(TUTORIAL);
    await waitPhase(page, 'playing');
    expect(
      await page.evaluate(() => (window as unknown as { __game: PitchingHook }).__game.tutorial),
    ).toBe(true);
    await expect(page.locator('.coach')).toBeVisible();
    await expect(page.locator('.coach-count')).toHaveText(/^Step \d of 7$/);
    // No pitch count and no score line: the coach panel is the instruction line.
    await expect(page.locator('.hud-sub')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/pitching-tutorial-start.png` });

    await stepIs(page, 2, 60000);
    await expect(page.locator('.coach-text')).toHaveText('Hold the ring on the glowing square');
    expect(
      await page.evaluate(
        () => (window as unknown as { __game: PitchingHook }).__game.sport!.aimMarker.visible,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${SHOTS}/pitching-tutorial-ring.png` });
    await stepIs(page, 5, 60000);
    await expect(page.locator('.coach-text')).toHaveText(
      'Hold it open for a curveball, then throw',
    );
    await expect(page.locator('.coach-detail')).toContainText('breaks down and away');
    await page.screenshot({ path: `${SHOTS}/pitching-tutorial-curve.png` });

    await waitPhase(page, 'tutorial-done', 120000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await page.screenshot({ path: `${SHOTS}/pitching-tutorial-done.png` });

    const hook = await page.evaluate(() => {
      const g = (window as unknown as { __game: PitchingHook }).__game;
      return { result: g.result, isBest: g.isBest };
    });
    expect(hook.result).toBeNull();
    expect(hook.isBest).toBeNull();
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    await expect(page.locator('.best-badge')).toHaveCount(0);

    // Back to menu: the sport still has no score.
    await page.getByRole('button', { name: 'Back to menu' }).click();
    await waitPhase(page, 'menu');
    await expect(page.locator('.sport-card[data-sport="pitching"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('Play now after the tutorial starts a normal round; S skips steps', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=pitching&source=synthetic&skipGate=1&tutorial=1&timeScale=1');
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
      const g = (window as unknown as { __game: PitchingHook }).__game;
      return { tutorial: g.tutorial, step: g.sport?.tutorialStep ?? -2 };
    });
    expect(normal.tutorial).toBe(false);
    expect(normal.step).toBe(-1);
    await expect(page.locator('.coach')).toBeHidden();
    await expect(page.locator('.hud-sub')).toContainText('Pitch 1 of');
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: Skip step and End tutorial buttons work', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=pitching&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach-text')).toHaveText(
      'Pick Fastball or Curveball with a button',
    );
    await expect(page.locator('.coach-feedback')).toBeVisible({ timeout: 8000 });
    expect(await page.locator('.coach-feedback').textContent()).toBe(
      'Click a pitch button at the bottom left',
    );
    await page.getByRole('button', { name: 'Skip step' }).click();
    await expect(page.locator('.coach-count')).toHaveText('Step 2 of 4');
    await page.getByRole('button', { name: 'End tutorial' }).click();
    await waitPhase(page, 'tutorial-done', 5000);
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: a player can finish it with the buttons, press and release', async ({
    page,
  }) => {
    test.setTimeout(100_000); // every step with real pointer timing, about 41 s alone
    const problems = watch(page);
    await recordSteps(page);
    await page.goto('/?sport=pitching&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    const vp = page.viewportSize()!;
    // A fresh call is up: the bubble shows in the call or wind-up phase (not the last result).
    const callUp = (): Promise<unknown> =>
      page.waitForFunction(
        () => {
          const s = (window as unknown as { __game: PitchingHook }).__game.sport;
          return s?.bubble.visible === true && (s.phase === 'call' || s.phase === 'windup');
        },
        undefined,
        { timeout: 20000 },
      );
    const targetPoint = (): Promise<{ x: number; y: number; called: string }> =>
      page.evaluate(() => {
        const s = (window as unknown as { __game: PitchingHook }).__game.sport!;
        const p = s.cellScreen(s.target);
        return { x: p.x, y: p.y, called: s.called };
      });

    // 1. Pick a pitch with a button.
    await stepIs(page, 0, 20000);
    await callUp();
    await page.getByTestId('pitch-fastball').click();
    // 2. Hold on the field at the glowing square.
    await stepIs(page, 1, 20000);
    await waitSportPhase(page, 'windup', 15000);
    const aimAt = await targetPoint();
    await page.mouse.move(aimAt.x * vp.width, aimAt.y * vp.height);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/pitching-tutorial-mouse-aim.png` });
    // 3. Let go to throw (the hold finishes while the button is still down).
    await stepIs(page, 2, 20000);
    await page.mouse.up();
    // 4. The called pitch: pick it, aim, throw.
    await stepIs(page, 3, 20000);
    await callUp();
    const now = await targetPoint();
    await page.getByTestId(now.called === 'curve' ? 'pitch-curve' : 'pitch-fastball').click();
    await waitSportPhase(page, 'windup', 15000);
    const spot = await targetPoint();
    await page.mouse.move(spot.x * vp.width, spot.y * vp.height);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await waitPhase(page, 'tutorial-done', 20000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3]);
    const result = await page.evaluate(
      () => (window as unknown as { __game: PitchingHook }).__game.result,
    );
    expect(result).toBeNull();
    await page.screenshot({ path: `${SHOTS}/pitching-tutorial-mouse-done.png` });
    expect(problems).toEqual([]);
  });
});
