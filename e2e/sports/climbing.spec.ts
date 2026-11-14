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
    aimImage(side: 'left' | 'right'): { x: number; y: number } | null;
  } | null;
  drawCalls: number;
  debugInput: {
    press(code: string): void;
    release(code: string): void;
    moveTo(x: number, y: number): void;
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
