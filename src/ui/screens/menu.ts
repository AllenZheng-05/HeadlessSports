import type { SportMeta } from '../../core/sport';
import { h, selectButton } from '../dom';
import { formatScore, hexColor } from '../format';
import type { ScreenHost, ScreenSpec } from './shared';
import { screenShell } from './shared';

export function columnsFor(count: number): number {
  if (count <= 5) return Math.max(1, count);
  if (count === 6) return 3;
  return 4;
}

export function buildMenu(
  sports: readonly SportMeta[],
  bests: ReadonlyMap<string, number>,
  resolve: (id: string) => void,
): ScreenSpec {
  const { el, card } = screenShell('menu', 'card-menu');
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
  return { el, primary: first };
}

export function buildHowTo(
  meta: SportMeta,
  debugInput: boolean,
  resolve: (choice: 'start' | 'back') => void,
  host: ScreenHost,
): ScreenSpec {
  const { el, card } = screenShell('howto', 'card-howto');
  el.style.setProperty('--accent', hexColor(meta.accent));
  const head = h('div', 'howto-head');
  const swatch = h('span', 'howto-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  head.append(swatch, h('h1', 'heading', meta.title));
  card.append(head);

  const cols = h('div', 'howto-cols');
  const steps = h('ol', 'steps');
  for (const line of meta.howTo) steps.append(h('li', '', line));
  cols.append(steps);

  const side = h('div', 'howto-side');
  if (meta.needsSpace) {
    side.append(h('p', 'note note-space', 'Clear a 2 by 2 metre space around you.'));
  }
  if (meta.seatedOk) side.append(h('p', 'note note-seat', 'You can play this one sitting down.'));
  if (debugInput && meta.debugKeys.length > 0) {
    const keys = h('div', 'debug-keys');
    keys.append(h('p', 'debug-title', 'Keyboard and mouse'));
    const list = h('ul');
    for (const k of meta.debugKeys) list.append(h('li', '', k));
    keys.append(list);
    side.append(keys);
  }
  if (side.childElementCount > 0) cols.append(side);
  card.append(cols);

  const actions = h('div', 'actions');
  const start = selectButton('Start', 'btn btn-big');
  const back = selectButton('Back', 'btn btn-secondary');
  start.addEventListener('click', () => resolve('start'));
  back.addEventListener('click', () => resolve('back'));
  actions.append(start, back);
  card.append(actions, h('p', 'fist-hint', 'Raise a fist to start'));

  const stopWatching = host.watchInput((input) => {
    if (!input) return undefined;
    return input.on('ArmRaised', () => resolve('start'));
  });
  return {
    el,
    primary: start,
    onEscape: () => resolve('back'),
    dispose: stopWatching,
  };
}
