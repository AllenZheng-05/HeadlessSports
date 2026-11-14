import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameHook } from '../../src/core/shell/hook';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Game = Pick<GameHook, 'phase' | 'error'> & {
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
};

interface BowlingProbe {
  phase: string;
  ballZ: number;
  ballX: number;
  pinsDown: number;
  rolls: number[];
  contacted: boolean;
  releases: number;
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

function probe(page: Page): Promise<BowlingProbe | null> {
  return page.evaluate(() => {
    const s = (window as unknown as { __game: { sport: unknown } }).__game.sport as {
      phase: string;
      ballZ: number;
      ballX: number;
      pinsDown: number;
      rolls: number[];
      contacted: boolean;
      releases: unknown[];
    } | null;
    if (!s) return null;
    return {
      phase: s.phase,
      ballZ: s.ballZ,
      ballX: s.ballX,
      pinsDown: s.pinsDown,
      rolls: [...s.rolls],
      contacted: s.contacted,
      releases: s.releases.length,
    };
  });
}

async function waitSport(page: Page, expr: string, timeout = 60000): Promise<void> {
  await page.waitForFunction(
    (code) => {
      const s = (window as unknown as { __game: { sport: unknown } }).__game.sport;
      if (!s) return false;
      return new Function('s', `return ${code}`)(s) as boolean;
    },
    expr,
    { timeout, polling: 30 },
  );
}

test.describe('bowling', () => {
  test('the synthetic player bowls a short game to the results screen', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=bowling&source=synthetic&skipGate=1&short=1&timeScale=4');
    await waitPhase(page, 'playing');
    await waitPhase(page, 'results', 170000);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/bowling-results.png` });
    const g = await page.evaluate(() => {
      const hook = (window as unknown as { __game: Game }).__game;
      return { result: hook.result };
    });
    expect(g.result?.score ?? 0).toBeGreaterThan(0);
    expect(g.result?.detail?.balls ?? 0).toBeGreaterThanOrEqual(2);
    console.info(`bot short game: ${JSON.stringify(g.result)}`);
    expect(problems).toEqual([]);
  });

  test('the keyboard and mouse can bowl a ball', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=bowling&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await waitSport(page, "s.phase === 'pickup'");
    interface Dbg {
      press(c: string): void;
      release(c: string): void;
      moveTo(x: number, y: number): void;
    }
    const dbg = (fn: string, ...args: unknown[]): Promise<void> =>
      page.evaluate(
        ([name, a]) => {
          const d = (window as unknown as { __game: { debugInput: Dbg } }).__game
            .debugInput as unknown as Record<string, (...x: unknown[]) => void>;
          (d[name as string] as (...x: unknown[]) => void)(...(a as unknown[]));
        },
        [fn, args] as const,
      );

    // Mouse x near 0.655 keeps the wrist at its neutral offset: a straight ball.
    await dbg('moveTo', 0.655, 0.6);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/bowling-pickup.png` });
    await dbg('press', 'KeyE');
    await dbg('release', 'KeyE');
    await waitSport(page, "s.phase === 'aim'");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/bowling-aim.png` });
    await dbg('press', 'KeyB');
    await page.waitForTimeout(700);
    await dbg('release', 'KeyB');
    await waitSport(page, "s.phase === 'rolling'", 5000);
    await waitSport(page, 's.ballZ < -8');
    await page.screenshot({ path: `${SHOTS}/bowling-rolling.png` });
    await waitSport(page, 's.contacted === true', 10000);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/bowling-pins.png` });
    await waitSport(page, "s.phase === 'pickup' || s.rolls.length >= 1", 40000);
    await waitSport(page, "s.phase === 'pickup' || s.phase === 'done'", 40000);
    const p = await probe(page);
    expect(p?.rolls.length).toBeGreaterThanOrEqual(1);
    const mark = await page.evaluate(() => {
      const cells = document.querySelectorAll('.hud-table tr:nth-child(2) td');
      return cells[0]?.textContent ?? '';
    });
    expect(mark).not.toBe('');
    expect(problems).toEqual([]);
  });

  test('the physics engine is a lazy chunk', async ({ page }) => {
    const problems = watch(page);
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));
    await page.goto('/?skipGate=1&input=debug');
    await waitPhase(page, 'title');
    await page.waitForTimeout(800);
    expect(requests.filter((u) => u.toLowerCase().includes('rapier'))).toEqual([]);

    await page.getByRole('button', { name: /start/i }).click();
    await waitPhase(page, 'menu');
    await page
      .getByRole('button', { name: /bowling/i })
      .first()
      .click();
    await waitPhase(page, 'howto');
    await page.keyboard.press('Enter');
    await waitPhase(page, 'playing');
    expect(requests.filter((u) => u.toLowerCase().includes('rapier')).length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
