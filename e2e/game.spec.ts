import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameHook } from '../src/core/shell/hook';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Game = Pick<GameHook, 'phase' | 'sportId' | 'isBest' | 'frames' | 'inputKind' | 'error'> & {
  result: { score: number; headline: string } | null;
};

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
      isBest: g.isBest,
      frames: g.frames,
      inputKind: g.inputKind,
      error: g.error,
      result: g.result,
    };
  });
}

/** Close and open the right fist `cycles` times through the debug input. */
async function pumpFists(page: Page, cycles: number): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await page.evaluate(() => {
      const d = (
        window as unknown as {
          __game: { debugInput: { press(c: string): void; release(c: string): void } };
        }
      ).__game.debugInput;
      d.press('KeyE');
      d.release('KeyE');
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const d = (
        window as unknown as {
          __game: { debugInput: { press(c: string): void; release(c: string): void } };
        }
      ).__game.debugInput;
      d.press('KeyE');
      d.release('KeyE');
    });
    await page.waitForTimeout(250);
  }
}

test.describe('game shell', () => {
  test('warm-up with the synthetic player reaches results and a best score', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=warmup&source=synthetic&skipGate=1');
    await waitPhase(page, 'playing');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/game-warmup-playing.png` });
    await waitPhase(page, 'results', 60000);
    const g = await game(page);
    expect(g.result?.score ?? 0).toBeGreaterThan(0);
    expect(g.isBest).toBe(true);
    expect(g.inputKind).toBe('synthetic');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/game-warmup-results.png` });
    expect(problems).toEqual([]);
  });

  test('timeScale 4 finishes much faster', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=warmup&source=synthetic&skipGate=1&timeScale=4');
    await waitPhase(page, 'playing');
    const started = Date.now();
    await waitPhase(page, 'results', 60000);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(8000);
    expect((await game(page)).result?.score ?? 0).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('warm-up is playable from the keyboard input', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=warmup&input=debug&skipGate=1');
    await waitPhase(page, 'playing');
    await pumpFists(page, 5);
    await waitPhase(page, 'results', 15000);
    expect((await game(page)).result?.score ?? 0).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await waitPhase(page, 'menu');
    expect(problems).toEqual([]);
  });

  test('title, menu, how-to, play and back to the menu', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?skipGate=1&input=debug');
    await waitPhase(page, 'title');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/game-title.png` });
    await page.getByRole('button', { name: /start/i }).click();
    await waitPhase(page, 'menu');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/game-menu.png` });
    const ids = await page
      .locator('.sport-card')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sport ?? ''));
    expect(ids).toEqual(['climbing', 'bowling', 'batting', 'archery', 'javelin', 'pitching']);
    await page.keyboard.press('Enter'); // the first card holds focus
    await waitPhase(page, 'howto');
    await page.keyboard.press('Enter'); // Start holds focus
    await waitPhase(page, 'playing');
    expect((await game(page)).sportId).toBe('climbing');
    await page.keyboard.press('Escape'); // quit the round
    await waitPhase(page, 'menu');
    expect(problems).toEqual([]);
  });

  test('a device that fails the gate sees the gate screen', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await page.waitForFunction(
      () => {
        const p = (window as unknown as { __game?: Game }).__game?.phase;
        return p === 'gate-fail' || p === 'title';
      },
      undefined,
      { timeout: 60000 },
    );
    const g = await game(page);
    if (g.phase === 'gate-fail') {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/game-gate-fail.png` });
      await expect(page.locator('#ui')).not.toBeEmpty();
    } else {
      expect(g.phase).toBe('title');
    }
    expect(problems).toEqual([]);
  });

  test('camera path: title, intro, continue, menu', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?skipGate=1');
    await waitPhase(page, 'title');
    await page.getByRole('button', { name: /start/i }).click();
    await waitPhase(page, 'camera');
    await page.getByRole('button', { name: /continue/i }).click();
    await waitPhase(page, 'menu', 45000);
    expect((await game(page)).inputKind).toBe('camera');
    expect(problems).toEqual([]);
  });
});
