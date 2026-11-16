// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlayers } from '../core/multiplayer/players';
import { rankResults, winnerLine } from '../core/multiplayer/ranking';
import type { RoundResult, SportMeta } from '../core/sport';
import { createUi } from './createUi';
import { FAKE_SPORTS } from './harness/fakeData';
import type { Ui } from './types';

let root: HTMLElement;
let ui: Ui;

const archery: SportMeta = {
  ...FAKE_SPORTS[3]!,
  multiplayer: { turnLabel: 'arrow', maxPlayers: 4 },
};
const bowling = FAKE_SPORTS[1]!;

function click(selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.click();
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enter(el: HTMLElement): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  root = document.createElement('div');
  document.body.append(root);
  ui = createUi(root, { reducedMotion: true });
});

afterEach(() => {
  ui.dispose();
  root.remove();
});

describe('Players control on the how-to card', () => {
  it('shows only for sports with meta.multiplayer, and only with a control', () => {
    void ui.showHowTo(archery, true, undefined, { count: 1, onCount: () => undefined });
    expect(root.querySelector('.players-toggle')).not.toBeNull();
    expect(root.querySelectorAll('.players-opt').length).toBe(4);
    void ui.showHowTo(bowling, true, undefined, { count: 1, onCount: () => undefined });
    expect(root.querySelector('.players-toggle')).toBeNull();
    void ui.showHowTo(archery, true);
    expect(root.querySelector('.players-toggle')).toBeNull();
  });

  it('offers only as many seats as the sport allows', () => {
    const three: SportMeta = { ...archery, multiplayer: { turnLabel: 'frame', maxPlayers: 3 } };
    void ui.showHowTo(three, true, undefined, { count: 1, onCount: () => undefined });
    expect(root.querySelectorAll('.players-opt').length).toBe(3);
  });

  it('starts at 1, reports the choice and marks it with a check as well as colour', () => {
    const onCount = vi.fn();
    void ui.showHowTo(archery, true, undefined, { count: 1, onCount });
    const opts = [...root.querySelectorAll<HTMLElement>('.players-opt')];
    expect(opts[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(opts[0]?.textContent).toBe('✓ 1');
    opts[2]?.click();
    expect(onCount).toHaveBeenCalledWith(3);
    expect(opts[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(opts[2]?.textContent).toBe('✓ 3');
    expect(opts[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(opts[0]?.textContent).toBe('1');
  });

  it('is not in the in-round how-to overlay and does not change Start', async () => {
    const p = ui.showHowTo(archery, true, undefined, { count: 2, onCount: () => undefined });
    click('.screen-howto .btn-big');
    await expect(p).resolves.toBe('start');
  });
});

describe('names screen', () => {
  it('has one labelled field per player, in each player colour, prefilled', () => {
    void ui.showNames(archery, ['Mia', 'Player 2', 'Player 3']);
    const inputs = [...root.querySelectorAll<HTMLInputElement>('.name-input')];
    expect(inputs.map((i) => i.value)).toEqual(['Mia', 'Player 2', 'Player 3']);
    const rows = [...root.querySelectorAll<HTMLElement>('.name-row')];
    const colours = rows.map((r) => r.style.getPropertyValue('--seat'));
    expect(new Set(colours).size).toBe(3);
    expect(root.querySelector('.name-colour')?.textContent).toBe('Coral');
    expect(inputs[1]?.getAttribute('aria-label')).toContain('Player 2');
  });

  it('limits a name to 12 characters in the field', () => {
    void ui.showNames(archery, ['a', 'b']);
    const input = root.querySelector<HTMLInputElement>('.name-input');
    expect(input?.maxLength).toBe(12);
  });

  it('Enter moves to the next field and starts from the last', async () => {
    const p = ui.showNames(archery, ['Mia', 'Sam', 'Zoe']);
    const inputs = [...root.querySelectorAll<HTMLInputElement>('.name-input')];
    enter(inputs[0] as HTMLElement);
    expect(document.activeElement).toBe(inputs[1]);
    enter(inputs[1] as HTMLElement);
    expect(document.activeElement).toBe(inputs[2]);
    type(inputs[2] as HTMLInputElement, 'Zed');
    enter(inputs[2] as HTMLElement);
    await expect(p).resolves.toEqual(['Mia', 'Sam', 'Zed']);
  });

  it('Start button and Back button resolve, and Escape in a field is Back', async () => {
    const p = ui.showNames(archery, ['Mia', 'Sam']);
    click('.screen-names .btn-big');
    await expect(p).resolves.toEqual(['Mia', 'Sam']);
    const q = ui.showNames(archery, ['Mia', 'Sam']);
    click('.screen-names .btn-secondary');
    await expect(q).resolves.toBeNull();
    const r = ui.showNames(archery, ['Mia', 'Sam']);
    const first = root.querySelector<HTMLElement>('.name-input') as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(r).resolves.toBeNull();
  });

  it('typing is never swallowed by the screen key handling', () => {
    void ui.showNames(archery, ['Mia', 'Sam']);
    const input = root.querySelector<HTMLInputElement>('.name-input') as HTMLInputElement;
    input.focus();
    const ev = new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Start and Back are buttons the hand cursor can press, the fields are not', () => {
    void ui.showNames(archery, ['Mia', 'Sam']);
    expect(root.querySelectorAll('.screen-names [data-select]').length).toBe(2);
    expect(root.querySelector('.name-input[data-select]')).toBeNull();
  });
});

describe('handover card', () => {
  const players = makePlayers(['Mia', 'Sam', 'Zoe'], 3);
  const standings = players.map((player, i) => ({ player, text: `${i * 3} pts` }));

  it('says whose turn it is, shows the standings and resolves ready on the button', async () => {
    const p = ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    expect(root.querySelector('.handover h1')?.textContent).toBe("Sam, you're up");
    expect(root.querySelectorAll('.handover-row').length).toBe(3);
    expect(root.querySelector('.handover-row.current .handover-name')?.textContent).toBe('Sam');
    expect(root.textContent).toContain('6 pts');
    expect(root.textContent).toContain('Click Ready');
    click('.handover-ready');
    await expect(p).resolves.toBe('ready');
  });

  it('is washed in the incoming player colour', () => {
    void ui.showHandover({ player: players[2]!, mode: 'up', camera: false, standings });
    const el = root.querySelector<HTMLElement>('.handover') as HTMLElement;
    expect(el.style.getPropertyValue('--seat')).toBe('#f6d55c');
  });

  it('Enter is Ready and Escape quits the round like it does today', async () => {
    const quit = vi.fn();
    ui.onQuit(quit);
    ui.showPlaying(archery);
    const p = ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(p).resolves.toBe('ready');
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(quit).toHaveBeenCalledOnce();
  });

  it('H does not open the how-to over a handover', () => {
    const howTo = vi.fn();
    ui.onHowToPlay(howTo);
    ui.showPlaying(archery);
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(howTo).not.toHaveBeenCalled();
  });

  it('camera mode mentions the fist and the step-in card offers Back (Escape cancels)', async () => {
    const p = ui.showHandover({
      player: players[0]!,
      mode: 'step-in',
      camera: true,
      standings: [],
    });
    expect(root.querySelector('.handover h1')?.textContent).toBe('Mia, step in');
    expect(root.querySelector('.fist-hint')?.textContent).toContain('fist');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p).resolves.toBe('cancel');
  });

  it('hideHandover removes it, and a new screen does too', () => {
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    expect(root.querySelector('.handover')).not.toBeNull();
    ui.hideHandover();
    expect(root.querySelector('.handover')).toBeNull();
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    void ui.showTitle();
    expect(root.querySelector('.handover')).toBeNull();
  });
});

describe('standings strip', () => {
  const players = makePlayers(['Mia', 'Sam'], 2);

  it('shows a chip per player, updates text and marks the current seat', () => {
    ui.showPlaying(archery);
    ui.standings.show(players);
    const chips = [...root.querySelectorAll<HTMLElement>('.standing')];
    expect(chips.length).toBe(2);
    expect(chips[0]?.querySelector('.standing-name')?.textContent).toBe('Mia');
    ui.standings.set(1, '12 pts');
    expect(chips[1]?.querySelector('.standing-score')?.textContent).toBe('12 pts');
    ui.standings.setCurrent(1);
    expect(chips[1]?.classList.contains('current')).toBe(true);
    ui.standings.setCurrent(0);
    expect(chips[1]?.classList.contains('current')).toBe(false);
    expect(chips[0]?.classList.contains('current')).toBe(true);
    expect(chips[0]?.style.getPropertyValue('--seat')).not.toBe(
      chips[1]?.style.getPropertyValue('--seat'),
    );
  });

  it('is hidden by default and goes away when the HUD is cleared', () => {
    ui.showPlaying(archery);
    expect(root.querySelector<HTMLElement>('.standings')?.hidden).toBe(true);
    ui.standings.show(players);
    expect(root.querySelector<HTMLElement>('.standings')?.hidden).toBe(false);
    ui.hud.clear();
    expect(root.querySelector<HTMLElement>('.standings')?.hidden).toBe(true);
    expect(root.querySelectorAll('.standing').length).toBe(0);
  });
});

describe('multiplayer results table', () => {
  const players = makePlayers(['Mia', 'Sam', 'Zoe'], 3);
  const results: RoundResult[] = [
    { score: 30, headline: '30 pts', lines: ['Rings: 10, 10, 10'] },
    { score: 30, headline: '30 pts', lines: ['Rings: 9, 9, 9, 3'] },
    { score: 12, headline: '12 pts' },
  ];

  it('lists ranked rows, ties share a rank, and names the winner or the tie', async () => {
    const rows = rankResults(players, results, true);
    const p = ui.showMultiResults(archery, rows, winnerLine(rows));
    expect(root.querySelector('.results-headline')?.textContent).toBe("It's a tie");
    const ranks = [...root.querySelectorAll('.rank-num')].map((n) => n.textContent);
    expect(ranks).toEqual(['1', '1', '3']);
    const names = [...root.querySelectorAll('.rank-name')].map((n) => n.textContent);
    expect(names).toEqual(['Mia', 'Sam', 'Zoe']);
    expect(root.querySelector('.rank-detail')?.textContent).toBe('Rings: 10, 10, 10');
    expect(root.textContent).not.toContain('New best');
    expect(root.textContent).not.toContain('Personal best');
    click('.screen-results .btn-big');
    await expect(p).resolves.toBe('again');
  });

  it('shows "<name> wins" for a single leader and offers the three choices', async () => {
    const rows = rankResults(
      players,
      [results[2]!, results[0]!, { score: 20, headline: '20 pts' }],
      true,
    );
    const p = ui.showMultiResults(archery, rows, winnerLine(rows));
    expect(root.querySelector('.results-headline')?.textContent).toBe('Sam wins');
    const labels = [...root.querySelectorAll('.actions .btn')].map((b) => b.textContent);
    expect(labels).toEqual(['Play again', 'Change players', 'Back to menu']);
    click('.actions .btn:nth-child(2)');
    await expect(p).resolves.toBe('change');
    const q = ui.showMultiResults(archery, rows, 'x');
    click('.actions .btn:nth-child(3)');
    await expect(q).resolves.toBe('menu');
  });
});
