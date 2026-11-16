import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameHook } from '../../src/core/shell/hook';
import { expectNoHintFor, waitTutorialDone } from './tutorialHelpers';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Game = Pick<GameHook, 'phase' | 'sportId' | 'inputKind' | 'error'> & {
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
  tutorial: boolean;
  isBest: boolean | null;
};

/** What the archery sport exposes on `__game.sport`. */
interface ArcheryState {
  phase: string;
  phaseLog: string[];
  draw: number;
  arrowsShot: number;
  arrowsTotal: number;
  score: number;
  cameraBlend: number;
  rings: number[];
  tutorialStep: number;
  tutorialSteps: number;
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

function game(page: Page): Promise<Game> {
  return page.evaluate(() => {
    const g = (window as unknown as { __game: Game }).__game;
    return {
      phase: g.phase,
      sportId: g.sportId,
      inputKind: g.inputKind,
      error: g.error,
      result: g.result,
      tutorial: g.tutorial,
      isBest: g.isBest,
    };
  });
}

function sportState(page: Page): Promise<ArcheryState> {
  return page.evaluate(() => {
    const s = (window as unknown as { __game: { sport: ArcheryState } }).__game.sport;
    return {
      phase: s.phase,
      phaseLog: [...s.phaseLog],
      draw: s.draw,
      arrowsShot: s.arrowsShot,
      arrowsTotal: s.arrowsTotal,
      score: s.score,
      cameraBlend: s.cameraBlend,
      rings: [...s.rings],
      tutorialStep: s.tutorialStep,
      tutorialSteps: s.tutorialSteps,
    };
  });
}

/** A condition on the live sport; every field given must hold. */
interface Cond {
  phase?: string;
  minDraw?: number;
  minBlend?: number;
  arrowsShot?: number;
}

/** Wait for a condition on the live sport, polled every animation frame. */
async function waitSport(page: Page, what: string, cond: Cond, timeout = 60000): Promise<void> {
  try {
    await page.waitForFunction(
      (c) => {
        const s = (window as unknown as { __game?: { sport: ArcheryState | null } }).__game?.sport;
        if (!s) return false;
        if (c.phase !== undefined && s.phase !== c.phase) return false;
        if (c.minDraw !== undefined && !(s.draw > c.minDraw)) return false;
        if (c.minBlend !== undefined && !(s.cameraBlend > c.minBlend)) return false;
        if (c.arrowsShot !== undefined && s.arrowsShot !== c.arrowsShot) return false;
        return true;
      },
      cond,
      { timeout, polling: 'raf' },
    );
  } catch (err) {
    const now = await sportState(page).catch(() => null);
    throw new Error(`Never saw ${what}; sport is ${JSON.stringify(now)}.`, { cause: err });
  }
}

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

/** Wait for a handover card in the page: its title text, the phase and the sport's own phase. */
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

/** Seats seen at a handover and phases seen, recorded in the page from the first frame. */
async function recordPhases(page: Page): Promise<void> {
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
}

const phasesSeen = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __phases: string[] }).__phases]);
const seatsSeen = (page: Page): Promise<number[]> =>
  page.evaluate(() => [...(window as unknown as { __seats: number[] }).__seats]);

/** The hook follows the sport by a frame: poll for the seat instead of reading it once. */
async function expectSeat(page: Page, seat: number): Promise<void> {
  await expect.poll(async () => (await multiHook(page)).seat, { timeout: 3000 }).toBe(seat);
}

/** Where the mouse aims at about the middle of the target (see the mouse test above). */
function aimPoint(page: Page): { x: number; y: number } {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  return { x: vp.width * 0.376, y: vp.height * 0.307 };
}

/** One mouse arrow: aim, hold to a full draw, let go, and wait for it to land. */
async function shootWithMouse(page: Page, landed: number): Promise<void> {
  const aim = aimPoint(page);
  await page.mouse.move(aim.x, aim.y, { steps: 4 });
  await page.mouse.down();
  await waitSport(page, 'a full draw', { phase: 'drawing', minDraw: 0.97 }, 6000);
  await page.mouse.up();
  await waitSport(page, 'the arrow to land', { arrowsShot: landed }, 12000);
}

test.describe('archery', () => {
  test('screenshots at full draw and of the hit, in slow motion', async ({ page }) => {
    const problems = watch(page);
    // A screenshot takes a good fraction of a second; at a quarter speed the moment holds still.
    await page.goto('/?sport=archery&source=synthetic&skipGate=1&short=1&timeScale=0.25');
    await waitPhase(page, 'playing');

    await waitSport(page, 'full draw', { phase: 'drawing', minDraw: 0.97 }, 120000);
    await page.screenshot({ path: `${SHOTS}/archery-draw.png` });
    expect((await sportState(page)).phase).toBe('drawing');

    await waitSport(page, 'the hit view', { phase: 'showing', minBlend: 0.93 }, 120000);
    await page.screenshot({ path: `${SHOTS}/archery-hit.png` });
    expect((await sportState(page)).arrowsShot).toBe(1);
    expect(problems).toEqual([]);
  });

  test('the synthetic archer plays a short round to the results', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=archery&source=synthetic&skipGate=1&short=1&timeScale=2');
    await waitPhase(page, 'playing');

    await waitPhase(page, 'results', 150000);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/archery-results.png` });

    const g = await game(page);
    expect(g.inputKind).toBe('synthetic');
    expect(g.result?.detail?.arrows).toBe(2);
    expect(g.result?.score ?? 0).toBeGreaterThanOrEqual(6);
    const s = await sportState(page);
    console.info(`archery bot rings: ${s.rings.join(', ')} (score ${g.result?.score})`);
    expect(s.rings).toHaveLength(2);
    // The bot's draw hand drops out for 300 ms at the first full draw: the arrow stays nocked
    // (no put-back to ready) and flies only once it is released.
    expect(s.phaseLog.slice(0, 3)).toEqual(['ready', 'drawing', 'flying']);
    expect(problems).toEqual([]);
  });

  test('a round can be played with only the mouse', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=archery&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');

    // The bow hand follows the pointer; this spot aims at about the middle of the target.
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const aimX = vp.width * 0.376;
    const aimY = vp.height * 0.307;
    await page.mouse.move(aimX, aimY);
    await page.waitForTimeout(300);
    await waitSport(page, 'ready to draw', { phase: 'ready' }, 5000);

    // A quick tap does not leave the archer stuck: the arrow is put back.
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await sportState(page)).toMatchObject({ phase: 'ready', arrowsShot: 0 });

    for (let n = 1; n <= 2; n++) {
      await page.mouse.move(aimX, aimY);
      await page.mouse.down(); // nocks and starts drawing at once
      await waitSport(page, 'a nocked arrow', { phase: 'drawing' }, 3000);
      await waitSport(page, 'a full draw', { minDraw: 0.97 }, 5000);
      if (n === 1) await page.screenshot({ path: `${SHOTS}/archery-debug-draw.png` });
      await page.mouse.up(); // let go: shoot
      await waitSport(page, 'a shot arrow', { arrowsShot: n }, 10000);
      if (n === 1) await waitSport(page, 'the next arrow ready', { phase: 'ready' }, 15000);
    }

    await waitPhase(page, 'results', 30000);
    const s = await sportState(page);
    // The tap nocked and put the arrow back; the first real draw then flew.
    expect(s.phaseLog.slice(0, 5)).toEqual(['ready', 'drawing', 'ready', 'drawing', 'flying']);
    expect(s.rings).toHaveLength(2);
    expect((await game(page)).error).toBeNull();
    expect(problems).toEqual([]);
  });

  // ---- tutorial ----

  /**
   * Record every tutorial step the sport passes through, in the page from the first frame, so a
   * fast step is not missed. Call before `page.goto`.
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

  const waitStep = async (page: Page, atLeast: number, timeout = 20000): Promise<void> => {
    try {
      await page.waitForFunction(
        (n) =>
          ((window as unknown as { __game?: { sport: ArcheryState | null } }).__game?.sport
            ?.tutorialStep ?? -1) >= n,
        atLeast,
        { timeout, polling: 'raf' },
      );
    } catch (err) {
      const now = await sportState(page).catch(() => null);
      throw new Error(`Never reached tutorial step ${atLeast}; sport is ${JSON.stringify(now)}.`, {
        cause: err,
      });
    }
  };

  test('tutorial: the normal hint line stays hidden, camera and mouse', async ({ page }) => {
    const problems: string[] = [];

    page.on('pageerror', (err) => problems.push(err.message));

    for (const url of [
      '/?sport=archery&source=synthetic&skipGate=1&tutorial=1&timeScale=1',

      '/?sport=archery&input=debug&skipGate=1&tutorial=1',
    ]) {
      await page.goto(url);

      await waitPhase(page, 'playing');

      await expect(page.locator('.coach')).toBeVisible();

      // The coach panel is the one instruction line; the sport's own hint steps aside.

      await expectNoHintFor(page, 3000);
    }

    expect(problems).toEqual([]);
  });

  test('the synthetic archer completes the tutorial and nothing is saved', async ({ page }) => {
    test.setTimeout(125_000); // 50 s measured on a busy machine, at three times speed
    const problems = watch(page);
    await recordSteps(page);
    await page.goto('/?sport=archery&source=synthetic&skipGate=1&tutorial=1&timeScale=3');
    await waitPhase(page, 'playing');
    expect((await game(page)).tutorial).toBe(true);
    await expect(page.locator('.coach')).toBeVisible();
    await expect(page.locator('.coach-count')).toHaveText(/^Step \d of 7$/);
    // No arrows-left count, no wind, no best.
    await expect(page.locator('.hud-sub')).toBeHidden();

    let shot = false;
    // A deadline well under the test timeout, so a hang says where it is stuck.
    await waitTutorialDone(page, 'archery synthetic', 100_000, async () => {
      const s = await sportState(page).catch(() => null);
      if (s !== null && s.tutorialStep === 3 && s.phase === 'drawing' && !shot) {
        shot = true;
        await page.screenshot({ path: `${SHOTS}/archery-tutorial-play.png` });
      }
    });
    await waitPhase(page, 'tutorial-done', 5000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await page.screenshot({ path: `${SHOTS}/archery-tutorial-done.png` });

    const g = await game(page);
    expect(g.result).toBeNull();
    expect(g.isBest).toBeNull();
    await expect(page.locator('.screen-tutorialdone')).toBeVisible();
    await expect(page.locator('.best-badge')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to menu' }).click();
    await waitPhase(page, 'menu');
    await expect(page.locator('.sport-card[data-sport="archery"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('Play now after the tutorial starts a normal round', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=archery&source=synthetic&skipGate=1&tutorial=1&timeScale=1');
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
    expect((await game(page)).tutorial).toBe(false);
    expect((await sportState(page)).tutorialStep).toBe(-1);
    await expect(page.locator('.coach')).toBeHidden();
    await expect(page.locator('.hud-sub')).toContainText('arrows left');
    expect(problems).toEqual([]);
  });

  test('mouse tutorial: a player can finish it with real mouse events', async ({ page }) => {
    test.setTimeout(105_000); // 42 s measured on a busy machine: aim, draw and two arrows in real time
    const problems = watch(page);
    await recordSteps(page);
    await page.goto('/?sport=archery&input=debug&skipGate=1&tutorial=1');
    await waitPhase(page, 'playing');
    await expect(page.locator('.coach-count')).toHaveText('Step 1 of 4');
    await expect(page.locator('.coach-text')).toHaveText('Move the mouse onto the target');

    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const aimX = vp.width * 0.376;
    // About the middle of the target (0.32 aims level; 0.307 lands a little high).
    const aimY = vp.height * 0.32;
    // Parked in a corner, the panel says why nothing counted.
    await page.mouse.move(2, 2);
    await expect(page.locator('.coach-feedback')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.coach-feedback')).toHaveText('Move the pointer over the target');

    // 1. Aim at the target and hold it there.
    await page.mouse.move(aimX, aimY, { steps: 6 });
    await waitStep(page, 1);
    // 2. Hold the button until the draw is full.
    await page.mouse.down();
    await waitSport(page, 'a full draw', { phase: 'drawing', minDraw: 0.97 }, 5000);
    await waitStep(page, 2);
    await page.screenshot({ path: `${SHOTS}/archery-tutorial-mouse-draw.png` });
    // 3. Let go to shoot.
    await page.mouse.up();
    await waitStep(page, 3);
    // 4. Two more arrows.
    for (let n = 2; n <= 3; n++) {
      await waitSport(page, 'the next arrow ready', { phase: 'ready' }, 20000);
      await page.mouse.move(aimX, aimY);
      await page.mouse.down();
      await waitSport(page, 'a full draw', { phase: 'drawing', minDraw: 0.97 }, 5000);
      await page.mouse.up();
      if (n === 2) await waitSport(page, 'the second arrow landed', { arrowsShot: 2 }, 15000);
    }
    await waitPhase(page, 'tutorial-done', 20000);
    expect(await stepsSeen(page)).toEqual([0, 1, 2, 3]);
    expect((await game(page)).result).toBeNull();
    await page.screenshot({ path: `${SHOTS}/archery-tutorial-mouse-done.png` });
    expect(problems).toEqual([]);
  });

  // ---- pass-and-play ----

  test('three synthetic players take turns, rank in a table and nothing is saved', async ({
    page,
  }) => {
    test.setTimeout(90_000); // 22 to 37 s measured at three times speed, 2.5x
    const problems = watch(page);
    await recordPhases(page);
    await page.goto(
      '/?sport=archery&players=3&names=Mia,Sam,Zoe&source=synthetic&skipGate=1&short=1&timeScale=3',
    );
    await waitPhase(page, 'playing');
    expect(await multiHook(page)).toMatchObject({ players: 3, seat: 0 });
    // The strip of name chips, the first player marked.
    await expect(page.locator('.standing')).toHaveCount(3);
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Mia');
    expect((await sportState(page)).arrowsTotal).toBe(2);

    await waitPhase(page, 'results', 130_000);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/archery-multi-results.png` });
    const seats = await seatsSeen(page);
    // Seats in order, one arrow each: 0, 1, 2, 0, 1, 2.
    expect(seats).toEqual([0, 1, 2, 0, 1, 2]);
    expect(await phasesSeen(page)).toContain('handover');

    const g = await multiHook(page);
    expect(g.players).toBe(3);
    expect(g.ranking).toHaveLength(3);
    expect(g.ranking?.map((r) => r.name).sort()).toEqual(['Mia', 'Sam', 'Zoe']);
    // Ranked best first; ties share a rank.
    const scores = g.ranking?.map((r) => r.score) ?? [];
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(g.ranking?.[0]?.rank).toBe(1);
    expect(g.result).toBeNull();
    expect(g.isBest).toBeNull();
    await expect(page.locator('.rank-row')).toHaveCount(3);
    await expect(page.locator('.best-badge')).toHaveCount(0);
    await expect(page.locator('.results-best')).toHaveCount(0);
    await expect(page.locator('.results-headline')).toHaveText(/ wins$|^It's a tie$/);

    // Play again: the same players, no names screen.
    await page.getByRole('button', { name: 'Play again' }).click();
    await waitPhase(page, 'playing', 20000);
    expect(await multiHook(page)).toMatchObject({ players: 3, seat: 0 });
    await expect(page.locator('.name-input')).toHaveCount(0);
    await expect(page.locator('.standing-name')).toHaveText(['Mia', 'Sam', 'Zoe']);
    // Quitting a multiplayer game goes to the menu and saves nothing.
    await page.keyboard.press('Escape');
    await waitPhase(page, 'menu', 10000);
    await expect(page.locator('.sport-card[data-sport="archery"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('two players with the mouse: names, handovers by Ready, a ranked table, change players', async ({
    page,
  }) => {
    test.setTimeout(150_000); // 40 to 60 s measured in real time (4 arrows, 3 handovers), 2.5x
    const problems = watch(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/?input=debug&skipGate=1&short=1');
    await waitPhase(page, 'title');
    await page.getByRole('button', { name: 'Start' }).click();
    await waitPhase(page, 'menu');
    await page.locator('.sport-card[data-sport="archery"]').click();
    await waitPhase(page, 'howto');

    // The Players control is there, at one player; two goes to the names screen.
    await expect(page.locator('.players-opt')).toHaveCount(4);
    await expect(page.locator('.players-opt').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.players-opt[data-players="2"]').click();
    await page.getByRole('button', { name: 'Start' }).click();
    await waitPhase(page, 'names');
    const inputs = page.locator('.name-input');
    await expect(inputs).toHaveCount(2);
    await expect(inputs.nth(0)).toHaveValue('Player 1');
    await page.keyboard.type('Mia');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sam');
    await page.keyboard.press('Enter');
    await waitPhase(page, 'playing');
    expect(await multiHook(page)).toMatchObject({ players: 2, seat: 0 });
    await expect(page.locator('.standing')).toHaveCount(2);
    await expect(page.locator('.standing-name')).toHaveText(['Mia', 'Sam']);
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Mia');

    // Mia's arrow, then the card for Sam.
    await waitSport(page, 'ready to draw', { phase: 'ready' }, 8000);
    await shootWithMouse(page, 1);
    await waitHandover(page, "Sam, you're up");
    await page.screenshot({ path: `${SHOTS}/archery-handover.png` });
    expect((await multiHook(page)).phase).toBe('handover');
    expect((await sportState(page)).phase).toBe('handover');
    // The round is paused under the card: still Mia's seat until Sam is ready.
    expect((await multiHook(page)).seat).toBe(0);
    await page.getByRole('button', { name: 'Ready' }).click();
    await expect(page.locator('.handover')).toHaveCount(0);
    await expect(page.locator('.hud-banner')).toHaveText('Go');
    await waitSport(page, 'Sam ready', { phase: 'ready' }, 8000);
    await expectSeat(page, 1);
    expect((await multiHook(page)).phase).toBe('playing');
    expect((await sportState(page)).arrowsShot).toBe(0);
    await expect(page.locator('.standing.current .standing-name')).toHaveText('Sam');

    await shootWithMouse(page, 1);
    await waitHandover(page, "Mia, you're up");
    await page.keyboard.press('Enter'); // Enter is Ready too
    await waitSport(page, 'Mia ready', { phase: 'ready' }, 8000);
    await expectSeat(page, 0);
    await shootWithMouse(page, 2);
    await waitHandover(page, "Sam, you're up");
    await page.getByRole('button', { name: 'Ready' }).click();
    await waitSport(page, 'Sam ready again', { phase: 'ready' }, 8000);
    await shootWithMouse(page, 2);

    await waitPhase(page, 'results', 30000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/archery-multi-mouse-results.png` });
    await expect(page.locator('.rank-row')).toHaveCount(2);
    const g = await multiHook(page);
    expect(g.ranking?.map((r) => r.name).sort()).toEqual(['Mia', 'Sam']);
    expect(g.result).toBeNull();
    await expect(page.locator('.best-badge')).toHaveCount(0);

    // Change players: the names screen again, with the names just used.
    await page.getByRole('button', { name: 'Change players' }).click();
    await waitPhase(page, 'names');
    await expect(inputs.nth(0)).toHaveValue('Mia');
    await expect(inputs.nth(1)).toHaveValue('Sam');
    // Back returns to the how-to card, and Back there to the menu: nothing was saved.
    await page.getByRole('button', { name: 'Back' }).click();
    await waitPhase(page, 'howto');
    await page.getByRole('button', { name: 'Back' }).click();
    await waitPhase(page, 'menu');
    await expect(page.locator('.sport-card[data-sport="archery"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });

  test('Escape on a handover card quits the game to the menu, saving nothing', async ({ page }) => {
    test.setTimeout(30_000); // 7 to 11 s measured in real time, 2.5x
    const problems = watch(page);
    await page.goto('/?sport=archery&players=2&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await waitSport(page, 'ready to draw', { phase: 'ready' }, 8000);
    await shootWithMouse(page, 1);
    await waitHandover(page, "Player 2, you're up");
    await page.keyboard.press('Escape');
    await waitPhase(page, 'menu', 10000);
    await expect(page.locator('.handover')).toHaveCount(0);
    await expect(page.locator('.sport-card[data-sport="archery"] .sport-best')).toHaveText(
      'No score yet',
    );
    expect(problems).toEqual([]);
  });
});
