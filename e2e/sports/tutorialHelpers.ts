import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** True while the sport's normal hint line is on screen (present, not hidden, not display:none). */
export const hintVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.hud-hint');
    if (el === null || el.hidden) return false;
    if (getComputedStyle(el).display === 'none') return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  });

/**
 * In a tutorial the coach panel is the only instruction line: the sport's normal hint line
 * (`.hud-hint`) must stay invisible, whatever the sport sets, for `ms` of watching.
 */
export async function expectNoHintFor(page: Page, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    expect(await hintVisible(page), 'the normal hint line shows in a tutorial').toBe(false);
    await page.waitForTimeout(100);
  }
}

/**
 * True once the sport's `.hud-hint` has had text set at some point while it should be hidden: the
 * helper above only proves it is invisible, this proves the check is not vacuous.
 */
export const hintHasText = (page: Page): Promise<boolean> =>
  page.evaluate(() => (document.querySelector('.hud-hint')?.textContent ?? '') !== '');

/**
 * The error for a tutorial that did not finish in time, naming the step and the phase, so a hang
 * reads as "stuck at step N" and not as a bare test timeout.
 */
export async function tutorialStuck(page: Page, label: string, ms: number): Promise<Error> {
  const now = await page
    .evaluate(() => {
      const g = (
        window as unknown as {
          __game?: {
            phase: string;
            error?: string | null;
            sport: { tutorialStep?: number; tutorialSteps?: number; phase?: string } | null;
          };
        }
      ).__game;
      if (!g) return 'no __game';
      const s = g.sport;
      return `phase ${g.phase}, tutorialStep ${s?.tutorialStep ?? 'none'} of ${s?.tutorialSteps ?? 'none'}, sport phase ${s?.phase ?? 'none'}, error ${g.error ?? 'none'}`;
    })
    .catch((err: unknown) => `page unreadable (${String(err)})`);
  return new Error(`${label}: the tutorial did not finish within ${ms} ms; ${now}`);
}

/** Poll the page until the tutorial is done, or throw `tutorialStuck` at the deadline. */
export async function waitTutorialDone(
  page: Page,
  label: string,
  ms: number,
  each?: () => Promise<void>,
): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    const phase = await page.evaluate(
      () => (window as unknown as { __game?: { phase: string } }).__game?.phase ?? '',
    );
    if (phase === 'tutorial-done') return;
    if (Date.now() >= until) throw await tutorialStuck(page, label, ms);
    if (each) await each();
    await page.waitForTimeout(100);
  }
}
