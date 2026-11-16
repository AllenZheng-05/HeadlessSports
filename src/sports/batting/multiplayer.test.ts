// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import { makePlayers } from '../../core/multiplayer/players';
import type { Hud, RoundResult, Sport as CoreSport, SportContext, Turns } from '../../core/sport';
import { recognizerConfig } from '../../input/recognizers/config';
import { syntheticCalibration } from '../../input/testing/runScript';
import type { Calibration, Side } from '../../input/types';
import { TrackedInput } from '../../input/TrackedInput';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { createFieldDayScene } from '../../render/style/scene';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import type { SyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { DrawTape } from './tape';
import type { BattingProbe } from './index';
import { createBatting } from './index';

/** The card stays up this long, like the shell's minimum. */
const CARD_MS = 2000;
const FRAME_MS = 1000 / 60;

type Pitched = Pick<BattingProbe['results'][number], 'band' | 'tx' | 'flightMs' | 'setMs'>;

interface Game {
  handOvers: number[];
  singles: RoundResult[];
  multis: RoundResult[][];
  standings: { seat: number; score: number; text: string }[];
  /** Every pitch resolved, by seat, in order. */
  bySeat: BattingProbe['results'][number][][];
  sport: Sport;
  /** Random draws taken by the end of the game. */
  draws: number;
  seconds: number;
  /** Complete the pending handover now, as the shell would when the player is ready. */
  finishHandover(): void;
  dispose(): void;
}

type Sport = CoreSport & BattingProbe;

function hud(): Hud {
  return {
    setScore: vi.fn(),
    setSubScore: vi.fn(),
    setBanner: vi.fn(),
    setHint: vi.fn(),
    setMeter: vi.fn(),
    setTable: vi.fn(),
    flash: vi.fn(),
    setCursor: vi.fn(),
    clear: vi.fn(),
  };
}

/** Drive the real sport and its bot, with a stand-in for the shell's handover. */
async function play(
  seats: number,
  options: {
    seed?: number;
    /** Stop at the first handover (for tests that look at the moment). */
    stopAtHandover?: boolean;
    /** Leave the sport alive after the loop (the test disposes it). */
    keepAlive?: boolean;
    handedness?: Side[];
  } = {},
): Promise<Game> {
  const seed = options.seed ?? 1;
  const drawHands = options.handedness ?? [];
  const cals: Calibration[] = [];
  for (let i = 0; i < seats; i++) {
    cals.push({ ...syntheticCalibration(), handedness: drawHands[i] ?? 'right' });
  }
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  input.setCalibration(cals[0] ?? null);
  await input.start({ pose: true, handCrops: false, fullFrameHands: false });

  const players = makePlayers([], seats);
  let current = 0;
  const slot: { pending: { index: number; cb: () => void; since: number } | null } = {
    pending: null,
  };
  const handOvers: number[] = [];
  const standings: Game['standings'] = [];
  const turns: Turns = {
    count: seats,
    players,
    get current(): number {
      return current;
    },
    handOver: (index, cb) => {
      handOvers.push(index);
      slot.pending = { index, cb, since: -1 };
    },
    setStanding: (seat, score, text) => {
      standings.push({ seat, score, text });
    },
  };
  const random = mulberry32(seed);
  let draws = 0;
  const singles: RoundResult[] = [];
  const multis: RoundResult[][] = [];
  const scene = createFieldDayScene();
  const avatar = new AvatarRig();
  scene.scene.add(avatar.root);
  const ctx = {
    stage: scene,
    avatar,
    input,
    hud: hud(),
    audio: { play: vi.fn(), setMuted: vi.fn() },
    tunables: { register: () => () => undefined },
    get calibration(): Calibration | null {
      return cals[current] ?? null;
    },
    best: null,
    random: () => {
      draws++;
      return random();
    },
    debug: false,
    short: true,
    get paused(): boolean {
      return slot.pending !== null;
    },
    finish: (r: RoundResult) => singles.push(r),
    turns,
    finishMulti: (r: readonly RoundResult[]) => multis.push([...r]),
    tutorial: false,
    coach: {
      show: vi.fn(),
      setFeedback: vi.fn(),
      confirm: vi.fn(),
      onSkip: vi.fn(),
      hide: vi.fn(),
    },
    finishTutorial: vi.fn(),
  } as unknown as SportContext;

  const sport = (await createBatting(ctx)) as Sport;
  const bot = sport.createBot();
  const synthetic = source as SyntheticSource;
  synthetic.setDirector((_q, _rel, frameT) =>
    bot.next((steps) => synthetic.queue?.enqueue(steps), frameT),
  );
  sport.start();

  const bySeat: BattingProbe['results'][number][][] = [];
  for (let i = 0; i < seats; i++) bySeat.push([]);
  let seenSeat = 0;
  let seenCount = 0;
  const maxFrames = 60 * 60 * 10;
  let frame = 0;
  for (; frame < maxFrames; frame++) {
    const now = 1000 + frame * FRAME_MS;
    input.update(now);
    const waiting = slot.pending;
    if (waiting !== null) {
      if (waiting.since < 0) waiting.since = now;
      if (options.stopAtHandover) break;
      if (now - waiting.since >= CARD_MS) {
        slot.pending = null;
        current = waiting.index;
        input.setCalibration(cals[current] ?? null);
        waiting.cb();
      }
    }
    if (slot.pending === null) {
      sport.fixedUpdate(1 / 120, now);
      sport.fixedUpdate(1 / 120, now + FRAME_MS / 2);
    }
    sport.frame(1 / 60, now, 0);
    if (sport.seat !== seenSeat) {
      seenSeat = sport.seat;
      seenCount = 0;
    }
    while (seenCount < sport.results.length) {
      bySeat[seenSeat]!.push({ ...sport.results[seenCount]! });
      seenCount++;
    }
    if (singles.length > 0 || multis.length > 0) break;
  }
  const game: Game = {
    handOvers,
    singles,
    multis,
    standings,
    bySeat,
    sport,
    draws,
    seconds: (frame * FRAME_MS) / 1000,
    finishHandover: () => {
      const next = slot.pending;
      if (next === null) throw new Error('no handover is pending');
      slot.pending = null;
      current = next.index;
      input.setCalibration(cals[current] ?? null);
      next.cb();
    },
    dispose: () => {
      sport.dispose();
      input.stop();
    },
  };
  if (options.stopAtHandover !== true && options.keepAlive !== true) game.dispose();
  return game;
}

const pitched = (rs: BattingProbe['results'][number][]): Pitched[] =>
  rs.map((r) => ({ band: r.band, tx: r.tx, flightMs: r.flightMs, setMs: r.setMs }));

describe('batting pass-and-play, closed loop with the real sport and bot', () => {
  it('two players bat one set each and finish with one result per seat', async () => {
    const g = await play(2);
    expect(g.singles).toHaveLength(0);
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    expect(results).toHaveLength(2);
    // A short set is three pitches; the bat is passed once, after the first set.
    expect(g.handOvers).toEqual([1]);
    for (const r of results) {
      expect(r.detail?.pitches).toBe(3);
      expect(r.headline).toBe(`${r.score} ft`);
      expect(r.lines?.[0]).toMatch(/^(1 home run|\d+ home runs), longest \d+ ft$/);
    }
    expect(g.bySeat.map((s) => s.length)).toEqual([3, 3]);
    expect(g.sport.scores).toEqual(results.map((r) => r.score));
    // The bot hits: both seats scored.
    expect(results.every((r) => r.score > 0)).toBe(true);
  }, 120000);

  it('four players take turns in seat order, and the standings follow every hit', async () => {
    const g = await play(4);
    expect(g.multis).toHaveLength(1);
    expect(g.multis[0]).toHaveLength(4);
    expect(g.handOvers).toEqual([1, 2, 3]);
    expect(g.bySeat.map((s) => s.length)).toEqual([3, 3, 3, 3]);
    expect(g.standings.slice(0, 4).map((s) => s.text)).toEqual(['0 ft', '0 ft', '0 ft', '0 ft']);
    // Standings only move for the seat at bat, in seat order.
    const order = g.standings.slice(4).map((s) => s.seat);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const last = g.standings.filter((s) => s.seat === 3).pop();
    expect(last?.score).toBe((g.multis[0] as RoundResult[])[3]?.score);
    expect(last?.text).toBe(`${last?.score} ft`);
  }, 240000);

  it('is deterministic: the same seed gives the same game', async () => {
    const a = await play(3, { seed: 5 });
    const b = await play(3, { seed: 5 });
    expect(b.multis).toEqual(a.multis);
    expect(b.handOvers).toEqual(a.handOvers);
    expect(b.bySeat.map(pitched)).toEqual(a.bySeat.map(pitched));
  }, 240000);

  it('every seat faces the same pitches: pitch n is identical for all', async () => {
    const g = await play(3, { seed: 3 });
    const first = pitched(g.bySeat[0]!);
    expect(first).toHaveLength(3);
    // Not all alike, so the check means something.
    expect(new Set(first.map((p) => `${p.band}:${p.tx}:${p.setMs}`)).size).toBeGreaterThan(1);
    expect(pitched(g.bySeat[1]!)).toEqual(first);
    expect(pitched(g.bySeat[2]!)).toEqual(first);
  }, 240000);

  it('takes the same random draws whatever the seat count: only the first seat draws', async () => {
    const solo = await play(1);
    const four = await play(4);
    expect(solo.draws).toBeGreaterThan(0);
    expect(four.draws).toBe(solo.draws);
    // And seat 0 plays the very same set in both games.
    expect(pitched(four.bySeat[0]!)).toEqual(pitched(solo.bySeat[0]!));
    expect(four.multis[0]?.[0]?.score).toBe(solo.singles[0]?.score);
  }, 240000);

  it('a single player never hands over and finishes with plain finish()', async () => {
    const g = await play(1);
    expect(g.handOvers).toEqual([]);
    expect(g.multis).toHaveLength(0);
    expect(g.singles).toHaveLength(1);
    expect(g.singles[0]?.detail?.pitches).toBe(3);
    expect(g.singles[0]?.lines?.[0]).toMatch(/pitches hit$/);
    expect(g.standings).toEqual([]);
    expect(g.sport.seatCount).toBe(1);
  }, 120000);

  it('a left-hander after a right-hander: stance, side of the plate and swing direction switch', async () => {
    const original = recognizerConfig.swing.forward;
    const g = await play(2, { stopAtHandover: true, handedness: ['right', 'left'] });
    expect(g.sport.phase).toBe('handover');
    expect(g.sport.handedness).toBe('right');
    expect(recognizerConfig.swing.forward).toBe(1);
    expect(g.sport.batter.x).toBeLessThan(0);
    expect(g.sport.batter.yaw).toBeLessThan(0);
    g.finishHandover();
    expect(g.sport.seat).toBe(1);
    expect(g.sport.handedness).toBe('left');
    expect(g.sport.phase).toBe('waiting');
    expect(recognizerConfig.swing.forward).toBe(-1);
    expect(g.sport.batter.x).toBeGreaterThan(0);
    expect(g.sport.batter.yaw).toBeGreaterThan(0);
    expect(g.sport.pitchIndex).toBe(0);
    g.dispose();
    // The first apply's restore puts back what was there before the sport.
    expect(recognizerConfig.swing.forward).toBe(original);
  }, 120000);

  it('plays a mixed-handed game through: the bot swings the right way for every seat', async () => {
    const original = recognizerConfig.swing.forward;
    const g = await play(3, { handedness: ['right', 'left', 'right'] });
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    for (const [i, r] of results.entries()) {
      expect(r.detail?.hits, `seat ${i} hits`).toBeGreaterThanOrEqual(1);
      expect(r.score, `seat ${i} score`).toBeGreaterThan(0);
    }
    expect(recognizerConfig.swing.forward).toBe(original);
  }, 240000);
});

describe('DrawTape', () => {
  it('replays what the recorder drew, in order, and grows past its first size', () => {
    const tape = new DrawTape();
    const src = mulberry32(9);
    const rec = tape.recorder(src);
    const drawn: number[] = [];
    for (let i = 0; i < 200; i++) drawn.push(rec());
    expect(tape.length).toBe(200);
    const spare = vi.fn(() => 0.5);
    const play1 = tape.replayer(spare);
    const play2 = tape.replayer(spare);
    expect(drawn.map(() => play1())).toEqual(drawn);
    expect(drawn.map(() => play2())).toEqual(drawn);
    expect(spare).not.toHaveBeenCalled();
    // Past the end it falls back to the source rather than failing.
    expect(play1()).toBe(0.5);
  });
});
