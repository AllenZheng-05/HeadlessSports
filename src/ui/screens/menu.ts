import type { SportMeta } from '../../core/sport';
import type { Side } from '../../input/types';
import { h, selectButton } from '../dom';
import { formatScore, hexColor } from '../format';
import type { ScreenHost, ScreenSpec } from './shared';
import { screenShell } from './shared';
import type { HowToChoice, HowToOptions, PlayersControl, TutorialDoneChoice } from '../types';

/** How long the menu notice stays up. */
export const NOTICE_MS = 6000;

export function columnsFor(count: number): number {
  if (count <= 5) return Math.max(1, count);
  if (count === 6) return 3;
  return 4;
}

export function buildMenu(
  sports: readonly SportMeta[],
  bests: ReadonlyMap<string, number>,
  resolve: (id: string) => void,
  notice?: string,
): ScreenSpec {
  const { el, card } = screenShell('menu', 'card-menu');
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  if (notice !== undefined && notice !== '') {
    const note = h('p', 'menu-notice', notice);
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    el.append(note);
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      note.remove();
    }, NOTICE_MS);
  }
  el.style.setProperty('--cols', String(columnsFor(sports.length)));
  el.dataset.count = String(sports.length);
  card.append(h('h1', 'heading', 'Pick a sport'));
  const grid = h('div', 'sport-grid');
  let first: HTMLElement | null = null;
  for (const meta of sports) {
    const b = selectButton('', 'sport-card');
    b.dataset.sport = meta.id;
    b.style.setProperty('--accent', hexColor(meta.accent));
    const band = h('span', 'sport-band');
    band.setAttribute('aria-hidden', 'true');
    const best = bests.get(meta.id);
    b.append(
      band,
      h('span', 'sport-title', meta.title),
      h('span', 'sport-tagline', meta.tagline),
      h(
        'span',
        best === undefined ? 'sport-best none' : 'sport-best',
        best === undefined ? 'No score yet' : `Best ${formatScore(meta, best)}`,
      ),
    );
    b.addEventListener('click', () => resolve(meta.id));
    grid.append(b);
    first ??= b;
  }
  card.append(grid);
  return {
    el,
    primary: first,
    dispose: () => {
      if (noticeTimer !== null) clearTimeout(noticeTimer);
    },
  };
}

/** "Dominant hand: Right / Left" for mouse play. Text and a check mark, not colour alone. */
function handednessToggle(options: HowToOptions): HTMLElement {
  const wrap = h('div', 'hand-toggle');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Dominant hand');
  wrap.append(h('p', 'hand-title', 'Dominant hand'));
  const row = h('div', 'hand-row');
  const buttons = new Map<Side, HTMLButtonElement>();
  const refresh = (current: Side): void => {
    for (const [side, b] of buttons) {
      const on = side === current;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
      b.textContent = `${on ? '✓ ' : ''}${side === 'right' ? 'Right' : 'Left'}`;
    }
  };
  for (const side of ['right', 'left'] as const) {
    const b = selectButton('', 'btn btn-small btn-secondary hand-opt');
    b.dataset.hand = side;
    b.addEventListener('click', () => {
      options.onHandedness(side);
      refresh(side);
    });
    buttons.set(side, b);
    row.append(b);
  }
  refresh(options.handedness);
  wrap.append(row);
  return wrap;
}

/**
 * "Players: 1 2 3 4" for sports with pass-and-play. Text and a check mark show the choice, not
 * colour alone. With more than one player Start leads to the names screen.
 */
function playersToggle(meta: SportMeta, control: PlayersControl): HTMLElement {
  const wrap = h('div', 'players-toggle');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Players');
  wrap.append(h('p', 'hand-title', 'Players'));
  const row = h('div', 'hand-row');
  const buttons: HTMLButtonElement[] = [];
  const refresh = (count: number): void => {
    buttons.forEach((b, i) => {
      const on = i + 1 === count;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
      b.textContent = on ? `✓ ${i + 1}` : String(i + 1);
    });
  };
  const max = meta.multiplayer?.maxPlayers ?? 1;
  for (let n = 1; n <= max; n++) {
    const b = selectButton('', 'btn btn-small btn-secondary players-opt');
    b.dataset.players = String(n);
    b.setAttribute('aria-label', n === 1 ? '1 player' : `${n} players`);
    b.addEventListener('click', () => {
      control.count = n;
      control.onCount(n);
      refresh(n);
    });
    buttons.push(b);
    row.append(b);
  }
  refresh(control.count);
  wrap.append(row);
  return wrap;
}

/** The steps, notes and (for mouse play) the sport's "With the mouse" lines. Shared by the card and the in-play overlay. */
export function howToBody(
  meta: SportMeta,
  debugInput: boolean,
  options?: HowToOptions,
  players?: PlayersControl,
): HTMLElement {
  const body = h('div', 'howto-body');
  const cols = h('div', 'howto-cols');
  const steps = h('ol', 'steps');
  for (const line of meta.howTo) steps.append(h('li', '', line));
  cols.append(steps);

  const side = h('div', 'howto-side');
  if (options && meta.usesHandedness !== false) side.append(handednessToggle(options));
  if (players !== undefined && meta.multiplayer !== undefined) {
    side.append(playersToggle(meta, players));
  }
  if (meta.needsSpace) {
    side.append(h('p', 'note note-space', 'Clear a 2 by 2 metre space around you.'));
  }
  if (meta.seatedOk) side.append(h('p', 'note note-seat', 'You can play this one sitting down.'));
  if (side.childElementCount > 0) cols.append(side);
  body.prepend(cols);
  if (debugInput && meta.debugKeys.length > 0) {
    const keys = h('div', 'debug-keys');
    keys.append(h('p', 'debug-title', 'With the mouse'));
    const list = h('ul');
    for (const k of meta.debugKeys) list.append(h('li', '', k));
    keys.append(list);
    body.append(keys);
  }
  return body;
}

/** "Tutorial done": the choices after a sport's tutorial. */
export function buildTutorialDone(
  meta: SportMeta,
  resolve: (choice: TutorialDoneChoice) => void,
): ScreenSpec {
  const { el, card } = screenShell('tutorialdone', 'card-results card-tutorialdone');
  el.style.setProperty('--accent', hexColor(meta.accent));
  card.append(h('p', 'results-sport', meta.title));
  card.append(h('h1', 'results-headline', 'Tutorial done'));
  card.append(h('p', 'body', 'Nothing was saved. Ready for a real round?'));
  const actions = h('div', 'actions');
  const play = selectButton('Play now', 'btn btn-big');
  const menu = selectButton('Back to menu', 'btn btn-secondary');
  play.addEventListener('click', () => resolve('play'));
  menu.addEventListener('click', () => resolve('menu'));
  actions.append(play, menu);
  card.append(actions);
  return { el, primary: play, cameraInCard: true, onEscape: () => resolve('menu') };
}

export function buildHowTo(
  meta: SportMeta,
  debugInput: boolean,
  resolve: (choice: HowToChoice) => void,
  host: ScreenHost,
  options?: HowToOptions,
  players?: PlayersControl,
): ScreenSpec {
  const { el, card } = screenShell('howto', 'card-howto');
  el.style.setProperty('--accent', hexColor(meta.accent));
  const head = h('div', 'howto-head');
  const swatch = h('span', 'howto-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  head.append(swatch, h('h1', 'heading', meta.title));
  card.append(head);

  card.append(howToBody(meta, debugInput, options, players));

  const actions = h('div', 'actions');
  const start = selectButton('Start', 'btn btn-big');
  const back = selectButton('Back', 'btn btn-secondary');
  start.addEventListener('click', () => resolve('start'));
  back.addEventListener('click', () => resolve('back'));
  actions.append(start);
  // Optional: a sport with a tutorial offers it beside Start. Never opened on its own.
  if (meta.hasTutorial === true) {
    const tutorial = selectButton('Tutorial', 'btn btn-secondary howto-tutorial');
    tutorial.addEventListener('click', () => resolve('tutorial'));
    actions.append(tutorial);
  }
  actions.append(back);
  card.append(actions);
  // Mouse players have no fist to raise.
  if (!debugInput) card.append(h('p', 'fist-hint', 'Raise a fist to start'));

  const stopWatching = host.watchInput((input) => {
    if (!input) return undefined;
    return input.on('ArmRaised', () => resolve('start'));
  });
  return {
    el,
    primary: start,
    cameraInCard: true,
    onEscape: () => resolve('back'),
    dispose: stopWatching,
  };
}
