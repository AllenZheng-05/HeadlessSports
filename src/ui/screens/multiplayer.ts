import {
  NAME_MAX,
  PLAYER_COLORS,
  PLAYER_COLOR_NAMES,
  clipGraphemes,
  displayNames,
} from '../../core/multiplayer/players';
import type { RankedRow } from '../../core/multiplayer/ranking';
import type { SportMeta } from '../../core/sport';
import type { Side } from '../../input/types';
import { h, selectButton } from '../dom';
import { hexColor } from '../format';
import type { HandoverInfo, NamesOptions } from '../types';
import type { ScreenSpec } from './shared';
import { screenShell } from './shared';

/** A round colour chip carrying the seat's colour, outlined in ink. */
function chip(color: number, className = 'seat-chip'): HTMLElement {
  const c = h('span', className);
  c.style.setProperty('--seat', hexColor(color));
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** "Left / Right" for one seat, with a check mark as well as colour. Writes into `hands[seat]`. */
function handChoice(seat: number, options: NamesOptions): HTMLElement {
  const wrap = h('div', 'name-hand');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', `Player ${seat + 1} dominant hand`);
  const buttons = new Map<Side, HTMLButtonElement>();
  const refresh = (): void => {
    const current = options.hands[seat] ?? 'right';
    for (const [side, b] of buttons) {
      const on = side === current;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
      b.textContent = `${on ? '✓ ' : ''}${side === 'right' ? 'Right' : 'Left'}`;
    }
  };
  for (const side of ['left', 'right'] as const) {
    const b = selectButton('', 'btn btn-small btn-secondary hand-opt name-hand-opt');
    b.dataset.hand = side;
    b.addEventListener('click', () => {
      options.hands[seat] = side;
      refresh();
    });
    buttons.set(side, b);
    wrap.append(b);
  }
  refresh();
  return wrap;
}

/**
 * The names screen: a text field per player, each marked with the seat colour and its name. Enter
 * moves to the next field and starts from the last. Keyboard and mouse only: the hand cursor can
 * press Start and Back but cannot type. With `options` (mouse play, sports that care about the
 * dominant hand) each row also has a Left / Right choice.
 */
export function buildNames(
  meta: SportMeta,
  prefill: readonly string[],
  resolve: (names: string[] | null) => void,
  options?: NamesOptions,
): ScreenSpec {
  const { el, card } = screenShell('names', options ? 'card-names with-hands' : 'card-names');
  el.style.setProperty('--accent', hexColor(meta.accent));
  card.append(h('h1', 'heading', 'Who is playing?'));
  card.append(
    h(
      'p',
      'body body-soft names-sub',
      options
        ? `Type a name for each player, up to ${NAME_MAX} characters, and pick their dominant hand.`
        : `Type a name for each player, up to ${NAME_MAX} characters.`,
    ),
  );
  const list = h('div', 'names-list');
  const inputs: HTMLInputElement[] = [];
  const start = selectButton('Start', 'btn btn-big');
  const back = selectButton('Back', 'btn btn-secondary');
  const finish = (): void => resolve(inputs.map((i) => i.value));

  prefill.forEach((value, i) => {
    const color = PLAYER_COLORS[i] ?? PLAYER_COLORS[0]!;
    const colorName = PLAYER_COLOR_NAMES[i] ?? '';
    const row = h('label', 'name-row');
    row.style.setProperty('--seat', hexColor(color));
    const label = h('span', 'name-label');
    label.append(chip(color), h('span', 'name-colour', colorName));
    const input = h('input', 'name-input');
    input.type = 'text';
    input.value = value;
    // No maxLength: it counts UTF-16 units, so an emoji name would stop at about six. Clip by
    // code points instead, the same count the shell applies.
    input.value = clipGraphemes(value, NAME_MAX);
    input.addEventListener('input', () => {
      const clipped = clipGraphemes(input.value, NAME_MAX);
      if (clipped !== input.value) input.value = clipped;
    });
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.seat = String(i);
    input.setAttribute('aria-label', `Player ${i + 1} name, ${colorName}`);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = inputs[i + 1];
        if (next !== undefined) next.focus();
        else finish();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        resolve(null);
      }
    });
    row.append(label, input);
    if (options) row.append(handChoice(i, options));
    list.append(row);
    inputs.push(input);
  });
  card.append(list);

  const actions = h('div', 'actions');
  start.addEventListener('click', finish);
  back.addEventListener('click', () => resolve(null));
  actions.append(start, back);
  card.append(actions);
  return {
    el,
    primary: inputs[0] ?? start,
    onEscape: () => resolve(null),
  };
}

/** What the handover card hands the screen manager. */
export interface HandoverCard {
  readonly el: HTMLElement;
  readonly ready: HTMLElement;
  /** Every button the hand cursor may press: Ready, and Back in 'step-in' mode. */
  readonly buttons: HTMLElement[];
  readonly back: HTMLElement | null;
  /** "Swap places, or make a fist on Ready": hidden until the shell says the camera is stuck. */
  readonly hint: HTMLElement | null;
  /** The big "<name>, you're up" line; "Go" replaces it once the player is ready. */
  readonly heading: HTMLElement;
}

/** The full-screen "<name>, you're up" card with the standings. */
export function buildHandoverCard(
  info: HandoverInfo,
  onReady: () => void,
  onBack: () => void,
): HandoverCard {
  const el = h('div', 'handover');
  el.setAttribute('data-ui', '');
  el.setAttribute('role', 'dialog');
  el.dataset.mode = info.mode;
  el.style.setProperty('--seat', hexColor(info.player.color));
  const name = info.label ?? info.player.name;
  const title = info.mode === 'up' ? `${name}, you're up` : `${name}, step in`;
  el.setAttribute('aria-label', title);
  const card = h('div', 'card card-handover');
  const head = h('div', 'handover-head');
  const heading = h('h1', 'heading', title);
  head.append(chip(info.player.color, 'seat-chip seat-chip-big'), heading);
  card.append(head);
  card.append(
    h(
      'p',
      'body handover-sub',
      info.camera ? 'Stand where the camera can see you.' : "Click Ready when you're set.",
    ),
  );
  if (info.standings.length > 0) {
    const list = h('ul', 'handover-standings');
    const names = displayNames(info.standings.map((e) => e.player));
    for (const [i, entry] of info.standings.entries()) {
      const li = h('li', 'handover-row');
      li.style.setProperty('--seat', hexColor(entry.player.color));
      if (entry.player.index === info.player.index) li.classList.add('current');
      li.append(chip(entry.player.color), h('span', 'handover-name', names[i] as string));
      if (entry.leading === true) {
        li.classList.add('leading');
        const star = h('span', 'handover-lead', '★');
        star.setAttribute('role', 'img');
        star.setAttribute('aria-label', 'Leading');
        li.append(star);
      }
      li.append(h('span', 'handover-score', entry.text));
      list.append(li);
    }
    card.append(list);
  }
  const actions = h('div', 'actions');
  const ready = selectButton('Ready', 'btn btn-big handover-ready');
  ready.addEventListener('click', onReady);
  actions.append(ready);
  const buttons: HTMLElement[] = [ready];
  let back: HTMLElement | null = null;
  if (info.mode === 'step-in') {
    back = selectButton('Back', 'btn btn-secondary handover-back');
    back.addEventListener('click', onBack);
    actions.append(back);
    buttons.push(back);
  }
  card.append(actions);
  let hint: HTMLElement | null = null;
  if (info.camera) {
    card.append(h('p', 'fist-hint', 'Step in, hold still for a moment, or make a fist on Ready'));
    hint = h('p', 'body handover-swap', 'Swap places, or make a fist on Ready');
    hint.setAttribute('role', 'status');
    hint.hidden = true;
    card.append(hint);
  }
  el.append(card);
  return { el, ready, buttons, back, hint, heading };
}

/** The ranked table at the end of a pass-and-play game. Ties share a rank. */
export function buildMultiResults(
  meta: SportMeta,
  rows: readonly RankedRow[],
  winner: string,
  resolve: (choice: 'again' | 'change' | 'menu') => void,
): ScreenSpec {
  const { el, card } = screenShell('results', 'card-results card-multi-results');
  card.append(h('p', 'results-sport', meta.title));
  card.append(h('h1', 'results-headline', winner));
  const table = h('table', 'rank-table');
  const body = h('tbody');
  const names = displayNames(rows.map((r) => r.player));
  for (const [i, row] of rows.entries()) {
    const unranked = row.unranked === true;
    const tr = h('tr', row.rank === 1 && !unranked ? 'rank-row first' : 'rank-row');
    tr.dataset.seat = String(row.player.index);
    tr.style.setProperty('--seat', hexColor(row.player.color));
    const rank = h('td', 'rank-num', unranked ? '–' : String(row.rank));
    if (unranked) rank.setAttribute('aria-label', 'No result');
    const who = h('td', 'rank-who');
    who.append(chip(row.player.color), h('span', 'rank-name', names[i] as string));
    const score = h('td', 'rank-score', row.result.headline);
    const detail = h('td', 'rank-detail', row.result.lines?.[0] ?? '');
    tr.append(rank, who, score, detail);
    body.append(tr);
  }
  table.append(body);
  card.append(table);
  const actions = h('div', 'actions');
  const again = selectButton('Play again', 'btn btn-big');
  const change = selectButton('Change names', 'btn btn-secondary');
  const menu = selectButton('Back to menu', 'btn btn-secondary');
  again.addEventListener('click', () => resolve('again'));
  change.addEventListener('click', () => resolve('change'));
  menu.addEventListener('click', () => resolve('menu'));
  actions.append(again, change, menu);
  card.append(actions);
  return { el, primary: again, cameraInCard: true, onEscape: () => resolve('menu') };
}
