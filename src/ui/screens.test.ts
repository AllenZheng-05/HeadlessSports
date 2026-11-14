// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUi } from './createUi';
import { FAKE_BESTS, FAKE_GATE_REPORT, FAKE_RESULT, FAKE_SPORTS } from './harness/fakeData';
import { createFakeInput } from './harness/fakeInput';
import { detectBrowser } from './format';
import type { Ui } from './types';

let root: HTMLElement;
let ui: Ui;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function click(selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.click();
}

function key(k: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true }),
  );
}

function screens(): number {
  return root.querySelectorAll('.screen').length;
}

const bowling = FAKE_SPORTS[1]!;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  ui = createUi(root, { reducedMotion: true });
});

afterEach(() => {
  ui.dispose();
  root.remove();
});

describe('screens resolve on click', () => {
  it('title', async () => {
    const p = ui.showTitle();
    click('.screen-title .btn');
    await expect(p).resolves.toBeUndefined();
  });

  it('camera intro', async () => {
    const p = ui.showCameraIntro();
    click('.screen-camintro .btn');
    await expect(p).resolves.toBeUndefined();
  });

  it('camera error: retry and debug', async () => {
    const p = ui.showCameraError('camera-denied');
    expect(root.textContent).toContain('How to allow the camera');
    click('.screen-camerror .actions .btn:first-child');
    await expect(p).resolves.toBe('retry');
    const q = ui.showCameraError('camera-missing');
    expect(root.textContent).not.toContain('How to allow the camera');
    click('.screen-camerror .btn-secondary');
    await expect(q).resolves.toBe('debug');
  });

  it('menu with each count from 1 to 8', async () => {
    for (let n = 1; n <= 8; n++) {
      const sports = FAKE_SPORTS.slice(0, n);
      const p = ui.showMenu(sports, FAKE_BESTS);
      expect(root.querySelectorAll('.sport-card').length).toBe(n);
      click(`.sport-card[data-sport="${sports[n - 1]!.id}"]`);
      await expect(p).resolves.toBe(sports[n - 1]!.id);
    }
  });

  it('menu shows best scores with the sport unit or "No score yet"', () => {
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS);
    const text = root.textContent ?? '';
    expect(text).toContain('Best 12.4 m');
    expect(text).toContain('Best 187 pts');
    expect(text).toContain('No score yet');
  });

  it('how-to start and back, with notes and debug keys', async () => {
    const p = ui.showHowTo(bowling, true);
    const text = root.textContent ?? '';
    expect(text).toContain('Clear a 2 by 2 metre space around you.');
    expect(text).toContain('Raise a fist to start');
    expect(text).toContain(bowling.debugKeys[0]);
    expect(root.querySelectorAll('.steps li').length).toBe(bowling.howTo.length);
    click('.screen-howto .btn-big');
    await expect(p).resolves.toBe('start');
    const q = ui.showHowTo(FAKE_SPORTS[3]!, false);
    expect(root.textContent).toContain('You can play this one sitting down.');
    expect(root.textContent).not.toContain('Keyboard and mouse');
    click('.screen-howto .btn-secondary');
    await expect(q).resolves.toBe('back');
  });

  it('results', async () => {
    const p = ui.showResults(bowling, FAKE_RESULT, { isBest: true, best: 31.7 });
    expect(root.textContent).toContain('New best!');
    expect(root.textContent).toContain('Shake out your arms before the next round.');
    click('.screen-results .btn-big');
    await expect(p).resolves.toBe('again');
    const q = ui.showResults(bowling, FAKE_RESULT, { isBest: false, best: null });
    expect(root.textContent).not.toContain('New best!');
    click('.screen-results .btn-secondary');
    await expect(q).resolves.toBe('menu');
  });

  it('calibration skip', async () => {
    const cal = ui.showCalibration(bowling);
    const done = vi.fn();
    void cal.skipped.then(done);
    click('.cal-skip');
    await flush();
    expect(done).toHaveBeenCalled();
  });
});

describe('screens resolve from the keyboard', () => {
  it('Enter with nothing focused activates the primary button', async () => {
    const p = ui.showTitle();
    (document.activeElement as HTMLElement | null)?.blur();
    key('Enter');
    await expect(p).resolves.toBeUndefined();
  });

  it('arrow keys move focus among the buttons, Enter activates', async () => {
    const p = ui.showMenu(FAKE_SPORTS.slice(0, 3), FAKE_BESTS);
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.sport-card'));
    expect(document.activeElement).toBe(cards[0]);
    key('ArrowRight');
    expect(document.activeElement).toBe(cards[1]);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(document.activeElement).toBe(cards[2]);
    (document.activeElement as HTMLElement).blur();
    key('Enter');
    await expect(p).resolves.toBe('climbing');
  });

  it('Escape is back on how-to and menu on results', async () => {
    const p = ui.showHowTo(bowling, false);
    key('Escape');
    await expect(p).resolves.toBe('back');
    const q = ui.showResults(bowling, FAKE_RESULT, { isBest: false, best: 1 });
    key('Escape');
    await expect(q).resolves.toBe('menu');
  });

  it('Escape quits while playing', () => {
    const quit = vi.fn();
    ui.onQuit(quit);
    ui.showPlaying(bowling);
    key('Escape');
    expect(quit).toHaveBeenCalledTimes(1);
    click('.quit');
    expect(quit).toHaveBeenCalledTimes(2);
  });
});

describe('screen management', () => {
  it('showing a screen removes the previous one', () => {
    void ui.showTitle();
    expect(screens()).toBe(1);
    void ui.showCameraIntro();
    expect(screens()).toBe(1);
    expect(root.querySelector('.screen-title')).toBeNull();
    ui.showLoading('Loading', 0.2);
    expect(screens()).toBe(1);
    expect(root.querySelector('.screen-camintro')).toBeNull();
  });

  it('a hidden screen never resolves', async () => {
    const first = vi.fn();
    const p = ui.showTitle();
    void p.then(first);
    const startButton = root.querySelector<HTMLElement>('.screen-title .btn');
    void ui.showCameraIntro();
    startButton?.click();
    await flush();
    expect(first).not.toHaveBeenCalled();
  });

  it('loading updates in place', () => {
    ui.showLoading('One', 0.1);
    const before = root.querySelector('.screen-loading');
    ui.showLoading('Two', 0.9);
    expect(root.querySelector('.screen-loading')).toBe(before);
    expect(root.querySelector('.loading-text')?.textContent).toBe('Two');
    expect((root.querySelector('.progress-fill') as HTMLElement).style.width).toBe('90%');
  });

  it('gate fail shows plain reasons and a details toggle', () => {
    ui.showGateFail(FAKE_GATE_REPORT);
    const details = root.querySelector<HTMLElement>('.details');
    expect(details?.hidden).toBe(true);
    expect(root.textContent).toContain('This game needs a more powerful computer');
    expect(root.textContent).toContain('too slow to follow your movements');
    click('.screen-gatefail .btn');
    expect(details?.hidden).toBe(false);
    expect(details?.textContent).toContain('14.2');
  });

  it('playing hides screens and shows the hud; pause shows and hides', () => {
    void ui.showTitle();
    ui.showPlaying(bowling);
    expect(root.querySelector('.screen-title')).toBeNull();
    expect(root.querySelector<HTMLElement>('.hud')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.mirror')?.hidden).toBe(false);
    ui.setCameraActive(true);
    expect(root.querySelector('.camera-pill')?.textContent).toBe('Camera on');
    ui.showPause('move-left');
    expect(root.querySelector('.pause-text')?.textContent).toBe('Move left');
    ui.showPause('step-back');
    expect(root.querySelector('.pause-text')?.textContent).toBe('Step back');
    ui.showPause(null);
    expect(root.querySelector<HTMLElement>('.pause')?.hidden).toBe(true);
    void ui.showMenu(FAKE_SPORTS, FAKE_BESTS);
    expect(root.querySelector<HTMLElement>('.hud')?.hidden).toBe(true);
  });

  it('camera off button calls the handler', () => {
    const off = vi.fn();
    ui.onCameraOff(off);
    ui.showPlaying(bowling);
    ui.setCameraActive(true);
    click('.camera-off');
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('calibration view updates without rewriting unchanged values', () => {
    const cal = ui.showCalibration(FAKE_SPORTS[0]!);
    const view = {
      step: 'position' as const,
      message: 'Step back',
      hint: null,
      progress: 0.5,
      ok: false,
      problem: 'none' as const,
      handedness: null,
    };
    cal.set(view);
    const card = root.querySelector('.card-cal') as HTMLElement;
    const obs = new MutationObserver(() => undefined);
    obs.observe(card, { subtree: true, childList: true, characterData: true, attributes: true });
    obs.takeRecords();
    cal.set({ ...view });
    expect(obs.takeRecords().length).toBe(0);
    cal.set({ ...view, ok: true, message: 'Good' });
    expect(obs.takeRecords().length).toBeGreaterThan(0);
    expect(root.querySelector('.guide')?.classList.contains('ok')).toBe(true);
    obs.disconnect();
    cal.close();
    expect(root.querySelector('.screen-calibration')).toBeNull();
  });
});

describe('raised fist starts the how-to', () => {
  it('resolves start on ArmRaised from the attached input', async () => {
    const input = createFakeInput('pose');
    ui.setInput(input);
    const p = ui.showHowTo(bowling, false);
    input.emit({ type: 'ArmRaised', t: 1, hand: 'right', both: false });
    await expect(p).resolves.toBe('start');
  });

  it('works when the input is attached after the screen is shown, and not after it is hidden', async () => {
    const input = createFakeInput('pose');
    const p = ui.showHowTo(bowling, false);
    ui.setInput(input);
    const done = vi.fn();
    void p.then(done);
    void ui.showTitle();
    input.emit({ type: 'ArmRaised', t: 1, hand: 'left', both: false });
    await flush();
    expect(done).not.toHaveBeenCalled();
  });
});

describe('hand cursor and the input source', () => {
  function cursorHidden(kind: string | null): boolean {
    const input = createFakeInput('pose');
    (input as { source: unknown }).source = kind ? { kind } : null;
    input.setMouse(0.05, 0.05, false);
    ui.setInput(input);
    void ui.showTitle();
    ui.update(0.016, 0);
    ui.update(0.016, 16);
    return (root.querySelector('.hand-cursor') as HTMLElement).hidden === true;
  }

  it('is disabled for synthetic and replay sources, enabled otherwise', () => {
    expect(cursorHidden('synthetic')).toBe(true);
    expect(cursorHidden('replay')).toBe(true);
    expect(cursorHidden('camera')).toBe(false);
    expect(cursorHidden(null)).toBe(false);
  });
});

describe('tunables via the ui', () => {
  it('debug renders a panel and non-debug does not', () => {
    const debugRoot = document.createElement('div');
    document.body.append(debugRoot);
    const dbg = createUi(debugRoot, { debug: true });
    dbg.tunables.register('x', 'X', { a: 1 });
    expect(debugRoot.querySelector('.tunables-config')).not.toBeNull();
    dbg.dispose();
    ui.tunables.register('x', 'X', { a: 1 });
    expect(root.querySelector('.tunables')).toBeNull();
    debugRoot.remove();
  });
});

describe('detectBrowser', () => {
  it('recognises the common browsers', () => {
    expect(detectBrowser('Mozilla/5.0 Chrome/120 Safari/537.36')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 Chrome/120 Safari/537.36 Edg/120')).toBe('edge');
    expect(detectBrowser('Mozilla/5.0 Gecko/20100101 Firefox/120.0')).toBe('firefox');
    expect(detectBrowser('Mozilla/5.0 Version/17.0 Safari/605.1.15')).toBe('safari');
    expect(detectBrowser('curl/8')).toBe('other');
  });
});
