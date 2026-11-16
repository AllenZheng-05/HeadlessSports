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

  it('limits a name to 12 characters (code points) in the field, so an emoji counts once', () => {
    void ui.showNames(archery, ['a', 'b']);
    const input = root.querySelector<HTMLInputElement>('.name-input') as HTMLInputElement;
    // No maxLength: it counts UTF-16 units and would cut an emoji name at about six.
    expect(input.maxLength).toBe(-1);
    type(input, 'abcdefghijklmnop');
    expect(input.value).toBe('abcdefghijkl');
    type(input, '\u{1F600}'.repeat(20));
    expect(Array.from(input.value)).toHaveLength(12);
    expect(input.value).toBe('\u{1F600}'.repeat(12));
  });

  it('never cuts a joined emoji in the middle when clipping', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    void ui.showNames(archery, ['b', 'c']);
    const input = root.querySelector<HTMLInputElement>('.name-input') as HTMLInputElement;
    type(input, 'a'.repeat(12) + family);
    expect(input.value).toBe('a'.repeat(12));
    type(input, family.repeat(20));
    expect(input.value).toBe(family.repeat(12));
  });

  it('a prefilled name longer than 12 characters is cut the same way', () => {
    void ui.showNames(archery, ['x'.repeat(30), 'b']);
    const input = root.querySelector<HTMLInputElement>('.name-input') as HTMLInputElement;
    expect(input.value).toBe('x'.repeat(12));
  });

  it('shows no dominant-hand choice without options', () => {
    void ui.showNames(archery, ['Mia', 'Sam']);
    expect(root.querySelector('.name-hand')).toBeNull();
    expect(root.querySelector('.card-names.with-hands')).toBeNull();
  });

  it('offers a labelled Left / Right choice per player, starting from the given hands', async () => {
    const hands: ('left' | 'right')[] = ['right', 'left', 'right'];
    const p = ui.showNames(archery, ['Mia', 'Sam', 'Zoe'], { hands });
    const groups = [...root.querySelectorAll<HTMLElement>('.name-hand')];
    expect(groups).toHaveLength(3);
    expect(groups[1]?.getAttribute('role')).toBe('group');
    expect(groups[1]?.getAttribute('aria-label')).toBe('Player 2 dominant hand');
    const on = (g: HTMLElement | undefined): string | null =>
      g?.querySelector('[aria-pressed="true"]')?.getAttribute('data-hand') ?? null;
    expect(groups.map(on)).toEqual(['right', 'left', 'right']);
    // The check mark carries the choice as well as colour.
    expect(groups[1]?.querySelector('[data-hand="left"]')?.textContent).toBe('\u2713 Left');
    // Real buttons: keyboard reachable.
    expect(groups[0]?.querySelector('button')?.tagName).toBe('BUTTON');
    (groups[0]?.querySelector('[data-hand="left"]') as HTMLElement).click();
    expect(hands).toEqual(['left', 'left', 'right']);
    expect(on(groups[0])).toBe('left');
    click('.screen-names .btn-big');
    await expect(p).resolves.toEqual(['Mia', 'Sam', 'Zoe']);
  });

  it('the hand choice is not a name field and does not take Enter or typing away', () => {
    void ui.showNames(archery, ['Mia', 'Sam'], { hands: ['right', 'right'] });
    const inputs = [...root.querySelectorAll<HTMLInputElement>('.name-input')];
    expect(inputs).toHaveLength(2);
    enter(inputs[0] as HTMLElement);
    expect(document.activeElement).toBe(inputs[1]);
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
    expect(labels).toEqual(['Play again', 'Change names', 'Back to menu']);
    click('.actions .btn:nth-child(2)');
    await expect(p).resolves.toBe('change');
    const q = ui.showMultiResults(archery, rows, 'x');
    click('.actions .btn:nth-child(3)');
    await expect(q).resolves.toBe('menu');
  });
});

describe('handover card additions', () => {
  const players = makePlayers(['Mia', 'Sam', 'Zoe'], 3);
  const standings = players.map((player, i) => ({ player, text: `${i} pts` }));

  it('starts without the swap-places line and shows it only when told', () => {
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: true, standings });
    const hint = root.querySelector<HTMLElement>('.handover-swap');
    expect(hint?.textContent).toBe('Swap places, or make a fist on Ready');
    expect(hint?.hidden).toBe(true);
    ui.setHandoverHint(true);
    expect(hint?.hidden).toBe(false);
    ui.setHandoverHint(false);
    expect(hint?.hidden).toBe(true);
    ui.hideHandover();
    expect(() => ui.setHandoverHint(true)).not.toThrow();
  });

  it('reads "Go" once the player is ready: buttons gone, standings kept, Enter ignored', async () => {
    const p = ui.showHandover({ player: players[1]!, mode: 'up', camera: true, standings });
    let settled = false;
    void p.then(() => (settled = true));
    ui.showHandoverGo();
    const el = root.querySelector<HTMLElement>('.handover') as HTMLElement;
    expect(root.querySelector('.handover h1')?.textContent).toBe('Go');
    expect(el.dataset.go).toBe('true');
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(root.querySelectorAll('.handover-row').length).toBe(3);
    // Calling it twice is harmless, and Enter no longer chooses Ready.
    ui.showHandoverGo();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(settled).toBe(false);
    ui.hideHandover();
    expect(root.querySelector('.handover')).toBeNull();
    expect(() => ui.showHandoverGo()).not.toThrow();
  });

  it('a mouse card has no swap-places line at all', () => {
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    expect(root.querySelector('.handover-swap')).toBeNull();
  });

  it('marks the leading seat with a star and a label, not colour alone', () => {
    void ui.showHandover({
      player: players[1]!,
      mode: 'up',
      camera: false,
      standings: standings.map((e, i) => ({ ...e, leading: i === 2 })),
    });
    const rows = [...root.querySelectorAll<HTMLElement>('.handover-row')];
    expect(rows.map((r) => r.classList.contains('leading'))).toEqual([false, false, true]);
    const star = rows[2]?.querySelector('.handover-lead');
    expect(star?.textContent).toBe('\u2605');
    expect(star?.getAttribute('aria-label')).toBe('Leading');
    expect(rows[0]?.querySelector('.handover-lead')).toBeNull();
  });

  it('opening the how-to over the card is refused, whichever way it is asked for', () => {
    const howTo = vi.fn();
    ui.onHowToPlay(howTo);
    ui.showPlaying(archery);
    void ui.showHandover({ player: players[1]!, mode: 'up', camera: false, standings });
    click('.howto-open');
    expect(howTo).not.toHaveBeenCalled();
    expect(root.querySelector('.howto-overlay')).toBeNull();
  });

  it('disambiguates a shared name with the colour name on the title and the rows', () => {
    const twins = makePlayers(['Mia', 'Mia', 'Sam'], 3);
    void ui.showHandover({
      player: twins[1]!,
      label: 'Mia (blue)',
      mode: 'up',
      camera: false,
      standings: twins.map((player) => ({ player, text: '' })),
    });
    expect(root.querySelector('.handover h1')?.textContent).toBe("Mia (blue), you're up");
    const names = [...root.querySelectorAll('.handover-name')].map((n) => n.textContent);
    expect(names).toEqual(['Mia (coral)', 'Mia (blue)', 'Sam']);
  });
});

describe('standings strip leader marker', () => {
  const players = makePlayers(['Mia', 'Sam'], 2);

  it('stars the leading seats, ties included, and keeps seat order', () => {
    ui.showPlaying(archery);
    ui.standings.show(players);
    const chip = (i: number): HTMLElement =>
      root.querySelectorAll<HTMLElement>('.standing')[i] as HTMLElement;
    expect(chip(0).querySelector<HTMLElement>('.standing-lead')?.hidden).toBe(true);
    ui.standings.setLeader(1, true);
    expect(chip(1).querySelector<HTMLElement>('.standing-lead')?.hidden).toBe(false);
    expect(chip(1).classList.contains('leading')).toBe(true);
    ui.standings.setLeader(0, true);
    expect(chip(0).classList.contains('leading')).toBe(true);
    ui.standings.setLeader(1, false);
    expect(chip(1).classList.contains('leading')).toBe(false);
    expect(chip(1).querySelector<HTMLElement>('.standing-lead')?.hidden).toBe(true);
    expect([...root.querySelectorAll('.standing-name')].map((n) => n.textContent)).toEqual([
      'Mia',
      'Sam',
    ]);
    expect(() => ui.standings.setLeader(7, true)).not.toThrow();
  });
});

describe('names are text, never markup', () => {
  const html = '<b>x</b>';
  const players = makePlayers([html, 'Sam'], 2);

  it('renders as plain text in the names field, the chip, the handover card, the results row and the winner line', async () => {
    // Names field.
    void ui.showNames(archery, [html, 'Sam']);
    expect(root.querySelector<HTMLInputElement>('.name-input')?.value).toBe(html);
    expect(root.querySelector('.name-input b')).toBeNull();

    // Standings chip.
    ui.showPlaying(archery);
    ui.standings.show(players);
    expect(root.querySelector('.standing-name')?.textContent).toBe(html);
    expect(root.querySelector('.standing b')).toBeNull();

    // Handover card: title and row.
    void ui.showHandover({
      player: players[0]!,
      label: html,
      mode: 'up',
      camera: false,
      standings: players.map((player) => ({ player, text: '' })),
    });
    expect(root.querySelector('.handover h1')?.textContent).toBe(`${html}, you're up`);
    expect(root.querySelector('.handover-name')?.textContent).toBe(html);
    expect(root.querySelector('.handover b')).toBeNull();
    ui.hideHandover();

    // Results row and winner line.
    const rows = rankResults(
      players,
      [
        { score: 9, headline: '9 pts' },
        { score: 3, headline: '3 pts' },
      ],
      true,
    );
    const winner = winnerLine(rows);
    expect(winner).toBe(`${html} wins`);
    const choice = ui.showMultiResults(archery, rows, winner);
    expect(root.querySelector('.rank-name')?.textContent).toBe(html);
    expect(root.querySelector('.results-headline')?.textContent).toBe(`${html} wins`);
    expect(root.querySelector('.screen-results b')).toBeNull();
    click('.screen-results .btn-big');
    await expect(choice).resolves.toBe('again');
  });

  it('a name with a shared name carries its colour in the winner line and the results rows', () => {
    const twins = makePlayers(['Mia', 'Mia'], 2);
    const rows = rankResults(
      twins,
      [
        { score: 1, headline: '1' },
        { score: 5, headline: '5' },
      ],
      true,
    );
    void ui.showMultiResults(archery, rows, winnerLine(rows));
    expect(root.querySelector('.results-headline')?.textContent).toBe('Mia (blue) wins');
    expect([...root.querySelectorAll('.rank-name')].map((n) => n.textContent)).toEqual([
      'Mia (blue)',
      'Mia (coral)',
    ]);
  });

  it('unranked seats show a dash for the rank and are never marked first', () => {
    const three = makePlayers(['Mia', 'Sam', 'Zoe'], 3);
    const rows = rankResults(
      three,
      [
        { score: 5, headline: '5 pts' },
        { score: 0, headline: '-', unranked: true },
        { score: 0, headline: '-', unranked: true },
      ],
      false,
    );
    void ui.showMultiResults(archery, rows, winnerLine(rows));
    const ranks = [...root.querySelectorAll('.rank-num')].map((n) => n.textContent);
    expect(ranks).toEqual(['1', '\u2013', '\u2013']);
    expect(root.querySelectorAll('.rank-row.first')).toHaveLength(1);
    expect(root.querySelector('.results-headline')?.textContent).toBe('Mia wins');
  });
});
