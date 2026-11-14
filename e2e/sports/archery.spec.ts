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
    expect(problems).toEqual([]);
  });

  test('a round can be played from the keyboard and mouse', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=archery&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');

    // Debug body: shoulders at y 0.32, one shoulder width is 0.0731 across. DebugInput measures a
    // wrist from the opposite shoulder (see the report), so the cursor for a wrist `wx` sw from its
    // own shoulder sits at 0.5 - side * 0.5 sw + wx sw.
    const SW_X = 0.13 / (16 / 9);
    const cursor = (side: -1 | 1, wx: number, wy: number): { x: number; y: number } => ({
      x: 0.5 - side * 0.5 * SW_X + wx * SW_X,
      y: 0.32 - 0.13 * wy,
    });
    const bow = cursor(-1, -1.2, 0.1);
    const nock = cursor(1, -1.4, 0.05);
    const full = cursor(1, 0.25, 0.05);
    const debug = (fn: string, ...args: unknown[]): Promise<void> =>
      page.evaluate(
        ([name, a]) => {
          const d = (window as unknown as { __game: { debugInput: Record<string, unknown> } })
            .__game.debugInput;
          (d[name as string] as (...x: unknown[]) => void)(...(a as unknown[]));
        },
        [fn, args] as const,
      );
    const tap = async (code: string): Promise<void> => {
      await debug('press', code);
      await debug('release', code);
      await page.waitForTimeout(120);
    };

    // Left hand is the bow hand for a right-handed archer; the right hand is the draw hand.
    await tap('KeyA');
    await debug('moveTo', bow.x, bow.y);
    await page.waitForTimeout(150);
    await tap('KeyD');
    await debug('moveTo', nock.x, nock.y);
    await page.waitForTimeout(200);
    await waitSport(page, 'the bow arm up, ready to nock', { phase: 'ready' }, 5000);

    await tap('KeyE'); // close the right fist next to the bow hand
    await waitSport(page, 'a nocked arrow', { phase: 'drawing' }, 5000);

    await debug('moveTo', full.x, full.y); // drag away
    await waitSport(page, 'a full draw', { minDraw: 0.8 }, 5000);
    await page.screenshot({ path: `${SHOTS}/archery-debug-draw.png` });

    // Fine-aim: select the bow hand again and put it back where it was.
    await tap('KeyA');
    await debug('moveTo', bow.x, bow.y);
    await page.waitForTimeout(250);
    await waitSport(page, 'still drawing after aiming', { phase: 'drawing' }, 5000);

    await tap('KeyE'); // open the fist: release
    await waitSport(page, 'a shot arrow', { arrowsShot: 1 }, 10000);

    const s = await sportState(page);
    expect(s.phaseLog.slice(0, 3)).toEqual(['ready', 'drawing', 'flying']);
    expect(s.arrowsShot).toBe(1);
    expect((await game(page)).error).toBeNull();
    expect(problems).toEqual([]);
  });
});
