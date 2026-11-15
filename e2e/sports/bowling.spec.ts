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
  aimAngle: number;
  lastAngle: number | null;
  lastSpeed: number | null;
  lastHook: number | null;
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
      releases: { angle: number; ballSpeed: number; hook: number }[];
      aimAngle: number;
    } | null;
    if (!s) return null;
    const last = s.releases.length > 0 ? s.releases[s.releases.length - 1] : undefined;
    return {
      phase: s.phase,
      ballZ: s.ballZ,
      ballX: s.ballX,
      pinsDown: s.pinsDown,
      rolls: [...s.rolls],
      contacted: s.contacted,
      releases: s.releases.length,
      aimAngle: s.aimAngle,
      lastAngle: last ? last.angle : null,
      lastSpeed: last ? last.ballSpeed : null,
      lastHook: last ? last.hook : null,
    };
  });
}

/** Poll the sport's probe from Node until `check` passes. No string-to-code evaluation (CSP). */
async function waitSport(
  page: Page,
  check: (s: BowlingProbe) => boolean,
  timeout = 60000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const s = await probe(page);
    if (s && check(s)) return;
    if (Date.now() > deadline) {
      throw new Error(`waitSport timed out after ${timeout} ms: ${check.toString()}`);
    }
    await page.waitForTimeout(30);
  }
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

  test('the mouse can bowl a ball: aim, hold to wind up, let go', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=bowling&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await waitSport(page, (s) => s.phase === 'pickup');
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const at = (fx: number): [number, number] => [vp.width * fx, vp.height * 0.6];

    // Mouse at the centre aims straight, before any press.
    await page.mouse.move(...at(0.5));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/bowling-pickup.png` });
    const straight = (await probe(page))?.aimAngle ?? 99;
    expect(Math.abs(straight)).toBeLessThan(0.002);
    // Moving the mouse turns the arrows toward it, both ways.
    await page.mouse.move(...at(0.515));
    await page.waitForTimeout(300);
    const right = (await probe(page))?.aimAngle ?? 0;
    expect(right).toBeGreaterThan(straight + 0.008);
    await page.mouse.move(...at(0.485));
    await page.waitForTimeout(300);
    const left = (await probe(page))?.aimAngle ?? 0;
    expect(left).toBeLessThan(straight - 0.008);

    // Pressing puts the ball in the hand and starts the wind-up; the arrows keep following.
    await page.mouse.move(...at(0.515));
    await page.mouse.down();
    await waitSport(page, (s) => s.phase === 'aim', 3000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/bowling-aim.png` });
    await page.mouse.move(...at(0.505));
    await page.waitForTimeout(300);
    const shown = (await probe(page))?.aimAngle ?? 99;
    expect(shown).toBeGreaterThan(0.002);
    expect(shown).toBeLessThan(right);
    await page.mouse.up();
    await waitSport(page, (s) => s.phase === 'rolling', 5000);
    // The ball leaves on the aim the arrows were showing, at the fixed speed, with no hook.
    const launched = await probe(page);
    expect(launched?.lastAngle).toBeCloseTo(shown, 5);
    expect(launched?.lastSpeed).toBeCloseTo(7.5, 3);
    expect(launched?.lastHook).toBe(0);
    await waitSport(page, (s) => s.ballZ < -8);
    await page.screenshot({ path: `${SHOTS}/bowling-rolling.png` });
    await waitSport(page, (s) => s.contacted, 10000);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/bowling-pins.png` });
    // The verdict comes within the settle cap of the first pin contact (was about 5 s).
    await waitSport(page, (s) => s.rolls.length >= 1, 3500);
    await waitSport(page, (s) => s.phase === 'pickup' || s.rolls.length >= 1, 40000);
    await waitSport(page, (s) => s.phase === 'pickup' || s.phase === 'done', 40000);
    const p = await probe(page);
    expect(p?.rolls.length).toBeGreaterThanOrEqual(1);
    const mark = await page.evaluate(() => {
      const cells = document.querySelectorAll('.hud-table tr:nth-child(2) td');
      return cells[0]?.textContent ?? '';
    });
    expect(mark).not.toBe('');
    expect(problems).toEqual([]);
  });

  test('the mouse plays a whole short game with taps and ignores presses mid-roll', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/?sport=bowling&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const cx = vp.width * 0.5;
    const cy = vp.height * 0.6;
    await page.mouse.move(cx, cy);
    let balls = 0;
    for (let i = 0; i < 8; i++) {
      await waitSport(page, (s) => s.phase === 'pickup' || s.phase === 'done', 60000);
      if ((await probe(page))?.phase === 'done') break;
      // A quick click: the ball still gets its back-swing, then goes.
      await page.mouse.down();
      await page.mouse.up();
      balls++;
      await waitSport(page, (s) => s.phase === 'rolling' || s.rolls.length >= balls, 5000);
      // A click while the ball rolls does nothing: no extra ball, no stuck state.
      await page.mouse.down();
      await page.mouse.up();
      await waitSport(page, (s) => s.rolls.length >= balls, 20000);
      expect((await probe(page))?.releases).toBe(balls);
    }
    await waitPhase(page, 'results', 60000);
    const g = await page.evaluate(() => {
      const hook = (window as unknown as { __game: Game }).__game;
      return { result: hook.result };
    });
    expect(g.result?.score ?? 0).toBeGreaterThan(0);
    expect(g.result?.detail?.balls ?? 0).toBeGreaterThanOrEqual(2);
    expect(g.result?.detail?.balls ?? 0).toBe(balls);
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
