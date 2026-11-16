// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUi } from './createUi';
import { createGuide } from './screens/calibration';
import { NOTICE_MS } from './screens/menu';
import {
  FAKE_BESTS,
  FAKE_BLOCKED_REPORT,
  FAKE_GATE_REPORT,
  FAKE_RESULT,
  FAKE_SPORTS,
} from './harness/fakeData';
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
    // mouse players have no fist to raise
    expect(root.querySelector('.debug-title')?.textContent).toBe('With the mouse');
    expect(text).not.toContain('Keyboard');
    expect(text).not.toContain('Raise a fist to start');
    expect(text).toContain(bowling.debugKeys[0]);
    expect(root.querySelectorAll('.steps li').length).toBe(bowling.howTo.length);
    click('.screen-howto .btn-big');
    await expect(p).resolves.toBe('start');
    const q = ui.showHowTo(FAKE_SPORTS[3]!, false);
    expect(root.textContent).toContain('You can play this one sitting down.');
    expect(root.textContent).not.toContain('With the mouse');
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

describe('how to play while playing', () => {
  it('opens on click and on H, pauses through the handler, and closes on Resume, H and Escape', () => {
    const quit = vi.fn();
    const paused = vi.fn();
    ui.onQuit(quit);
    ui.onHowToPlay(paused);
    ui.showPlaying(bowling);
    expect(root.querySelector('.howto-overlay')).toBeNull();

    click('.howto-open');
    expect(root.querySelector('.howto-overlay')).not.toBeNull();
    expect(root.querySelector('.howto-overlay')?.textContent).toContain(bowling.howTo[0]);
    expect(paused).toHaveBeenLastCalledWith(true);
    click('.howto-overlay .btn-big');
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(paused).toHaveBeenLastCalledWith(false);

    key('h');
    expect(root.querySelector('.howto-overlay')).not.toBeNull();
    key('Escape');
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(quit).not.toHaveBeenCalled();
    key('H');
    key('h');
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(paused).toHaveBeenCalledTimes(6);

    key('Escape');
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('the overlay goes away, and resumes the round, when the screen changes', () => {
    const paused = vi.fn();
    ui.onHowToPlay(paused);
    ui.showPlaying(bowling);
    click('.howto-open');
    void ui.showResults(bowling, FAKE_RESULT, { isBest: false, best: 1 });
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(paused).toHaveBeenLastCalledWith(false);
  });

  it('shows the "With the mouse" lines only for debug input', () => {
    ui.showPlaying(bowling);
    click('.howto-open');
    expect(root.querySelector('.howto-overlay .debug-keys')).toBeNull();
    key('Escape');
    ui.setInput(createFakeInput('pose', 'debug'));
    click('.howto-open');
    expect(root.querySelector('.howto-overlay .debug-keys')).not.toBeNull();
  });

  it('the how-to card says nothing about raising a fist for mouse players', () => {
    ui.setInput(createFakeInput('pose', 'debug'));
    void ui.showHowTo(bowling, true);
    expect(root.querySelector('.fist-hint')).toBeNull();
    void ui.showHowTo(bowling, false);
    expect(root.querySelector('.fist-hint')).not.toBeNull();
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

  it('gate fail is terminal and says what is missing', () => {
    ui.showGateFail(FAKE_BLOCKED_REPORT);
    expect(root.textContent).toContain('This browser cannot run the game');
    expect(root.textContent).toContain('WebGL 2');
    expect(root.querySelector('.screen-gatefail .btn-big')).toBeNull();
    const details = root.querySelector<HTMLElement>('.details');
    expect(details?.hidden).toBe(true);
    click('.screen-gatefail .btn');
    expect(details?.hidden).toBe(false);
  });

  it('gate warning explains, hides the numbers, and resolves on Play anyway', async () => {
    const p = ui.showGateWarning(FAKE_GATE_REPORT);
    const details = root.querySelector<HTMLElement>('.details');
    expect(details?.hidden).toBe(true);
    expect(root.textContent).toContain('This device may struggle');
    expect(root.textContent).toContain('You are welcome to try');
    expect(root.textContent).toContain('too slow to follow your movements');
    click('.screen-gatewarn .btn:not(.btn-big)');
    expect(details?.hidden).toBe(false);
    expect(details?.textContent).toContain('14.2');
    click('.screen-gatewarn .btn-big');
    await expect(p).resolves.toBeUndefined();
  });

  it('Enter with nothing focused plays anyway', async () => {
    const p = ui.showGateWarning(FAKE_GATE_REPORT);
    (document.activeElement as HTMLElement | null)?.blur();
    key('Enter');
    await expect(p).resolves.toBeUndefined();
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

describe('hands-close calibration outline', () => {
  const part = (svg: SVGElement, side: string, name: string): NodeListOf<SVGElement> =>
    svg.querySelectorAll<SVGElement>(`.guide-line[data-hand="${side}"][data-part="${name}"]`);
  const thumb = (side: 'left' | 'right'): SVGElement =>
    part(createGuide('hands-close').svg, side, 'thumb')[0] as SVGElement;

  it('draws one left and one right hand, not two of the same', () => {
    const svg = createGuide('hands-close').svg;
    for (const side of ['left', 'right']) {
      expect(part(svg, side, 'palm')).toHaveLength(1);
      expect(part(svg, side, 'finger')).toHaveLength(4);
      expect(part(svg, side, 'thumb')).toHaveLength(1);
    }
    expect(thumb('left').getAttribute('transform')).not.toBe(
      thumb('right').getAttribute('transform'),
    );
  });

  it('mirrors the glyphs: the left hand is on screen left and both thumbs point to the middle', () => {
    const l = thumb('left');
    const r = thumb('right');
    const lx = Number(l.getAttribute('x'));
    const rx = Number(r.getAttribute('x'));
    // the left hand is on the left half of the 160-wide outline, the right hand on the right half
    expect(lx).toBeLessThan(80);
    expect(rx).toBeGreaterThan(80);
    // right hand: thumb on its left (toward the middle); left hand: thumb on its right
    expect(rx).toBeLessThan(108);
    expect(lx).toBeGreaterThan(52);
    // rotated in opposite directions
    expect(l.getAttribute('transform')).toMatch(/^rotate\(35 /);
    expect(r.getAttribute('transform')).toMatch(/^rotate\(-35 /);
  });
});

describe('calibration outline matches the pose being asked for', () => {
  const base = {
    message: 'm',
    hint: null,
    progress: 0,
    ok: false,
    problem: 'none' as const,
    handedness: null,
  };
  const arms = (): string[] =>
    Array.from(root.querySelectorAll<SVGElement>('.guide-arm')).map((a) => a.style.transform);

  it('shows the pose for each step: relaxed, raised hand, T-pose', () => {
    const cal = ui.showCalibration(bowlingFull());
    cal.set({ ...base, step: 'position' });
    expect(arms()).toEqual(['rotate(14deg)', 'rotate(-14deg)']);
    cal.set({ ...base, step: 'lighting' });
    expect(arms()).toEqual(['rotate(14deg)', 'rotate(-14deg)']);
    cal.set({ ...base, step: 'handedness' });
    expect(arms()).toEqual(['rotate(14deg)', 'rotate(-165deg)']);
    cal.set({ ...base, step: 'handedness', handedness: 'left' });
    expect(arms()).toEqual(['rotate(165deg)', 'rotate(-14deg)']);
    cal.set({ ...base, step: 'hold-still', handedness: 'left' });
    expect(arms()).toEqual(['rotate(90deg)', 'rotate(-90deg)']);
    cal.close();
  });

  it('keeps the pose when the seated toggle swaps the outline', () => {
    const cal = ui.showCalibration({ ...bowlingFull(), seatedOk: true });
    cal.set({ ...base, step: 'hold-still' });
    click('.cal-seat');
    expect(arms()).toEqual(['rotate(90deg)', 'rotate(-90deg)']);
    cal.close();
  });

  it('hands-only stances draw no arms', () => {
    const cal = ui.showCalibration(FAKE_SPORTS[0]!);
    cal.set({ ...base, step: 'hold-still' });
    expect(arms()).toEqual([]);
    cal.close();
  });
});

function bowlingFull() {
  return { ...FAKE_SPORTS[1]!, stance: 'full-body' as const };
}

function indicatorVisible(): boolean {
  return root.querySelector<HTMLElement>('.camera-indicator')?.hidden === false;
}

function offButtonVisible(): boolean {
  return root.querySelector<HTMLElement>('.camera-off')?.hidden === false;
}

describe('camera indicator on every screen', () => {
  const show: [string, () => void][] = [
    ['loading', () => ui.showLoading('Loading')],
    ['menu', () => void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS)],
    ['how-to', () => void ui.showHowTo(bowling, false)],
    ['results', () => void ui.showResults(bowling, FAKE_RESULT, { isBest: false, best: 1 })],
    ['playing', () => ui.showPlaying(bowling)],
  ];

  it.each(show)('is shown with the off button on %s while the camera is active', (_n, open) => {
    const off = vi.fn();
    ui.onCameraOff(off);
    ui.setCameraActive(true);
    open();
    expect(indicatorVisible()).toBe(true);
    expect(offButtonVisible()).toBe(true);
    expect(root.querySelector('.camera-pill')?.textContent).toBe('Camera on');
    click('.camera-off');
    expect(off).toHaveBeenCalledTimes(1);
  });

  it.each(show.filter(([n]) => n !== 'playing'))(
    'is absent on %s when the camera is not active',
    (_n, open) => {
      open();
      expect(indicatorVisible()).toBe(false);
    },
  );

  it('appears when the camera turns on under a screen, and goes when it turns off', () => {
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS);
    expect(indicatorVisible()).toBe(false);
    ui.setCameraActive(true);
    expect(indicatorVisible()).toBe(true);
    expect(root.querySelector('.camera-indicator')?.classList.contains('corner')).toBe(true);
    ui.setCameraActive(false);
    expect(indicatorVisible()).toBe(false);
  });

  it('stays on screens that follow one another, and keeps calibration inline', () => {
    ui.setCameraActive(true);
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS);
    void ui.showHowTo(bowling, false);
    expect(indicatorVisible()).toBe(true);
    ui.showCalibration(bowling);
    expect(indicatorVisible()).toBe(true);
    const el = root.querySelector('.camera-indicator') as HTMLElement;
    expect(el.classList.contains('inline')).toBe(true);
    expect(el.classList.contains('corner')).toBe(false);
    void ui.showResults(bowling, FAKE_RESULT, { isBest: false, best: 1 });
    expect(el.classList.contains('inline')).toBe(false);
    expect(el.classList.contains('corner')).toBe(false);
    // Cards that reach near the page edge carry the indicator inside, as a compact row.
    expect(el.classList.contains('in-card')).toBe(true);
    expect(el.parentElement?.classList.contains('card-results')).toBe(true);
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS);
    expect(el.classList.contains('in-card')).toBe(false);
    expect(el.classList.contains('corner')).toBe(true);
    expect(el.parentElement?.classList.contains('hs-ui')).toBe(true);
  });
});

describe('menu notice', () => {
  it('shows a polite live-region notice and drops it after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const text = 'That round broke. Pick a sport to try again.';
      void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS, text);
      const note = root.querySelector('.menu-notice');
      expect(note?.textContent).toBe(text);
      expect(note?.getAttribute('aria-live')).toBe('polite');
      vi.advanceTimersByTime(NOTICE_MS + 10);
      expect(root.querySelector('.menu-notice')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is absent without a notice and does not carry into the next menu', () => {
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS);
    expect(root.querySelector('.menu-notice')).toBeNull();
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS, 'x');
    void ui.showMenu(FAKE_SPORTS.slice(0, 5), FAKE_BESTS);
    expect(root.querySelector('.menu-notice')).toBeNull();
  });
});

describe('loading screen Back', () => {
  it('has no Back button during boot', () => {
    ui.showLoading('Warming up', 0.3);
    expect(root.querySelector('.loading-back')).toBeNull();
  });

  it('shows Back with a cancel handler, and Escape cancels too', () => {
    const cancel = vi.fn();
    ui.showLoading('Bowling', undefined, cancel);
    click('.loading-back');
    expect(cancel).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the screen when the cancel handler appears', () => {
    ui.showLoading('One', 0.1);
    const plain = root.querySelector('.screen-loading');
    ui.showLoading('Two', undefined, vi.fn());
    expect(root.querySelector('.screen-loading')).not.toBe(plain);
    expect(root.querySelector('.loading-back')).not.toBeNull();
  });
});

describe('dominant hand toggle', () => {
  it('shows only when options are given, and reports the choice', () => {
    void ui.showHowTo(bowling, true);
    expect(root.querySelector('.hand-toggle')).toBeNull();
    const chosen: string[] = [];
    void ui.showHowTo(bowling, true, {
      handedness: 'right',
      onHandedness: (side) => chosen.push(side),
    });
    expect(root.querySelector('.hand-title')?.textContent).toBe('Dominant hand');
    const right = root.querySelector<HTMLElement>('.hand-opt[data-hand="right"]')!;
    const left = root.querySelector<HTMLElement>('.hand-opt[data-hand="left"]')!;
    expect(right.getAttribute('aria-pressed')).toBe('true');
    expect(right.textContent).toBe('✓ Right');
    expect(left.getAttribute('aria-pressed')).toBe('false');
    expect(left.textContent).toBe('Left');
    left.click();
    expect(chosen).toEqual(['left']);
    expect(left.getAttribute('aria-pressed')).toBe('true');
    expect(left.textContent).toBe('✓ Left');
    expect(right.textContent).toBe('Right');
  });

  it('starts on the remembered side', () => {
    void ui.showHowTo(bowling, true, { handedness: 'left', onHandedness: () => undefined });
    const left = root.querySelector('.hand-opt[data-hand="left"]');
    expect(left?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('sports without a dominant hand', () => {
  const noHand = { ...FAKE_SPORTS[0]!, usesHandedness: false };
  const opts = { handedness: 'right' as const, onHandedness: () => undefined };

  it('the how-to card has no dominant hand toggle, the overlay and others still follow the flag', () => {
    void ui.showHowTo(noHand, true, opts);
    expect(root.querySelector('.hand-toggle')).toBeNull();
    void ui.showHowTo({ ...noHand, usesHandedness: true }, true, opts);
    expect(root.querySelector('.hand-toggle')).not.toBeNull();
    void ui.showHowTo({ ...noHand, usesHandedness: undefined }, true, opts);
    expect(root.querySelector('.hand-toggle')).not.toBeNull();
  });

  it('calibration shows one step fewer and no Hand dot', () => {
    ui.showCalibration(bowlingFull());
    const withHand = root.querySelectorAll('.dot').length;
    ui.showCalibration({ ...bowlingFull(), usesHandedness: false });
    expect(root.querySelectorAll('.dot').length).toBe(withHand - 1);
    expect(root.querySelector('.dot[title="Hand"]')).toBeNull();
  });
});

describe('mouse mode copy', () => {
  it('the camera error offers "Play with the mouse"', () => {
    void ui.showCameraError('camera-denied');
    expect(root.textContent).toContain('Play with the mouse');
    expect(root.textContent).not.toContain('keyboard');
  });
});

describe('seated toggle on calibration', () => {
  it('is offered only for sports that can be played sitting', () => {
    const plain = ui.showCalibration(FAKE_SPORTS[2]!);
    expect(plain.onSeated).toBeUndefined();
    expect(root.querySelector('.cal-seat')).toBeNull();
    plain.close();
    const cal = ui.showCalibration(FAKE_SPORTS[3]!);
    expect(cal.onSeated).toBeTypeOf('function');
    expect(root.querySelector('.cal-seat')).not.toBeNull();
  });

  it('reports the new state and labels it with text', () => {
    const cal = ui.showCalibration(FAKE_SPORTS[3]!);
    const seen: boolean[] = [];
    cal.onSeated?.((seated) => seen.push(seated));
    const button = root.querySelector<HTMLElement>('.cal-seat')!;
    expect(button.textContent).toBe('Sitting: off');
    button.click();
    expect(button.textContent).toBe('Sitting: on');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(button.textContent).toBe('Sitting: off');
    expect(seen).toEqual([true, false]);
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
    return (root.querySelector('.hc-right') as HTMLElement).hidden === true;
  }

  it('is disabled for synthetic and replay sources, enabled otherwise', () => {
    expect(cursorHidden('synthetic')).toBe(true);
    expect(cursorHidden('replay')).toBe(true);
    expect(cursorHidden('camera')).toBe(false);
  });

  it('follows the real pointer for mouse input, with no input state involved', () => {
    expect(cursorHidden(null)).toBe(true); // nothing until the pointer has moved
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 321, clientY: 123 }));
    ui.update(0.016, 32);
    const el = root.querySelector('.hc-right') as HTMLElement;
    expect(el.hidden).toBe(false);
    expect(el.style.left).toBe('321px');
    expect(el.style.top).toBe('123px');
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

describe('turn camera on', () => {
  const shown = (): boolean => {
    const b = root.querySelector<HTMLElement>('.camera-on');
    return b !== null && !b.hidden;
  };

  it('shows on lobby screens in mouse mode, not during play, calibration or loading', () => {
    const on = vi.fn();
    ui.onCameraOn(on);
    void ui.showTitle();
    expect(shown()).toBe(false);
    ui.setCameraOnAvailable(true);
    expect(shown()).toBe(true);
    expect(root.querySelector('.camera-on')?.textContent).toBe('Turn camera on');
    expect(root.querySelector('.camera-on')?.hasAttribute('data-ui')).toBe(true);
    click('.camera-on');
    expect(on).toHaveBeenCalledTimes(1);
    void ui.showMenu(FAKE_SPORTS, FAKE_BESTS);
    expect(shown()).toBe(true);
    void ui.showHowTo(bowling, true);
    expect(shown()).toBe(true);
    void ui.showResults(bowling, FAKE_RESULT, { isBest: false, best: 1 });
    expect(shown()).toBe(true);
    ui.showPlaying(bowling);
    expect(shown()).toBe(false);
    ui.showCalibration(bowling);
    expect(shown()).toBe(false);
    ui.showLoading('Loading');
    expect(shown()).toBe(false);
    void ui.showMenu(FAKE_SPORTS, FAKE_BESTS);
    expect(shown()).toBe(true);
    ui.setCameraOnAvailable(false);
    expect(shown()).toBe(false);
  });

  it('is never shown in camera mode', () => {
    void ui.showMenu(FAKE_SPORTS, FAKE_BESTS);
    expect(shown()).toBe(false);
  });
});

describe('hand cursor during play (camera mode)', () => {
  it('is off during active play, back for the pause overlay and the how-to overlay', () => {
    const input = createFakeInput('hands');
    // the stand-in rects are all at (0,0): a hand at the top left is "over" the controls
    input.setMouse(0, 0, false);
    ui.setInput(input);
    ui.showPlaying(bowling);
    const cursorEl = (): HTMLElement => root.querySelector('.hc-right') as HTMLElement;
    let t = 0;
    const run = (ms: number): void => {
      for (const end = t + ms; t < end; t += 16) ui.update(0.016, t);
    };
    run(600);
    expect(cursorEl().hidden).toBe(true);
    ui.showPause('lost');
    run(300);
    expect(cursorEl().hidden).toBe(false);
    ui.showPause(null);
    run(100);
    expect(cursorEl().hidden).toBe(true);
    click('.howto-open');
    run(300);
    expect(cursorEl().hidden).toBe(false);
    click('.howto-overlay .btn-big');
    run(100);
    expect(cursorEl().hidden).toBe(true);
  });
});

describe('tutorial: the button, the coach panel and the done screen', () => {
  const climbing = { ...FAKE_SPORTS[0]!, hasTutorial: true };
  const panel = (): HTMLElement => root.querySelector('.coach') as HTMLElement;
  const text = (sel: string): string => root.querySelector(sel)?.textContent ?? '';

  it('the Tutorial button is on the how-to card only for a sport with a tutorial', async () => {
    void ui.showHowTo(bowling, true);
    expect(root.querySelector('.howto-tutorial')).toBeNull();
    const p = ui.showHowTo(climbing, true);
    const button = root.querySelector('.howto-tutorial') as HTMLElement;
    expect(button.textContent).toBe('Tutorial');
    expect(button.hasAttribute('data-select')).toBe(true);
    // Beside Start and Back, secondary styling, never the primary action.
    expect(button.classList.contains('btn-secondary')).toBe(true);
    expect(root.querySelector('.screen-howto .actions')?.children.length).toBe(3);
    button.click();
    await expect(p).resolves.toBe('tutorial');
  });

  it('Start and Back still resolve on a card that has the Tutorial button', async () => {
    const a = ui.showHowTo(climbing, true);
    click('.screen-howto .btn-big');
    await expect(a).resolves.toBe('start');
    const b = ui.showHowTo(climbing, true);
    key('Escape');
    await expect(b).resolves.toBe('back');
  });

  it('the coach panel is hidden until a tutorial round shows it', () => {
    expect(panel().hidden).toBe(true);
    ui.coach.show(0, 3, 'Nope');
    expect(panel().hidden).toBe(true);
    ui.showPlaying(climbing);
    ui.coach.show(0, 3, 'Still nope');
    expect(panel().hidden).toBe(true);
    ui.showPlaying(climbing, { tutorial: true });
    expect(panel().hidden).toBe(true);
    ui.coach.show(1, 5, 'Close your fist on a hold', 'Either hand works.');
    expect(panel().hidden).toBe(false);
  });

  it('shows the step counter, the instruction, the detail and one feedback line', () => {
    ui.showPlaying(climbing, { tutorial: true });
    ui.coach.show(1, 5, 'Close your fist on a hold', 'Either hand works.');
    expect(text('.coach-count')).toBe('Step 2 of 5');
    expect(text('.coach-text')).toBe('Close your fist on a hold');
    expect(text('.coach-detail')).toBe('Either hand works.');
    expect((root.querySelector('.coach-detail') as HTMLElement).hidden).toBe(false);
    expect((root.querySelector('.coach-feedback') as HTMLElement).hidden).toBe(true);
    ui.coach.setFeedback('Move closer to a hold');
    expect(text('.coach-feedback')).toBe('Move closer to a hold');
    expect((root.querySelector('.coach-feedback') as HTMLElement).hidden).toBe(false);
    ui.coach.setFeedback(null);
    expect((root.querySelector('.coach-feedback') as HTMLElement).hidden).toBe(true);
    ui.coach.show(2, 5, 'Pull down');
    expect(text('.coach-count')).toBe('Step 3 of 5');
    expect((root.querySelector('.coach-detail') as HTMLElement).hidden).toBe(true);
  });

  it('writes to the DOM only when something changes', () => {
    ui.showPlaying(climbing, { tutorial: true });
    ui.coach.show(0, 2, 'One', 'Two');
    ui.coach.setFeedback('Hmm');
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((records) => seen.push(...records));
    observer.observe(panel(), {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true,
    });
    for (let i = 0; i < 10; i++) {
      ui.coach.show(0, 2, 'One', 'Two');
      ui.coach.setFeedback('Hmm');
    }
    seen.push(...observer.takeRecords());
    observer.disconnect();
    expect(seen).toEqual([]);
  });

  it('confirm shows the praise, and the next show brings the step back', () => {
    ui.showPlaying(climbing, { tutorial: true });
    ui.coach.show(0, 2, 'Grab a hold', 'Either hand.');
    ui.coach.setFeedback('Move closer');
    ui.coach.confirm();
    expect(text('.coach-text')).toBe('Nice');
    expect(panel().dataset.state).toBe('confirm');
    expect((root.querySelector('.coach-detail') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('.coach-feedback') as HTMLElement).hidden).toBe(true);
    ui.coach.confirm('Good grip');
    expect(text('.coach-text')).toBe('Good grip');
    ui.coach.show(1, 2, 'Pull down', 'Both hands.');
    expect(panel().dataset.state).toBe('step');
    expect(text('.coach-text')).toBe('Pull down');
    expect(text('.coach-detail')).toBe('Both hands.');
    expect(text('.coach-count')).toBe('Step 2 of 2');
  });

  it('hide, and leaving the round, take the panel away', () => {
    ui.showPlaying(climbing, { tutorial: true });
    ui.coach.show(0, 2, 'One');
    ui.coach.hide();
    expect(panel().hidden).toBe(true);
    ui.coach.show(0, 2, 'One');
    expect(panel().hidden).toBe(false);
    void ui.showTutorialDone(climbing);
    expect(panel().hidden).toBe(true);
    ui.coach.show(0, 2, 'One');
    expect(panel().hidden).toBe(true);
  });

  it('marks the interface as a tutorial so the sport hint steps aside', () => {
    const container = root.querySelector('.hs-ui') as HTMLElement;
    ui.showPlaying(climbing);
    expect(container.dataset.tutorial).toBe('false');
    ui.showPlaying(climbing, { tutorial: true });
    expect(container.dataset.tutorial).toBe('true');
    ui.showPlaying(climbing);
    expect(container.dataset.tutorial).toBe('false');
  });

  it('the Skip step button and the S key skip the step; End tutorial ends it', () => {
    const skip = vi.fn();
    const end = vi.fn();
    ui.coach.onSkip(skip);
    ui.onTutorialEnd(end);
    ui.showPlaying(climbing, { tutorial: true });
    ui.coach.show(0, 2, 'One');
    click('.coach-skip');
    expect(skip).toHaveBeenCalledTimes(1);
    key('s');
    key('S');
    expect(skip).toHaveBeenCalledTimes(3);
    expect(end).not.toHaveBeenCalled();
    click('.coach-end');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('S does nothing outside a tutorial, and the handler can be unregistered', () => {
    const skip = vi.fn();
    const off = ui.coach.onSkip(skip);
    ui.showPlaying(climbing);
    key('s');
    expect(skip).not.toHaveBeenCalled();
    ui.showPlaying(climbing, { tutorial: true });
    off();
    key('s');
    expect(skip).not.toHaveBeenCalled();
  });

  it('Escape and H behave as in a normal round', () => {
    const quit = vi.fn();
    ui.onQuit(quit);
    ui.showPlaying(climbing, { tutorial: true });
    key('h');
    expect(root.querySelector('.howto-overlay')).not.toBeNull();
    key('Escape');
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(quit).not.toHaveBeenCalled();
    key('Escape');
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('the how-to overlay offers Skip step and End tutorial only in a tutorial', () => {
    ui.showPlaying(climbing);
    click('.howto-open');
    expect(root.querySelector('.overlay-skip')).toBeNull();
    key('Escape');
    ui.showPlaying(climbing, { tutorial: true });
    click('.howto-open');
    expect(root.querySelector('.overlay-skip')?.textContent).toBe('Skip step');
    expect(root.querySelector('.overlay-end')?.textContent).toBe('End tutorial');
  });

  it('Skip step in the overlay closes it, resumes and skips; End tutorial closes it and ends', () => {
    const paused = vi.fn();
    const skip = vi.fn();
    const end = vi.fn();
    ui.onHowToPlay(paused);
    ui.coach.onSkip(skip);
    ui.onTutorialEnd(end);
    ui.showPlaying(climbing, { tutorial: true });
    click('.howto-open');
    click('.overlay-skip');
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(paused).toHaveBeenLastCalledWith(false);
    expect(skip).toHaveBeenCalledTimes(1);
    click('.howto-open');
    click('.overlay-end');
    expect(root.querySelector('.howto-overlay')).toBeNull();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('the hand cursor is off during active tutorial play and back once the round is paused', () => {
    const input = createFakeInput('hands');
    input.setMouse(0, 0, false);
    ui.setInput(input);
    ui.showPlaying(climbing, { tutorial: true });
    ui.coach.show(0, 2, 'One');
    let t = 0;
    const run = (ms: number): void => {
      for (const end = t + ms; t < end; t += 16) ui.update(0.016, t);
    };
    const cursorEl = (): HTMLElement => root.querySelector('.hc-right') as HTMLElement;
    run(600);
    // Active play: the hand cursor is off, so a fist cannot hit Skip step by accident.
    expect(cursorEl().hidden).toBe(true);
    ui.showPause('lost');
    run(300);
    expect(cursorEl().hidden).toBe(false);
  });

  it('the Tutorial done screen resolves Play now, Back to menu and Escape', async () => {
    const play = ui.showTutorialDone(climbing);
    expect(text('.results-headline')).toBe('Tutorial done');
    expect(text('.screen-tutorialdone .btn-big')).toBe('Play now');
    expect(root.querySelector('.screen-tutorialdone .btn-secondary')?.textContent).toBe(
      'Back to menu',
    );
    click('.screen-tutorialdone .btn-big');
    await expect(play).resolves.toBe('play');
    const menu = ui.showTutorialDone(climbing);
    click('.screen-tutorialdone .btn-secondary');
    await expect(menu).resolves.toBe('menu');
    const esc = ui.showTutorialDone(climbing);
    key('Escape');
    await expect(esc).resolves.toBe('menu');
  });

  it('the Tutorial done screen has no personal-best banner or score', () => {
    void ui.showTutorialDone(climbing);
    expect(root.querySelector('.best-badge')).toBeNull();
    expect(root.querySelector('.results-best')).toBeNull();
  });
});
