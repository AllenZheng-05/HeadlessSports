// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import { makePlayers } from '../../core/multiplayer/players';
import type { Hud, RoundResult, SportContext, Turns } from '../../core/sport';
import { syntheticCalibration } from '../../input/testing/runScript';
import type { Calibration, Side } from '../../input/types';
import { TrackedInput } from '../../input/TrackedInput';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { createFieldDayScene } from '../../render/style/scene';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import type { SyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import type { PitchProbe, PitchingSport } from './index';
import { createPitching } from './index';

/** The card stays up this long, like the shell's minimum. */
const CARD_MS = 2000;
const FRAME_MS = 1000 / 60;

interface Game {
  handOvers: number[];
  singles: RoundResult[];
  multis: RoundResult[][];
  standings: { seat: number; score: number; text: string }[];
  /** Every seat's pitches, in throwing order. */
  bySeat: PitchProbe[][];
  /** The handedness the sport used for each seat's set, in seat order. */
  hands: Side[];
  sport: PitchingSport;
  ctx: SportContext;
  /** Random draws taken by the end of the factory. */
  factoryDraws: number;
  finishHandover(): void;
  dispose(): void;
}

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
    stopAtHandover?: boolean;
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
  await input.start({ pose: true, handCrops: true, fullFrameHands: false });

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

  const sport = (await createPitching(ctx)) as PitchingSport;
  const factoryDraws = draws;
  const bot = sport.createBot();
  const synthetic = source as SyntheticSource;
  synthetic.setDirector((_q, _rel, frameT) =>
    bot.next((steps) => synthetic.queue?.enqueue(steps), frameT),
  );
  sport.start();

  const bySeat: PitchProbe[][] = [];
  const hands: Side[] = [sport.handedness];
  for (let i = 0; i < seats; i++) bySeat.push([]);
  const maxFrames = 60 * 60 * 8;
  let frame = 0;
  let lastSeat = 0;
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
        waiting.cb();
      }
    }
    if (slot.pending === null) {
      sport.fixedUpdate(1 / 120, now);
      sport.fixedUpdate(1 / 120, now + FRAME_MS / 2);
    }
    sport.frame(1 / 60, now, 0);
    if (sport.seat !== lastSeat) {
      lastSeat = sport.seat;
      hands.push(sport.handedness);
    }
    const ps = sport.pitches;
    if (ps.length > (bySeat[sport.seat] as PitchProbe[]).length) bySeat[sport.seat] = [...ps];
    if (singles.length > 0 || multis.length > 0) break;
  }
  if (frame >= maxFrames && options.stopAtHandover !== true) {
    throw new Error(`the ${seats}-seat game did not finish in ${maxFrames} frames`);
  }
  const game: Game = {
    handOvers,
    singles,
    multis,
    standings,
    bySeat,
    hands,
    sport,
    ctx,
    factoryDraws,
    finishHandover: () => {
      const next = slot.pending;
      if (next === null) throw new Error('no handover is pending');
      slot.pending = null;
      current = next.index;
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

const plan = (ps: readonly PitchProbe[]): string[] => ps.map((p) => `${p.called}@${p.target}`);

describe('pitching pass-and-play, closed loop with the real sport and bot', () => {
  it('two players each throw a whole set, then finish with one result per seat', async () => {
    const g = await play(2);
    expect(g.singles).toHaveLength(0);
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    expect(results).toHaveLength(2);
    expect(g.handOvers).toEqual([1]);
    for (const r of results) {
      expect(r.detail?.pitches).toBe(3);
      expect(r.headline).toBe(`${r.score} pts`);
      expect(r.lines?.[0]).toMatch(/bullseyes?, top speed \d+ km\/h$/);
      expect(r.score).toBeGreaterThan(0);
    }
    expect(g.sport.seatScores).toEqual(results.map((r) => r.score));
  }, 120000);

  it('four players take turns in seat order, and the standings follow every pitch', async () => {
    const g = await play(4);
    expect(g.multis).toHaveLength(1);
    expect(g.multis[0]).toHaveLength(4);
    expect(g.handOvers).toEqual([1, 2, 3]);
    expect(g.bySeat.map((s) => s.length)).toEqual([3, 3, 3, 3]);
    expect(g.standings.slice(0, 4).map((s) => s.text)).toEqual([
      '0 pts',
      '0 pts',
      '0 pts',
      '0 pts',
    ]);
    // Each seat's standing ends on its result.
    for (let seat = 0; seat < 4; seat++) {
      const last = g.standings.filter((s) => s.seat === seat).pop();
      expect(last?.score).toBe((g.multis[0] as RoundResult[])[seat]?.score);
    }
  }, 240000);

  it('is deterministic: the same seed gives the same game', async () => {
    const a = await play(3, { seed: 5 });
    const b = await play(3, { seed: 5 });
    expect(b.multis).toEqual(a.multis);
    expect(b.bySeat).toEqual(a.bySeat);
    expect(b.handOvers).toEqual(a.handOvers);
  }, 240000);

  it('every seat gets the same catcher calls, and the first seat matches a single player', async () => {
    const solo = await play(1, { seed: 3 });
    const g = await play(3, { seed: 3 });
    const first = plan(g.bySeat[0] as PitchProbe[]);
    expect(first).toHaveLength(3);
    expect(plan(g.bySeat[1] as PitchProbe[])).toEqual(first);
    expect(plan(g.bySeat[2] as PitchProbe[])).toEqual(first);
    expect(plan(solo.bySeat[0] as PitchProbe[])).toEqual(first);
    // Seat 0 plays exactly as a single player would.
    expect(g.bySeat[0]).toEqual(solo.bySeat[0]);
  }, 240000);

  it('draws the same random numbers while building the round whatever the seat count', async () => {
    const solo = await play(1, { stopAtHandover: true });
    const four = await play(4, { stopAtHandover: true });
    // The first call: its type and its spot.
    expect(solo.factoryDraws).toBe(2);
    expect(four.factoryDraws).toBe(solo.factoryDraws);
    solo.dispose();
    four.dispose();
  }, 60000);

  it('a single player never hands over and finishes with plain finish()', async () => {
    const g = await play(1);
    expect(g.handOvers).toEqual([]);
    expect(g.multis).toHaveLength(0);
    expect(g.singles).toHaveLength(1);
    expect(g.singles[0]?.detail?.pitches).toBe(3);
    expect(g.standings).toEqual([]);
    expect(g.sport.seatCount).toBe(1);
  }, 120000);

  it('reads the next seat hand at the handover: a left-hander after a right-hander', async () => {
    const g = await play(2, { stopAtHandover: true, handedness: ['right', 'left'] });
    expect(g.sport.phase).toBe('handover');
    expect(g.sport.handedness).toBe('right');
    g.finishHandover();
    expect(g.sport.phase).toBe('call');
    expect(g.sport.seat).toBe(1);
    expect(g.sport.handedness).toBe('left');
    expect(g.sport.index).toBe(0);
    expect(g.sport.pitches).toHaveLength(0);
    // The ball is back in the new throwing hand's mitt.
    expect(g.ctx.avatar.mitts.left.getObjectByName('ball')).toBeDefined();
    expect(g.ctx.avatar.mitts.right.getObjectByName('ball')).toBeUndefined();
    g.dispose();
  }, 60000);

  it('plays a full game with mixed hands, and the left-hander throws as called', async () => {
    const g = await play(2, { handedness: ['right', 'left'] });
    expect(g.hands).toEqual(['right', 'left']);
    const left = g.bySeat[1] as PitchProbe[];
    expect(left).toHaveLength(3);
    for (const p of left) {
      expect(p.balk).toBe(false);
      expect(p.kind).toBe(p.called);
    }
    expect((g.multis[0] as RoundResult[])[1]?.score).toBeGreaterThan(0);
  }, 120000);
});
