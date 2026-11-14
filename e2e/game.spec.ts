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

  test('a device that fails the gate gets a warning and can play anyway', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await page.waitForFunction(
      () => {
        const p = (window as unknown as { __game?: Game }).__game?.phase;
        return p === 'gate-warning' || p === 'title';
      },
      undefined,
      { timeout: 60000 },
    );
    const g = await game(page);
    if (g.phase === 'gate-warning') {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/game-gate-warning.png` });
      await expect(page.getByRole('heading', { name: 'This device may struggle' })).toBeVisible();
      await page.getByRole('button', { name: 'Play anyway' }).click();
    }
    await waitPhase(page, 'title');
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

  test('keyboard and mouse: the hand-cursor circle sits exactly on the pointer', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/?skipGate=1&input=debug');
    await waitPhase(page, 'title');
    await page.getByRole('button', { name: /start/i }).click();
    await waitPhase(page, 'menu');
    for (const p of [
      { x: 412, y: 233 },
      { x: 1111, y: 654 },
      { x: 9, y: 9 },
    ]) {
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(200);
      const box = await page.locator('.hand-cursor').boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - p.y)).toBeLessThanOrEqual(1);
    }
    expect(problems).toEqual([]);
  });

  test('the how-to card fits the screen for every sport in keyboard and mouse mode', async ({
    page,
  }) => {
    test.setTimeout(180000); // six screens through a software renderer
    const problems = watch(page);
    await page.goto('/?skipGate=1&input=debug');
    await waitPhase(page, 'title');
    await page.getByRole('button', { name: /start/i }).click();
    await waitPhase(page, 'menu');
    const ids = await page
      .locator('.sport-card')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sport ?? ''));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      await page.locator(`.sport-card[data-sport="${id}"]`).click();
      await waitPhase(page, 'howto');
      await page.waitForTimeout(600);
      const card = await page.locator('.card-howto').boundingBox();
      expect(card?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((card?.y ?? 0) + (card?.height ?? 9999)).toBeLessThanOrEqual(720);
      const start = await page.getByRole('button', { name: 'Start' }).boundingBox();
      expect((start?.y ?? 0) + (start?.height ?? 9999)).toBeLessThanOrEqual(720);
      await page.keyboard.press('Escape'); // Back
      await waitPhase(page, 'menu');
    }
    expect(problems).toEqual([]);
  });

  test('the how-to overlay pauses the round and resumes it', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=warmup&input=debug&skipGate=1');
    await waitPhase(page, 'playing');
    const clock = (): Promise<string> => page.locator('.hud-score').innerText();
    await page.waitForTimeout(600);
    await page.keyboard.press('h');
    await expect(page.locator('.howto-overlay')).toBeVisible();
    await page.waitForTimeout(200);
    const frozen = await clock();
    await page.waitForTimeout(1500);
    expect(await clock()).toBe(frozen);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('.howto-overlay')).toBeHidden();
    await page.waitForTimeout(800);
    expect(await clock()).not.toBe(frozen);
    // Escape closes the overlay without quitting; Quit still works.
    await page.keyboard.press('h');
    await page.keyboard.press('Escape');
    await expect(page.locator('.howto-overlay')).toBeHidden();
    expect((await game(page)).phase).toBe('playing');
    await page.getByRole('button', { name: 'Quit' }).click();
    await waitPhase(page, 'menu');
    expect(problems).toEqual([]);
  });

  test('climbing: the in-play circle sits exactly on the mouse pointer', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/?sport=climbing&input=debug&skipGate=1');
    await waitPhase(page, 'playing');
    for (const p of [
      { x: 640, y: 360 },
      { x: 301, y: 477 },
      { x: 905, y: 142 },
    ]) {
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(250);
      const box = await page.locator('.hud-cursor').first().boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - p.y)).toBeLessThanOrEqual(1);
    }
    expect(problems).toEqual([]);
  });
});
