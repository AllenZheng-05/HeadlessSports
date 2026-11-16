// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInputState } from '../../input/state';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { RoundResult } from '../sport';
import {
  MAX_PLAYERS,
  NAME_MAX,
  PLAYER_COLORS,
  clampPlayers,
  clipGraphemes,
  defaultName,
  displayNames,
  loadLastHands,
  loadLastNames,
  makePlayers,
  parseHands,
  parseNames,
  prefillHands,
  prefillNames,
  sanitiseName,
  saveLastHands,
  saveLastNames,
} from './players';
import { rankResults, singleResultFallback, winnerLine } from './ranking';
import {
  HandoverReadiness,
  createPresenceSample,
  handoverConfig,
  samplePresence,
} from './readiness';
import type { PresenceSample } from './readiness';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('names', () => {
  it('trims, caps at 12 characters and falls back to the default when empty', () => {
    expect(sanitiseName('  Mia  ', 'Player 1')).toBe('Mia');
    expect(sanitiseName('   ', 'Player 2')).toBe('Player 2');
    expect(sanitiseName('', 'Player 3')).toBe('Player 3');
    expect(sanitiseName('Bartholomew Jones', 'x')).toBe('Bartholomew');
    expect(Array.from(sanitiseName('abcdefghijklmnop', 'x')).length).toBe(NAME_MAX);
    // Counts characters, not UTF-16 units: an emoji is one.
    expect(sanitiseName('😀'.repeat(20), 'x')).toBe('😀'.repeat(NAME_MAX));
    expect(sanitiseName('a\u0000b\tc', 'x')).toBe('abc');
  });

  it('clips by grapheme cluster: a joined emoji is kept whole or dropped, never cut', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(sanitiseName('a'.repeat(11) + family, 'x')).toBe('a'.repeat(11) + family);
    // The 13th cluster does not fit; the family is dropped as a whole, not cut at a joiner.
    expect(sanitiseName('a'.repeat(12) + family, 'x')).toBe('a'.repeat(12));
    expect(sanitiseName(family.repeat(20), 'x')).toBe(family.repeat(NAME_MAX));
    // 12 plain characters are untouched.
    expect(sanitiseName('abcdefghijkl', 'x')).toBe('abcdefghijkl');
    expect(clipGraphemes('abcdefghijklm', 12)).toBe('abcdefghijkl');
  });

  it('strips bidi and other control characters, and counts code points not UTF-16 units', () => {
    expect(sanitiseName('a\u202Eb\u202Ac\u2066d\u2069e\u200Ef\u200Fg', 'x')).toBe('abcdefg');
    expect(sanitiseName('\u202E\u202D', 'Player 1')).toBe('Player 1');
    expect(sanitiseName('a\u0085b\u009Fc\u007Fd', 'x')).toBe('abcd');
    // 12 emoji survive whole; a 13th is cut, never half of one.
    expect(Array.from(sanitiseName('\u{1F600}'.repeat(13), 'x'))).toHaveLength(NAME_MAX);
  });

  it('disambiguates shared names with the colour name, and leaves unique ones alone', () => {
    const same = makePlayers(['Mia', 'mia', 'Sam'], 3);
    expect(displayNames(same)).toEqual(['Mia (coral)', 'mia (blue)', 'Sam']);
    expect(displayNames(makePlayers(['Mia', 'Sam'], 2))).toEqual(['Mia', 'Sam']);
  });

  it('remembers each seat hand, falls back to the default, and parses ?hands=', () => {
    expect(prefillHands(3, 'left')).toEqual(['left', 'left', 'left']);
    saveLastHands(['right', null, 'left']);
    expect(loadLastHands()).toEqual(['right', null, 'left', null]);
    expect(prefillHands(3, 'left')).toEqual(['right', 'left', 'left']);
    localStorage.setItem('hs-player-hands', '{"a":1}');
    expect(loadLastHands()).toEqual([null, null, null, null]);
    expect(parseHands(null)).toBeNull();
    expect(parseHands('r,Left,x')).toEqual(['right', 'left', null]);
  });

  it('builds the seats: defaults for missing names, duplicates allowed, a colour each', () => {
    const players = makePlayers(['Mia', '', 'Mia'], 3);
    expect(players.map((p) => p.name)).toEqual(['Mia', defaultName(1), 'Mia']);
    expect(players.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(new Set(players.map((p) => p.color)).size).toBe(3);
    expect(makePlayers([], 9)).toHaveLength(MAX_PLAYERS);
    expect(makePlayers([], 0)).toHaveLength(1);
  });

  it('clamps the player count', () => {
    expect(clampPlayers(NaN)).toBe(1);
    expect(clampPlayers(7)).toBe(4);
    expect(clampPlayers(7, 3)).toBe(3);
    expect(clampPlayers(2.9)).toBe(2);
  });

  it('has four colours that stay clearly apart', () => {
    expect(PLAYER_COLORS).toHaveLength(MAX_PLAYERS);
    const rgb = (c: number): number[] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      for (let j = i + 1; j < PLAYER_COLORS.length; j++) {
        const a = rgb(PLAYER_COLORS[i] as number);
        const b = rgb(PLAYER_COLORS[j] as number);
        const d = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
        expect(d, `colours ${i} and ${j}`).toBeGreaterThan(70);
      }
    }
  });

  it('remembers the last names on this device and prefills from them', () => {
    expect(prefillNames(3)).toEqual(['Player 1', 'Player 2', 'Player 3']);
    saveLastNames(['Mia', 'Sam', '', 'Zoe']);
    expect(prefillNames(3)).toEqual(['Mia', 'Sam', 'Player 3']);
    expect(loadLastNames()).toEqual(['Mia', 'Sam', '', 'Zoe']);
  });

  it('works when storage is missing, blocked or corrupt', () => {
    localStorage.setItem('hs-player-names', '{not json');
    expect(loadLastNames()).toEqual(['', '', '', '']);
    localStorage.setItem('hs-player-names', JSON.stringify({ a: 1 }));
    expect(loadLastNames()).toEqual(['', '', '', '']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(prefillNames(2)).toEqual(['Player 1', 'Player 2']);
    expect(() => saveLastNames(['a'])).not.toThrow();
  });

  it('parses ?names=', () => {
    expect(parseNames(null)).toBeNull();
    expect(parseNames('')).toBeNull();
    expect(parseNames('Mia,Sam')).toEqual(['Mia', 'Sam']);
  });
});

describe('ranking', () => {
  const players = makePlayers(['A', 'B', 'C', 'D'], 4);
  const r = (score: number): RoundResult => ({ score, headline: String(score) });

  it('ranks higher-is-better, best first', () => {
    const rows = rankResults(players, [r(10), r(30), r(20), r(5)], true);
    expect(rows.map((x) => x.player.name)).toEqual(['B', 'C', 'A', 'D']);
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(winnerLine(rows)).toBe('B wins');
  });

  it('ranks lower-is-better, best first', () => {
    const rows = rankResults(players, [r(10), r(30), r(20), r(5)], false);
    expect(rows.map((x) => x.player.name)).toEqual(['D', 'A', 'C', 'B']);
    expect(winnerLine(rows)).toBe('D wins');
  });

  it('ties share a rank, the next rank skips, and seat order breaks the display order', () => {
    const rows = rankResults(players, [r(20), r(30), r(20), r(30)], true);
    expect(rows.map((x) => [x.player.name, x.rank])).toEqual([
      ['B', 1],
      ['D', 1],
      ['A', 3],
      ['C', 3],
    ]);
    expect(winnerLine(rows)).toBe("It's a tie");
  });

  it('a tie below first place still has a single winner', () => {
    const rows = rankResults(players.slice(0, 3), [r(1), r(9), r(1)], true);
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 2]);
    expect(winnerLine(rows)).toBe('B wins');
  });

  it('everyone tied is a tie, and a single result is a plain win', () => {
    expect(winnerLine(rankResults(players, [r(1), r(1), r(1), r(1)], true))).toBe("It's a tie");
    expect(winnerLine(rankResults(players.slice(0, 1), [r(1)], true))).toBe('A wins');
  });

  it('does not change its inputs', () => {
    const results = [r(1), r(2)];
    rankResults(players.slice(0, 2), results, true);
    expect(results.map((x) => x.score)).toEqual([1, 2]);
  });

  it('the stray-finish fallback keeps the one real result in its seat, the rest unranked', () => {
    const real = r(12);
    const out = singleResultFallback(3, 1, real);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(real);
    expect(out[0]?.headline).toBe('-');
    expect(out[0]?.unranked).toBe(true);
    expect(out[2]?.unranked).toBe(true);
  });

  it('breaks equal scores with the larger tieBreak, whatever higherIsBetter says', () => {
    const t = (score: number, tieBreak?: number): RoundResult => ({
      score,
      headline: String(score),
      tieBreak,
    });
    for (const higher of [true, false]) {
      const rows = rankResults(players.slice(0, 3), [t(5, 1), t(5, 9), t(5, 4)], higher);
      expect(rows.map((x) => [x.player.name, x.rank])).toEqual([
        ['B', 1],
        ['C', 2],
        ['A', 3],
      ]);
      expect(winnerLine(rows)).toBe('B wins');
    }
    // The score still comes first.
    const rows = rankResults(players.slice(0, 2), [t(6, 0), t(5, 99)], true);
    expect(rows.map((x) => x.player.name)).toEqual(['A', 'B']);
  });

  it('equal or absent tie-breaks share a rank; a present one beats an absent one', () => {
    const t = (score: number, tieBreak?: number): RoundResult => ({
      score,
      headline: String(score),
      tieBreak,
    });
    const same = rankResults(players.slice(0, 3), [t(5, 2), t(5, 2), t(5)], true);
    expect(same.map((x) => [x.player.name, x.rank])).toEqual([
      ['A', 1],
      ['B', 1],
      ['C', 3],
    ]);
    const none = rankResults(players.slice(0, 2), [t(5), t(5)], true);
    expect(none.map((x) => x.rank)).toEqual([1, 1]);
    expect(winnerLine(none)).toBe("It's a tie");
  });

  it('unranked seats are listed last with no rank and never win, even when lower is better', () => {
    const real = (score: number): RoundResult => ({ score, headline: String(score) });
    // Seat 0 is the stray-finish seat; seats 1 and 2 are blank (score 0 would beat 40 here).
    const results = singleResultFallback(3, 0, real(40));
    const rows = rankResults(players.slice(0, 3), results, false);
    expect(rows.map((x) => [x.player.name, x.rank, x.unranked === true])).toEqual([
      ['A', 1, false],
      ['B', 0, true],
      ['C', 0, true],
    ]);
    expect(winnerLine(rows)).toBe('A wins');
    // Nobody ranked at all.
    const none = rankResults(players.slice(0, 2), singleResultFallback(2, 5, real(1)), false);
    expect(winnerLine(none)).toBe('No winner');
  });

  it('fills the seats a short results array leaves out as unranked', () => {
    const rows = rankResults(players.slice(0, 3), [r(3)], true);
    expect(rows).toHaveLength(3);
    expect(rows.map((x) => x.player.name)).toEqual(['A', 'B', 'C']);
    expect(rows.slice(1).every((x) => x.unranked === true && x.rank === 0)).toBe(true);
    expect(winnerLine(rows)).toBe('A wins');
  });

  it('names a shared name by its colour in the winner line', () => {
    const twins = makePlayers(['Mia', 'Mia', 'Sam'], 3);
    const rows = rankResults(twins, [r(1), r(9), r(2)], true);
    expect(winnerLine(rows)).toBe('Mia (blue) wins');
  });
});

describe('handover readiness', () => {
  const sample = (over: Partial<PresenceSample> = {}): PresenceSample => ({
    present: true,
    x: 0.5,
    y: 0.4,
    sw: 0.18,
    aspect: 16 / 9,
    ...over,
  });
  const cfg = handoverConfig;

  /** Run the rule over a timeline of (time, sample) pairs; the time it first says ready, or -1. */
  function readyAt(
    readiness: HandoverReadiness,
    timeline: (t: number) => PresenceSample,
    until = 10000,
  ): number {
    for (let t = 0; t <= until; t += 33) {
      if (readiness.update(1000 + t, timeline(t))) return t;
    }
    return -1;
  }

  it('never fires before the card has been up for the minimum time', () => {
    const rd = new HandoverReadiness({ requireChange: false });
    const at = readyAt(rd, () => sample());
    expect(at).toBeGreaterThanOrEqual(cfg.minShowMs);
    expect(at).toBeLessThan(cfg.minShowMs + 200);
  });

  it('the first player (no change needed) is ready once in frame and still', () => {
    const rd = new HandoverReadiness({ requireChange: false });
    // Not in frame for 3 s, then steps in and holds still.
    const at = readyAt(rd, (t) => (t < 3000 ? sample({ present: false }) : sample()));
    expect(at).toBeGreaterThanOrEqual(3000 + cfg.stillMs);
    expect(at).toBeLessThan(3000 + cfg.stillMs + 200);
  });

  it('the previous player shuffling sideways then standing still never advances the card', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    // A shuffles 1.5 shoulder widths across (a big move, and a size change), then stops.
    const at = readyAt(
      rd,
      (t) => (t < 2500 ? sample() : sample({ x: 0.5 + (1.5 * 0.18) / (16 / 9), sw: 0.26 })),
      30000,
    );
    expect(at).toBe(-1);
  });

  it('A leaves, B enters and stands still: advances once the frame has been empty long enough', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    const gone = 1200 + cfg.emptyMs + 100;
    const at = readyAt(rd, (t) =>
      t >= 1200 && t < gone ? sample({ present: false }) : sample({ x: 0.3 }),
    );
    expect(at).toBeGreaterThanOrEqual(gone + cfg.stillMs);
    expect(at).toBeLessThan(gone + cfg.stillMs + 200);
  });

  it('a 300 ms tracking flicker with the same person still there never advances', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    expect(cfg.emptyMs).toBeGreaterThan(300);
    const at = readyAt(
      rd,
      (t) => (t >= 3000 && t < 3300 ? sample({ present: false }) : sample()),
      30000,
    );
    expect(at).toBe(-1);
  });

  it('someone who keeps moving about after the swap is never still, so never ready', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    const at = readyAt(
      rd,
      (t) =>
        t >= 500 && t < 500 + cfg.emptyMs + 50
          ? sample({ present: false })
          : sample({ x: 0.5 + 0.2 * Math.sin(t / 150) }),
      15000,
    );
    expect(at).toBe(-1);
  });

  it('the hint is due after hintAfterMs while the frame never emptied, and not once it did', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    rd.update(0, sample());
    expect(rd.hintDue(cfg.hintAfterMs - 100)).toBe(false);
    expect(rd.hintDue(cfg.hintAfterMs)).toBe(true);
    // The frame empties: the camera can see a swap now, so no hint.
    rd.update(cfg.hintAfterMs, sample({ present: false }));
    rd.update(cfg.hintAfterMs + cfg.emptyMs + 1, sample({ present: false }));
    expect(rd.hintDue(cfg.hintAfterMs + cfg.emptyMs + 2)).toBe(false);
    // The first player (nobody to replace) and time-only sources never get it.
    const first = new HandoverReadiness({ requireChange: false });
    first.update(0, sample());
    expect(first.hintDue(60000)).toBe(false);
    const timed = new HandoverReadiness({ requireChange: true, timeOnly: true });
    timed.update(0, sample());
    expect(timed.hintDue(60000)).toBe(false);
  });

  it('the previous player standing still in frame is not mistaken for the next player', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    expect(readyAt(rd, () => sample(), 20000)).toBe(-1);
  });

  it('an empty frame followed by someone still counts as the next player', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    const at = readyAt(rd, (t) => (t >= 800 && t < 2500 ? sample({ present: false }) : sample()));
    expect(at).toBeGreaterThanOrEqual(2500 + cfg.stillMs);
    expect(at).toBeLessThan(2500 + cfg.stillMs + 200);
  });

  it('a flicker shorter than emptyMs is not an empty frame', () => {
    const rd = new HandoverReadiness({ requireChange: true });
    const at = readyAt(
      rd,
      (t) => (t >= 800 && t < 800 + cfg.emptyMs / 2 ? sample({ present: false }) : sample()),
      15000,
    );
    expect(at).toBe(-1);
  });

  it('a body that moved a long way, or looks a different size, is no longer a change by itself', () => {
    // Replaces the old "moved or resized counts as a change" rule: only an empty frame counts now.
    const moved = new HandoverReadiness({ requireChange: true });
    expect(readyAt(moved, (t) => (t < 1000 ? sample() : sample({ x: 0.75 })), 15000)).toBe(-1);
    const bigger = new HandoverReadiness({ requireChange: true });
    expect(readyAt(bigger, (t) => (t < 1000 ? sample() : sample({ sw: 0.26 })), 15000)).toBe(-1);
    const same = new HandoverReadiness({ requireChange: true });
    expect(readyAt(same, (t) => sample({ x: 0.5 + 0.01 * Math.sin(t / 200) }), 15000)).toBe(-1);
  });

  it('someone who keeps moving about is never "still"', () => {
    const rd = new HandoverReadiness({ requireChange: false });
    const at = readyAt(rd, (t) => sample({ x: 0.5 + 0.2 * Math.sin(t / 150) }), 15000);
    expect(at).toBe(-1);
  });

  it('time-only (synthetic and replay) is ready after the minimum time whatever the picture', () => {
    const rd = new HandoverReadiness({ requireChange: true, timeOnly: true });
    const at = readyAt(rd, () => sample({ present: false }));
    expect(at).toBeGreaterThanOrEqual(cfg.minShowMs);
    expect(at).toBeLessThan(cfg.minShowMs + 100);
  });

  it('reset restarts the clock', () => {
    const rd = new HandoverReadiness({ requireChange: false, timeOnly: true });
    expect(rd.update(0, sample())).toBe(false);
    expect(rd.update(cfg.minShowMs + 1, sample())).toBe(true);
    rd.reset(5000);
    expect(rd.update(5100, sample())).toBe(false);
  });

  it('reads the shoulders from the input state, and a hand when there is no pose', () => {
    const state = createInputState();
    const out = createPresenceSample();
    expect(samplePresence(state, out).present).toBe(false);
    state.hasPose = true;
    state.tracking = true;
    state.problem = 'none';
    state.shoulderWidth = 0.2;
    const l = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rr = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    state.pose[l] = 0.4;
    state.pose[l + 1] = 0.3;
    state.pose[rr] = 0.6;
    state.pose[rr + 1] = 0.5;
    samplePresence(state, out);
    expect(out.present).toBe(true);
    expect(out.x).toBeCloseTo(0.5);
    expect(out.y).toBeCloseTo(0.4);
    expect(out.sw).toBe(0.2);
    state.problem = 'lost';
    expect(samplePresence(state, out).present).toBe(false);

    const hands = createInputState();
    hands.tracking = true;
    hands.hasPose = false;
    hands.hands.right.present = true;
    hands.hands.right.x = 0.7;
    hands.hands.right.y = 0.5;
    samplePresence(hands, out);
    expect(out.present).toBe(true);
    expect(out.x).toBe(0.7);
    expect(out.sw).toBe(0);
  });
});
