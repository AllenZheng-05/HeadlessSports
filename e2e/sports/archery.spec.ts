import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameHook } from '../../src/core/shell/hook';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Game = Pick<GameHook, 'phase' | 'sportId' | 'inputKind' | 'error'> & {
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
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
});
