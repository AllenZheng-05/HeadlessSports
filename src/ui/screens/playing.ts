import type { RoundResult, SportMeta } from '../../core/sport';
import type { FrameProblem } from '../../input/types';
import { h, selectButton, svgEl } from '../dom';
import { formatScore, hexColor } from '../format';
import type { ResultsOutcome } from '../types';
import type { ScreenSpec } from './shared';
import { screenShell } from './shared';
import { howToBody } from './menu';

export interface PlayingControls {
  onQuit: () => void;
  /** The "How to play" control was used (click, button, or the H key). */
  onHowTo: () => void;
  /** True while the how-to overlay is open: Escape then closes it instead of quitting. */
  isOverlayOpen: () => boolean;
  closeOverlay: () => void;
  /** Tutorial round: S skips the step, and the hand cursor can also reach these buttons while paused. */
  tutorial?: {
    skip: () => void;
    /** The coach panel's Skip step and End tutorial buttons. */
    buttons: HTMLElement[];
  };
}

/** The little "How to play" and "Quit" controls shown while playing. */
export function buildPlaying(controls: PlayingControls): ScreenSpec {
  const el = h('div', 'screen screen-playing');
  const bar = h('div', 'play-controls');
  const howTo = selectButton('How to play (H)', 'btn btn-small btn-secondary howto-open');
  howTo.addEventListener('click', controls.onHowTo);
  const quit = selectButton('Quit', 'btn btn-small btn-secondary quit');
  quit.addEventListener('click', controls.onQuit);
  bar.append(howTo, quit);
  el.append(bar);
  return {
    el,
    camera: true,
    // The hand cursor only reaches the How to play control (and, in a tutorial, the coach
    // buttons), and only shows near them. It is off during active play and back when paused.
    cursorButtons: controls.tutorial ? [howTo, ...controls.tutorial.buttons] : [howTo],
    revealNear: true,
    onEscape: () => {
      if (controls.isOverlayOpen()) controls.closeOverlay();
      else controls.onQuit();
    },
    onKey: (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (controls.tutorial && (e.key === 's' || e.key === 'S')) {
        if (!controls.isOverlayOpen()) controls.tutorial.skip();
        return true;
      }
      if (e.key !== 'h' && e.key !== 'H') return false;
      if (controls.isOverlayOpen()) controls.closeOverlay();
      else controls.onHowTo();
      return true;
    },
  };
}

export interface HowToOverlay {
  readonly el: HTMLElement;
  readonly resume: HTMLElement;
  /** Tutorial rounds only: the overlay's own Skip step and End tutorial buttons. */
  readonly extras: HTMLElement[];
}

export interface TutorialOverlayActions {
  /** Close the overlay (resume the round), then skip the step. */
  skip: () => void;
  /** End the tutorial. */
  end: () => void;
}

/** The sport's how-to content over the paused round, with a Resume button. */
export function buildHowToOverlay(
  meta: SportMeta,
  debugInput: boolean,
  onResume: () => void,
  tutorial?: TutorialOverlayActions,
): HowToOverlay {
  const el = h('div', 'howto-overlay');
  el.setAttribute('data-ui', '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `How to play ${meta.title}`);
  const card = h('div', 'card card-howto card-howto-play');
  card.style.setProperty('--accent', hexColor(meta.accent));
  const head = h('div', 'howto-head');
  const swatch = h('span', 'howto-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  head.append(swatch, h('h1', 'heading', meta.title));
  const body = howToBody(meta, debugInput);
  const actions = h('div', 'actions');
  const resume = selectButton('Resume', 'btn btn-big');
  resume.addEventListener('click', onResume);
  actions.append(resume);
  const extras: HTMLElement[] = [];
  if (tutorial) {
    // A camera player reaches these with the hand cursor while the round is paused.
    const skip = selectButton('Skip step', 'btn btn-secondary overlay-skip');
    const end = selectButton('End tutorial', 'btn btn-secondary overlay-end');
    skip.addEventListener('click', tutorial.skip);
    end.addEventListener('click', tutorial.end);
    actions.append(skip, end);
    extras.push(skip, end);
  }
  card.append(head, body, actions);
  el.append(card);
  return { el, resume, extras };
}

const PAUSE_TEXT: Record<Exclude<FrameProblem, 'none'>, string> = {
  'move-left': 'Move left',
  'move-right': 'Move right',
  'step-back': 'Step back',
  'step-closer': 'Step closer',
  lost: 'We can’t see you',
  'hands-out-of-view': 'Show both hands',
};

function arrow(direction: 'left' | 'right' | 'up' | 'down'): SVGSVGElement {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[direction];
  const svg = svgEl('svg', {
    viewBox: '0 0 120 120',
    width: 220,
    height: 220,
    'aria-hidden': 'true',
  });
  svg.append(
    svgEl('path', {
      d: 'M14 46 H62 V22 L108 60 L62 98 V74 H14 Z',
      fill: '#ff7a59',
      stroke: '#27364a',
      'stroke-width': 7,
      'stroke-linejoin': 'round',
      transform: `rotate(${rot} 60 60)`,
    }),
  );
  svg.setAttribute('class', `pause-arrow arrow-${direction}`);
  return svg;
}

function questionMark(): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 120 120',
    width: 200,
    height: 200,
    'aria-hidden': 'true',
  });
  svg.setAttribute('class', 'pause-arrow');
  svg.append(
    svgEl('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: '#ff7a59',
      stroke: '#27364a',
      'stroke-width': 7,
    }),
  );
  const t = svgEl('text', {
    x: 60,
    y: 84,
    'text-anchor': 'middle',
    'font-size': 72,
    'font-weight': 600,
    fill: '#27364a',
    'font-family': 'Fredoka, sans-serif',
  });
  t.textContent = '?';
  svg.append(t);
  return svg;
}

function twoHands(): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 180 100',
    width: 280,
    height: 156,
    'aria-hidden': 'true',
  });
  svg.setAttribute('class', 'pause-arrow');
  for (const cx of [50, 130]) {
    svg.append(
      svgEl('circle', { cx, cy: 50, r: 34, fill: '#ff7a59', stroke: '#27364a', 'stroke-width': 7 }),
      svgEl('path', {
        d: `M${cx - 14} 38 q 8 -12 18 -4`,
        stroke: '#ffd2c4',
        'stroke-width': 5,
        'stroke-linecap': 'round',
        fill: 'none',
      }),
    );
  }
  return svg;
}

function pictureFor(problem: Exclude<FrameProblem, 'none'>): SVGSVGElement {
  switch (problem) {
    case 'move-left':
      return arrow('left');
    case 'move-right':
      return arrow('right');
    case 'step-back':
      return arrow('down');
    case 'step-closer':
      return arrow('up');
    case 'lost':
      return questionMark();
    case 'hands-out-of-view':
      return twoHands();
  }
}

export interface PauseOverlay {
  readonly el: HTMLElement;
  show(problem: FrameProblem | null): void;
}

export function createPause(parent: HTMLElement): PauseOverlay {
  const el = h('div', 'pause');
  el.setAttribute('data-ui', '');
  el.hidden = true;
  el.setAttribute('role', 'alert');
  parent.append(el);
  let current: FrameProblem | null = null;
  return {
    el,
    show(problem): void {
      const p = problem === 'none' ? null : problem;
      if (p === current) return;
      current = p;
      el.replaceChildren();
      if (p === null) {
        el.hidden = true;
        return;
      }
      const box = h('div', 'pause-box');
      box.append(pictureFor(p), h('p', 'pause-text', PAUSE_TEXT[p]));
      el.append(box);
      el.hidden = false;
    },
  };
}

const CONFETTI_COLORS = ['#ff7a59', '#8fd694', '#bfe3f7', '#f6d55c'];

export function buildResults(
  meta: SportMeta,
  result: RoundResult,
  outcome: ResultsOutcome,
  resolve: (choice: 'again' | 'menu') => void,
): ScreenSpec {
  const { el, card } = screenShell('results', 'card-results');
  card.append(h('p', 'results-sport', meta.title));
  const headline = h('h1', 'results-headline', result.headline);
  card.append(headline);

  if (outcome.isBest) {
    const wrap = h('div', 'badge-wrap');
    wrap.append(h('div', 'best-badge', 'New best!'));
    for (let i = 0; i < 14; i++) {
      const c = h('span', 'confetti');
      const angle = (i / 14) * Math.PI * 2;
      c.style.setProperty(
        '--dx',
        `calc(${Math.round(Math.cos(angle) * (150 + (i % 3) * 30))} * var(--u))`,
      );
      c.style.setProperty(
        '--dy',
        `calc(${Math.round(Math.sin(angle) * (70 + (i % 3) * 16))} * var(--u))`,
      );
      c.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length] as string);
      c.style.setProperty('--d', `${(i % 5) * 40}ms`);
      wrap.append(c);
    }
    card.append(wrap);
  }
  if (outcome.best !== null) {
    card.append(h('p', 'results-best', `Personal best: ${formatScore(meta, outcome.best)}`));
  }
  if (result.lines && result.lines.length > 0) {
    const list = h('ul', 'results-lines');
    for (const line of result.lines) list.append(h('li', '', line));
    card.append(list);
  }
  card.append(h('p', 'rest-prompt', 'Shake out your arms before the next round.'));
  const actions = h('div', 'actions');
  const again = selectButton('Play again', 'btn btn-big');
  const menu = selectButton('Menu', 'btn btn-secondary');
  again.addEventListener('click', () => resolve('again'));
  menu.addEventListener('click', () => resolve('menu'));
  actions.append(again, menu);
  card.append(actions);
  return { el, primary: again, cameraInCard: true, onEscape: () => resolve('menu') };
}
