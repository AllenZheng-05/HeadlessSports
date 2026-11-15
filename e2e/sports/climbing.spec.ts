import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface ClimbingHook {
  phase: string;
  error: string | null;
  result: { score: number; headline: string; detail?: Record<string, number> } | null;
  sport: {
    height: number;
    best: number;
    grabs: number;
    stamina: number;
    status: string;
    holding: { left: boolean; right: boolean };
    layoutChecksum: number;
    pointerHand: 'left' | 'right' | null;
    pointerDragging: boolean;
    pointerHoldAt(x: number, y: number): number;
    aimImage(side: 'left' | 'right'): { x: number; y: number } | null;
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
      (p) => (window as unknown as { __game: ClimbingHook }).__game.phase === p,
      phase,
      { timeout },
    );
  } catch (err) {
    const now = await page.evaluate(
      () =>
        `${(window as unknown as { __game: ClimbingHook }).__game.phase} (error: ${(window as unknown as { __game: ClimbingHook }).__game.error ?? 'none'})`,
    );
    throw new Error(`Never reached phase "${phase}"; stuck at ${now}.`, { cause: err });
  }
}

const SYNTHETIC = '/?sport=climbing&source=synthetic&skipGate=1&short=1&timeScale=3';

test.describe('rock climbing', () => {
  test('the synthetic climber plays a full short round', async ({ page }) => {
    const problems = watch(page);
    await page.goto(SYNTHETIC);
    await waitPhase(page, 'playing');
    await page.waitForFunction(
      () => ((window as unknown as { __game: ClimbingHook }).__game.sport?.height ?? 0) > 2,
      undefined,
      {
        timeout: 60000,
      },
    );
    await page.screenshot({ path: `${SHOTS}/climbing-play.png` });
    const drawCalls = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.drawCalls,
    );
    console.info(`draw calls: ${drawCalls}`);
    expect(drawCalls).toBeLessThan(40);
    await waitPhase(page, 'results', 120000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.result,
    );
    expect(result?.score ?? 0).toBeGreaterThanOrEqual(3);
    expect(result?.detail?.grabs ?? 0).toBeGreaterThanOrEqual(6);
    console.info(`bot result: ${JSON.stringify(result)}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/climbing-results.png` });
    expect(problems).toEqual([]);
  });

  test('is playable with the mouse alone: press, drag, release, hand over hand', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/climbing-start.png` });
    const vp = page.viewportSize()!;

    const read = (): Promise<{
      active: 'left' | 'right' | null;
      dragging: boolean;
      left: boolean;
      right: boolean;
      grabs: number;
      height: number;
      aimL: { x: number; y: number } | null;
      aimR: { x: number; y: number } | null;
    }> =>
      page.evaluate(() => {
        const s = (window as unknown as { __game: ClimbingHook }).__game.sport!;
        return {
          active: s.pointerHand,
          dragging: s.pointerDragging,
          left: s.holding.left,
          right: s.holding.right,
          grabs: s.grabs,
          height: s.height,
          aimL: s.aimImage('left'),
          aimR: s.aimImage('right'),
        };
      });
    const moveTo = async (x: number, y: number): Promise<void> => {
      await page.mouse.move(x * vp.width, y * vp.height);
      await page.waitForTimeout(120);
    };

    const h0 = (await read()).height;
    let prev = await read();
    expect(prev.active).toBe('right');
    for (let n = 1; n <= 5; n++) {
      const mover = prev.active!;
      const other = mover === 'left' ? 'right' : 'left';
      const aim = mover === 'left' ? prev.aimL : prev.aimR;
      expect(aim).not.toBeNull();
      await moveTo(aim!.x, aim!.y);
      await page.mouse.down();
      await page.waitForTimeout(250);
      const grabbed = await read();
      expect(grabbed.dragging, `n=${n}`).toBe(true);
      expect(grabbed[mover]).toBe(true);
      expect(grabbed.grabs).toBe(prev.grabs + 1);
      // Still the same hand while the button is down.
      expect(grabbed.active).toBe(mover);
      // Drag down: the body is pulled up while both hands stay on the wall.
      const hBefore = grabbed.height;
      await page.mouse.move(aim!.x * vp.width, (aim!.y + 0.28) * vp.height, { steps: 8 });
      await page.waitForTimeout(250);
      const pulled = await read();
      expect(pulled.dragging, `n=${n} pulled`).toBe(true);
      expect(pulled[mover]).toBe(true);
      if (n > 1) expect(pulled[other]).toBe(true);
      expect(pulled.height).toBeGreaterThanOrEqual(hBefore - 0.01);
      await page.mouse.up();
      await page.waitForTimeout(200);
      const now = await read();
      // Releasing keeps the grip and the mouse changes hands.
      expect(now[mover]).toBe(true);
      if (n > 1) expect(now[other]).toBe(true);
      expect(now.active, `n=${n} mover=${mover} grabs=${now.grabs}`).toBe(other);
      expect(now.grabs).toBe(prev.grabs + 1);
      prev = now;
    }
    expect(prev.left && prev.right).toBe(true);
    expect(prev.height - h0).toBeGreaterThan(0.6);
    await page.screenshot({ path: `${SHOTS}/climbing-debug.png` });

    // A press that is not on a hold changes nothing.
    const empty = await page.evaluate(() => {
      const s = (window as unknown as { __game: ClimbingHook }).__game.sport!;
      for (let y = 0.05; y < 1; y += 0.05) {
        for (let x = 0.05; x < 1; x += 0.05) {
          if (s.pointerHoldAt(x, y) < 0) return { x, y };
        }
      }
      return null;
    });
    expect(empty).not.toBeNull();
    await moveTo(empty!.x, empty!.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await read();
    expect(after.left && after.right).toBe(true);
    expect(after.grabs).toBe(prev.grabs);
    expect(after.active).toBe(prev.active);

    // The round still ends with a result for the height climbed.
    await waitPhase(page, 'results', 60000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.result,
    );
    expect(result?.score ?? 0).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('the hold layout is reproducible from the seed', async ({ browser }) => {
    const sums: number[] = [];
    for (const seed of [5, 5, 6]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await ctx.newPage();
      const problems = watch(page);
      await page.goto(`${SYNTHETIC}&seed=${seed}`);
      await waitPhase(page, 'playing');
      sums.push(
        await page.evaluate(
          () => (window as unknown as { __game: ClimbingHook }).__game.sport!.layoutChecksum,
        ),
      );
      expect(problems).toEqual([]);
      await ctx.close();
    }
    expect(sums[0]).toBe(sums[1]);
    expect(sums[0]).not.toBe(sums[2]);
  });
});
