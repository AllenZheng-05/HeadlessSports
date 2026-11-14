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
    pointerHoldAt(x: number, y: number): number;
    aimImage(side: 'left' | 'right'): { x: number; y: number } | null;
  } | null;
  drawCalls: number;
  debugInput: {
    press(code: string): void;
    release(code: string): void;
    moveTo(x: number, y: number): void;
    setButton(down: boolean): void;
  } | null;
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

  test('is playable from the keyboard and mouse input', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/climbing-start.png` });

    const grab = async (side: 'left' | 'right'): Promise<{ x: number; y: number }> => {
      const select = side === 'right' ? 'KeyD' : 'KeyA';
      const toggle = side === 'right' ? 'KeyE' : 'KeyQ';
      const aim = await page.evaluate(
        (s) => (window as unknown as { __game: ClimbingHook }).__game.sport?.aimImage(s) ?? null,
        side,
      );
      expect(aim).not.toBeNull();
      await page.evaluate(
        ([sel, a]) => {
          const d = (window as unknown as { __game: ClimbingHook }).__game.debugInput!;
          d.press(sel as string);
          d.moveTo((a as { x: number }).x, (a as { y: number }).y);
        },
        [select, aim] as const,
      );
      await page.waitForTimeout(250);
      await page.evaluate(
        (k) => (window as unknown as { __game: ClimbingHook }).__game.debugInput!.press(k),
        toggle,
      );
      await page.waitForTimeout(300);
      expect(
        await page.evaluate(
          (s) => (window as unknown as { __game: ClimbingHook }).__game.sport!.holding[s],
          side,
        ),
      ).toBe(true);
      return aim!;
    };
    const pull = async (side: 'left' | 'right', from: { x: number; y: number }): Promise<void> => {
      await page.evaluate(
        ([sel, x, y]) => {
          const d = (window as unknown as { __game: ClimbingHook }).__game.debugInput!;
          d.press(sel as string);
          d.moveTo(x as number, y as number);
        },
        [side === 'right' ? 'KeyD' : 'KeyA', from.x, from.y + 0.25] as const,
      );
      await page.waitForTimeout(700);
    };

    const h0 = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.sport!.height,
    );
    const aimRight = await grab('right');
    await pull('right', aimRight);
    const h1 = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.sport!.height,
    );
    expect(h1 - h0).toBeGreaterThan(0.3);
    const aimLeft = await grab('left');
    await pull('left', aimLeft);
    const h2 = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.sport!.height,
    );
    expect(h2 - h0).toBeGreaterThan(0.3);
    await page.screenshot({ path: `${SHOTS}/climbing-debug.png` });

    await waitPhase(page, 'results', 60000);
    const result = await page.evaluate(
      () => (window as unknown as { __game: ClimbingHook }).__game.result,
    );
    expect(result?.score ?? 0).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('is playable with the mouse alone, hand over hand, without letting go', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1&short=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(500);

    const read = (): Promise<{
      active: string | null;
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
          left: s.holding.left,
          right: s.holding.right,
          grabs: s.grabs,
          height: s.height,
          aimL: s.aimImage('left'),
          aimR: s.aimImage('right'),
        };
      });
    const click = async (at: { x: number; y: number }): Promise<void> => {
      await page.evaluate(
        ([x, y]) => {
          const d = (window as unknown as { __game: ClimbingHook }).__game.debugInput!;
          d.moveTo(x as number, y as number);
        },
        [at.x, at.y] as const,
      );
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        const d = (window as unknown as { __game: ClimbingHook }).__game.debugInput!;
        d.setButton(true);
        d.setButton(false);
      });
      await page.waitForTimeout(700);
    };

    const h0 = (await read()).height;
    let prev = await read();
    expect(prev.active).toBe('right');
    for (let n = 1; n <= 6; n++) {
      const aim = prev.active === 'left' ? prev.aimL : prev.aimR;
      expect(aim).not.toBeNull();
      const mover = prev.active;
      await click(aim!);
      const now = await read();
      // The clicking hand holds, the other one never let go, and the mouse changed hands.
      expect(now[mover as 'left' | 'right']).toBe(true);
      expect(now.grabs).toBe(prev.grabs + 1);
      if (n > 1) expect(now[mover === 'left' ? 'right' : 'left']).toBe(true);
      expect(now.active).toBe(mover === 'left' ? 'right' : 'left');
      prev = now;
    }
    expect(prev.left && prev.right).toBe(true);
    expect(prev.height - h0).toBeGreaterThan(0.8);

    // A click that is not on a hold changes nothing.
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
    await click(empty!);
    const after = await read();
    expect(after.left && after.right).toBe(true);
    expect(after.grabs).toBe(prev.grabs);
    expect(after.active).toBe(prev.active);
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
