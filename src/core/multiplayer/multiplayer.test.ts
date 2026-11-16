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
  defaultName,
  loadLastNames,
  makePlayers,
  parseNames,
  prefillNames,
  sanitiseName,
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

  it('the stray-finish fallback keeps the one real result in its seat', () => {
    const real = r(12);
    const out = singleResultFallback(3, 1, real);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(real);
    expect(out[0]?.headline).toBe('-');
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

  it('a body that moved a long way, or looks a different size, counts as a change', () => {
    const moved = new HandoverReadiness({ requireChange: true });
    expect(readyAt(moved, (t) => (t < 1000 ? sample() : sample({ x: 0.75 })))).toBeGreaterThan(0);
    const bigger = new HandoverReadiness({ requireChange: true });
    expect(readyAt(bigger, (t) => (t < 1000 ? sample() : sample({ sw: 0.26 })))).toBeGreaterThan(0);
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
