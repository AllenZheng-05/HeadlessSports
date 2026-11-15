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
    holdIndex: { left: number; right: number };
    holdScreen(index: number): { x: number; y: number };
    nextHold(side: 'left' | 'right'): number;
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
      // The other hand let go of its hold the moment this hand took a new one.
      expect(grabbed[other], `n=${n} other`).toBe(false);
      // Drag down: the body is pulled up by the hand that holds.
      const hBefore = grabbed.height;
      await page.mouse.move(aim!.x * vp.width, (aim!.y + 0.28) * vp.height, { steps: 8 });
      await page.waitForTimeout(250);
      const pulled = await read();
      expect(pulled.dragging, `n=${n} pulled`).toBe(true);
      expect(pulled[mover]).toBe(true);
      expect(pulled[other]).toBe(false);
      expect(pulled.height).toBeGreaterThanOrEqual(hBefore - 0.01);
      await page.mouse.up();
      await page.waitForTimeout(200);
      const now = await read();
      // Releasing keeps the grip and the mouse changes hands.
      expect(now[mover]).toBe(true);
      expect(now[other]).toBe(false);
      expect(now.active, `n=${n} mover=${mover} grabs=${now.grabs}`).toBe(other);
      expect(now.grabs).toBe(prev.grabs + 1);
      prev = now;
    }
    expect(prev.left || prev.right).toBe(true);
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
    expect(after.left).toBe(prev.left);
    expect(after.right).toBe(prev.right);
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

  test('the hold under the real cursor is the one that gets grabbed, at any window size and height', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?sport=climbing&input=debug&skipGate=1&timeScale=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);

    const sizes = [
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
      { width: 900, height: 900 },
      { width: 1600, height: 600 },
      { width: 1000, height: 650 },
      { width: 1280, height: 720 },
    ];
    let side: 'left' | 'right' = 'right';
    let lastHeight = 0;
    for (let n = 0; n < sizes.length; n++) {
      const vp = sizes[n]!;
      await page.setViewportSize(vp);
      await page.waitForTimeout(500);
      const pick = await page.evaluate((sd) => {
        const s = (window as unknown as { __game: ClimbingHook }).__game.sport!;
        const index = s.nextHold(sd);
        return { index, screen: index >= 0 ? s.holdScreen(index) : null, h: s.height };
      }, side);
      expect(pick.index, `n=${n}`).toBeGreaterThanOrEqual(0);
      const px = pick.screen!.x * vp.width;
      const py = pick.screen!.y * vp.height;
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(vp.width);
      expect(py).toBeGreaterThan(0);
      expect(py).toBeLessThan(vp.height);
      await page.mouse.move(px, py);
      await page.waitForTimeout(150);
      // The hold under the tip of the real cursor is the one a press would take.
      const hover = await page.evaluate(
        ([x, y]) =>
          (window as unknown as { __game: ClimbingHook }).__game.sport!.pointerHoldAt(x!, y!),
        [pick.screen!.x, pick.screen!.y],
      );
      expect(hover, `n=${n} hover`).toBe(pick.index);
      await page.mouse.down();
      await page.waitForTimeout(300);
      const held = await page.evaluate(
        () => (window as unknown as { __game: ClimbingHook }).__game.sport!.holdIndex,
      );
      expect(held[side], `n=${n} ${side} grabbed`).toBe(pick.index);
      await page.mouse.move(px, py + 0.2 * vp.height, { steps: 8 });
      await page.waitForTimeout(300);
      await page.mouse.up();
      await page.waitForTimeout(250);
      lastHeight = pick.h;
      side = side === 'right' ? 'left' : 'right';
    }
    const end = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.sport!.height,
    );
    expect(end).toBeGreaterThan(lastHeight);
    expect(end).toBeGreaterThan(1);
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
