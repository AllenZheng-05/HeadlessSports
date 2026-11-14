import { BLOCKING_FAILURES } from '../../core/gate/evaluate';
import type { GateFailure, GateReport } from '../../core/gate/types';
import type { TrackingErrorCode } from '../../tracking/types';
import { h, selectButton } from '../dom';
import type { BrowserName } from '../format';
import { PCT_INT } from '../format';
import { createLogo } from '../logo';
import type { ScreenSpec } from './shared';
import { logoWithWordmark, screenShell, wordmark } from './shared';

export interface LoadingScreen extends ScreenSpec {
  update(text: string, progress?: number): void;
  /** True when the screen has a Back button (a sport is loading). */
  readonly cancellable: boolean;
}

export function buildLoading(
  text: string,
  progress?: number,
  onCancel?: () => void,
): LoadingScreen {
  const { el, card } = screenShell('loading', 'card-loading');
  el.setAttribute('aria-busy', 'true');
  const label = h('p', 'loading-text', text);
  label.setAttribute('role', 'status');
  const bar = h('div', 'progress-bar');
  const fill = h('div', 'progress-fill');
  bar.append(fill);
  card.append(logoWithWordmark(110), label, bar);
  let lastText = text;
  let lastPct = -2;
  const update = (t: string, p?: number): void => {
    if (t !== lastText) {
      lastText = t;
      label.textContent = t;
    }
    const pct = p === undefined ? -1 : Math.round(Math.max(0, Math.min(1, p)) * 100);
    if (pct === lastPct) return;
    lastPct = pct;
    if (pct < 0) {
      bar.classList.add('indeterminate');
      fill.style.width = '';
    } else {
      bar.classList.remove('indeterminate');
      fill.style.width = PCT_INT[pct] as string;
    }
  };
  update(text, progress);
  if (onCancel === undefined) return { el, update, cancellable: false };
  // A stalled sport download or WASM start must not trap the player.
  const back = selectButton('Back', 'btn btn-secondary loading-back');
  back.addEventListener('click', () => onCancel());
  card.append(back);
  return { el, update, cancellable: true, primary: back, onEscape: onCancel };
}

const FAILURE_TEXT: Record<GateFailure, string> = {
  mobile: 'Headless Sports is made for laptops and desktop computers, not phones or tablets.',
  'small-viewport': 'This window is too small. Make the browser window bigger, or go full screen.',
  'no-webgl2': 'This browser cannot draw the 3D graphics (WebGL 2) the game needs.',
  'no-camera-api':
    'This browser cannot use a camera. You can still play with the keyboard and mouse.',
  'no-workers': 'This browser cannot run background workers, which the game needs.',
  'slow-tracking': 'This computer is too slow to follow your movements smoothly.',
  'slow-rendering': 'This computer is too slow to draw the game smoothly while the camera is on.',
  'benchmark-error': 'We could not finish checking how fast this computer is.',
};

export function gateMessages(report: GateReport, blockedOnly = false): string[] {
  const out: string[] = [];
  for (const f of report.failures) {
    if (blockedOnly && !BLOCKING_FAILURES.includes(f)) continue;
    const t = FAILURE_TEXT[f];
    if (t && !out.includes(t)) out.push(t);
    if (out.length === 2) break;
  }
  if (out.length === 0 && blockedOnly) out.push('We could not start the game in this browser.');
  return out;
}

/** Terminal: only reached when the browser lacks something the game cannot start without. */
export function buildGateFail(report: GateReport): ScreenSpec {
  const { el, card } = screenShell('gatefail', 'card-gate');
  card.append(h('h1', 'heading', 'This browser cannot run the game'));
  for (const m of gateMessages(report, true)) card.append(h('p', 'body', m));
  return gateCard(el, card, report);
}

/** A warning the player can dismiss: the game may struggle here, but they are welcome to try. */
export function buildGateWarning(report: GateReport, resolve: () => void): ScreenSpec {
  const { el, card } = screenShell('gatewarn', 'card-gate');
  card.append(h('h1', 'heading', 'This device may struggle'));
  card.append(h('p', 'body', 'The game may not run smoothly here. You are welcome to try.'));
  for (const m of gateMessages(report, false)) card.append(h('p', 'body body-soft', m));
  const play = selectButton('Play anyway', 'btn btn-big');
  play.addEventListener('click', () => resolve());
  card.append(play);
  return gateCard(el, card, report, play);
}

function gateCard(
  el: HTMLElement,
  card: HTMLElement,
  report: GateReport,
  primary?: HTMLElement,
): ScreenSpec {
  const toggle = selectButton('Details', 'btn btn-secondary');
  toggle.setAttribute('aria-expanded', 'false');
  const details = h('div', 'details');
  details.hidden = true;
  details.id = 'gate-details';
  toggle.setAttribute('aria-controls', details.id);

  const table = h('table', 'details-table');
  const body = h('tbody');
  const row = (name: string, value: string, need?: string): void => {
    const tr = h('tr');
    tr.append(h('th', '', name), h('td', '', value), h('td', 'need', need ?? ''));
    body.append(tr);
  };
  const c = report.capabilities;
  const t = report.thresholds;
  const m = report.measurements;
  row(
    'Window',
    `${c.viewportWidth} x ${c.viewportHeight}`,
    `at least ${t.minViewportWidth} x ${t.minViewportHeight}`,
  );
  row('3D graphics (WebGL 2)', c.webgl2 ? 'Yes' : 'No');
  row('Camera support', c.cameraApi ? 'Yes' : 'No');
  row('Background workers', c.workers ? 'Yes' : 'No');
  row('Phone or tablet', c.touchPrimary ? 'Yes' : 'No');
  if (m) {
    row('Tracking speed', `${m.trackingHz.toFixed(1)} per second`, `at least ${t.minTrackingHz}`);
    row(
      'Drawing speed',
      `${m.renderFps.toFixed(1)} frames per second`,
      `at least ${t.minRenderFps}`,
    );
    row('Time per tracking step', `${m.inferenceMs.toFixed(1)} ms`);
    row('Graphics', m.rendererBackend);
    row('Tracking runs on', m.trackerDelegate);
  }
  if (report.error) row('Error', report.error);
  table.append(body);
  details.append(table);

  toggle.addEventListener('click', () => {
    const open = details.hidden;
    details.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Hide details' : 'Details';
  });
  card.append(toggle, details);
  return { el, primary: primary ?? toggle };
}

export function buildTitle(resolve: () => void): ScreenSpec {
  const { el, card } = screenShell('title', 'card-title');
  const hero = h('div', 'title-hero');
  const words = h('div', 'title-words');
  words.append(wordmark(), h('p', 'tagline', 'Step back, raise a fist, and play.'));
  hero.append(createLogo(190), words);
  const start = selectButton('Start', 'btn btn-big');
  start.addEventListener('click', () => resolve());
  card.append(hero, start, h('p', 'privacy', 'Your camera feed never leaves this device.'));
  return { el, primary: start };
}

export function buildCameraIntro(resolve: () => void): ScreenSpec {
  const { el, card } = screenShell('camintro', 'card-narrow');
  card.append(
    h('h1', 'heading', 'We’ll ask for your camera next'),
    h(
      'p',
      'body',
      'Your video is processed on this device and is never uploaded. Nothing is recorded or saved.',
    ),
    h('p', 'body body-soft', 'Your browser will show a permission box. Choose Allow.'),
  );
  const go = selectButton('Continue', 'btn btn-big');
  go.addEventListener('click', () => resolve());
  card.append(go);
  return { el, primary: go };
}

const ERROR_TEXT: Record<TrackingErrorCode, { title: string; body: string }> = {
  'camera-denied': {
    title: 'The camera is blocked',
    body: 'Headless Sports needs your camera to see you. Allow it for this site, then try again.',
  },
  'camera-missing': {
    title: 'We cannot find a camera',
    body: 'Plug in a webcam or check that your computer has one, then try again.',
  },
  'camera-in-use': {
    title: 'Your camera is busy',
    body: 'Another app or tab is using the camera. Close it, then try again.',
  },
  'camera-low-resolution': {
    title: 'The camera picture is too small',
    body: 'We need a sharper picture to follow your hands. Try another camera.',
  },
  'model-load-failed': {
    title: 'The tracking files did not load',
    body: 'Check your connection and try again.',
  },
  'worker-failed': {
    title: 'Tracking stopped working',
    body: 'Reloading the page usually fixes this. You can also try again.',
  },
  unsupported: {
    title: 'This browser cannot track you',
    body: 'Try a recent version of Chrome or Edge.',
  },
};

export const DENIED_HELP: Record<BrowserName, string[]> = {
  chrome: [
    'Click the camera icon at the right end of the address bar.',
    'Choose Always allow, then select Done.',
    'Or open Settings, Privacy and security, Site settings, Camera.',
  ],
  edge: [
    'Click the lock icon at the left end of the address bar.',
    'Set Camera to Allow.',
    'Or open Settings, Cookies and site permissions, Camera.',
  ],
  firefox: [
    'Click the camera icon with a line through it in the address bar.',
    'Remove the Blocked setting next to Use the camera.',
    'Then reload the page.',
  ],
  safari: [
    'Open the Safari menu, then Settings, then Websites, then Camera.',
    'Set this website to Allow.',
    'Then reload the page.',
  ],
  other: [
    'Open your browser settings and find the camera permission for this site.',
    'Set it to Allow, then reload the page.',
  ],
};

const BROWSER_LABEL: Record<BrowserName, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  other: 'your browser',
};

export function buildCameraError(
  code: TrackingErrorCode,
  browser: BrowserName,
  resolve: (choice: 'retry' | 'debug') => void,
): ScreenSpec {
  const { el, card } = screenShell('camerror', 'card-narrow');
  const text = ERROR_TEXT[code];
  card.append(h('h1', 'heading', text.title), h('p', 'body', text.body));
  if (code === 'camera-denied') {
    const help = h('div', 'help');
    help.append(h('p', 'help-title', `How to allow the camera in ${BROWSER_LABEL[browser]}`));
    const list = h('ol', 'help-list');
    for (const line of DENIED_HELP[browser]) list.append(h('li', '', line));
    help.append(list);
    card.append(help);
  }
  const actions = h('div', 'actions');
  const retry = selectButton('Try again', 'btn');
  const debug = selectButton('Play with keyboard and mouse', 'btn btn-secondary');
  retry.addEventListener('click', () => resolve('retry'));
  debug.addEventListener('click', () => resolve('debug'));
  actions.append(retry, debug);
  card.append(actions);
  return { el, primary: retry };
}
