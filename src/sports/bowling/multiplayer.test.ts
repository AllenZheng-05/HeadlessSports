// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
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
import type { BowlingPhysics } from './physics';
import type { BowlingDebug } from './index';
import { createBowling } from './index';
import { rackSpot } from './world';

// Rapier cannot run in vitest: the sport gets a scripted lane instead (see tutorial.test.ts).
const lane = vi.hoisted(() => ({ make: null as null | (() => unknown) }));
vi.mock('./physics', () => ({
  createRapierBowling: async () => lane.make?.(),
}));

/** The card stays up this long, like the shell's minimum. */
const CARD_MS = 2000;
const FRAME_MS = 1000 / 60;
/** Pins down by each launch, in order, whoever throws it: strikes, spares, opens and a gutter. */
const PLAN = [10, 7, 3, 9, 1, 0, 10, 5, 5, 8, 2, 4, 6, 10, 10, 3];

class FakeLane implements BowlingPhysics {
  ballActive = false;
  ballX = 0;
  ballY = 0.1;
  ballZ = -1;
  ballSpeed = 0;
  ballInGutter = false;
  contacted = false;
  standing = 0;
  launched = 0;
  /** Pins standing at each launch, to prove every frame starts from what the scorer expects. */
  standingAtLaunch: number[] = [];
  freshRacks = 0;
  readonly pinPresent: boolean[] = new Array<boolean>(10).fill(true);
  private t = 0;
  private contactGiven = false;
  private down = 0;

  rack(fresh: boolean): void {
    if (fresh) {
      this.standing = 10;
      this.freshRacks++;
      this.contacted = false;
      this.contactGiven = false;
    }
  }
  launch(): void {
    this.standingAtLaunch.push(this.standing);
    this.ballActive = true;
    this.t = 0;
    this.contactGiven = false;
    this.contacted = false;
    this.down = Math.min(PLAN[this.launched % PLAN.length] as number, this.standing);
    this.launched++;
  }
  removeBall(): void {
    this.ballActive = false;
  }
  step(dt: number): void {
    if (!this.ballActive) return;
    this.t += dt;
    if (this.t > 0.8 && !this.contacted) {
      this.contacted = true;
      this.standing = Math.max(0, this.standing - this.down);
    }
    this.ballZ = -1 - this.t * 10;
  }
  ballDone(): boolean {
    return this.t > 1.2;
  }
  pinsAtRest(): boolean {
    return this.t > 1.5;
  }
  standingCount(): number {
    return this.standing;
  }
  commitRoll(): void {
    // The scripted lane has nothing to freeze.
    this.contactGiven = true;
  }
  takeContact(): number {
    if (this.contacted && !this.contactGiven) {
      this.contactGiven = true;
      return 6;
    }
    return 0;
  }
  readBall(_alpha: number, out: Float64Array): void {
    out.fill(0);
    out[6] = 1;
  }
  readPin(_i: number, _alpha: number, out: Float64Array): void {
    out.fill(0);
    out[6] = 1;
  }
  pinDown(): boolean {
    return false;
  }
  dispose(): void {
    this.ballActive = false;
  }
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

interface Game {
  handOvers: number[];
  singles: RoundResult[];
  multis: RoundResult[][];
  standings: { seat: number; score: number; text: string }[];
  /** The seat and balls thrown so far, each time the lane went to the handover phase. */
  turnEnds: { seat: number; balls: number }[];
  sport: Sport;
  lane: FakeLane;
  ctx: SportContext;
  factoryDraws: number;
  finishHandover(): void;
  dispose(): void;
}

type Sport = Awaited<ReturnType<typeof createBowling>> & BowlingDebug;

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
  const hands = options.handedness ?? [];
  const cals: Calibration[] = [];
  for (let i = 0; i < seats; i++) {
    cals.push({ ...syntheticCalibration(), handedness: hands[i] ?? 'right' });
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
  const fake = new FakeLane();
  lane.make = () => fake;
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

  const sport = (await createBowling(ctx)) as Sport;
  const factoryDraws = draws;
  const bot = sport.createBot();
  const synthetic = source as SyntheticSource;
  synthetic.setDirector((_q, _rel, frameT) =>
    bot.next((steps) => synthetic.queue?.enqueue(steps), frameT),
  );
  sport.start();

  const turnEnds: Game['turnEnds'] = [];
  let lastPhase = sport.phase;
  const maxFrames = 60 * 60 * 20;
  for (let frame = 0; frame < maxFrames; frame++) {
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
    if (sport.phase === 'handover' && lastPhase !== 'handover') {
      turnEnds.push({ seat: sport.seat, balls: sport.rolls.length });
    }
    lastPhase = sport.phase;
    if (singles.length > 0 || multis.length > 0) break;
  }
  const game: Game = {
    handOvers,
    singles,
    multis,
    standings,
    turnEnds,
    sport,
    lane: fake,
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

describe('bowling pass-and-play, closed loop with the real sport and bot (scripted lane)', () => {
  it('two players alternate frame by frame and finish with one result per seat', async () => {
    const g = await play(2);
    expect(g.singles).toHaveLength(0);
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    expect(results).toHaveLength(2);
    // A short game is two frames each: seat 0, 1, 0, 1.
    expect(g.handOvers).toEqual([1, 0, 1]);
    expect(g.turnEnds.map((t) => t.seat)).toEqual([0, 1, 0, 1]);
    for (const r of results) {
      expect(r.headline).toBe(`${r.score} pts`);
      expect(r.lines?.[0]).toMatch(/^\d+ strikes, \d+ spares$/);
      expect(r.detail?.frames).toBe(2);
    }
    expect(g.sport.scores).toEqual(results.map((r) => r.score));
    expect(results.every((r) => r.score > 0)).toBe(true);
  }, 30000); // about 0.4 s measured, 2.5x plus slack for load

  it('four players take turns in seat order; the standings follow every roll', async () => {
    const g = await play(4);
    expect(g.multis).toHaveLength(1);
    expect(g.multis[0]).toHaveLength(4);
    expect(g.handOvers).toEqual([1, 2, 3, 0, 1, 2, 3]);
    expect(g.turnEnds.map((t) => t.seat)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(g.standings.slice(0, 4).map((s) => s.text)).toEqual([
      '0 pts',
      '0 pts',
      '0 pts',
      '0 pts',
    ]);
    const last = g.standings.filter((s) => s.seat === 3).pop();
    expect(last?.score).toBe((g.multis[0] as RoundResult[])[3]?.score);
    // One update per counted ball: more than the initial zeros.
    expect(g.standings.length).toBeGreaterThan(4 + 8);
  }, 30000); // about 0.4 s measured, plus slack for load

  it('every frame starts from a fresh full rack, whoever bowled before', async () => {
    const g = await play(3);
    expect(g.multis).toHaveLength(1);
    // Strike or not, the first ball of every turn (every seat, every frame) meets ten pins.
    // A turn's balls are the seat's new rolls since its last turn end; the last turn is the
    // launches left after the final handover.
    const launches = g.lane.standingAtLaunch;
    const seen = new Map<number, number>();
    const firsts: number[] = [];
    let cursor = 0;
    for (const t of g.turnEnds) {
      firsts.push(cursor);
      cursor += t.balls - (seen.get(t.seat) ?? 0);
      seen.set(t.seat, t.balls);
    }
    if (cursor < launches.length) firsts.push(cursor);
    expect(firsts).toHaveLength(6);
    for (const i of firsts) expect(launches[i]).toBe(10);
    // At least one fresh rack per turn (3 seats, 2 frames each).
    expect(g.lane.freshRacks).toBeGreaterThanOrEqual(6);
    for (const t of g.turnEnds) expect(t.balls).toBeGreaterThan(0);
  }, 30000); // about 0.2 s measured, plus slack for load

  it('a seat sees only its own card: a new seat starts with no rolls, a returning seat keeps them', async () => {
    const g = await play(2, { stopAtHandover: true });
    expect(g.sport.phase).toBe('handover');
    expect(g.sport.seat).toBe(0);
    const first = [...g.sport.rolls];
    expect(first.length).toBeGreaterThan(0);
    g.finishHandover();
    expect(g.sport.seat).toBe(1);
    expect(g.sport.phase).toBe('pickup');
    expect(g.sport.rolls).toEqual([]);
    expect(g.lane.standing).toBe(10);
    expect(g.lane.ballActive).toBe(false);
    // The card shows the player's name first, with the highlight shifted past it.
    const table = g.ctx.hud.setTable as Mock;
    const [rows, col] = table.mock.calls.at(-1) as [string[][], number];
    expect(rows[0]?.[0]).toBe(g.ctx.turns.players[1]?.name);
    expect(col).toBe(1);
    g.dispose();
  }, 30000);

  it('is deterministic: the same seed gives the same game', async () => {
    const a = await play(3, { seed: 5 });
    const b = await play(3, { seed: 5 });
    expect(b.multis).toEqual(a.multis);
    expect(b.handOvers).toEqual(a.handOvers);
    expect(b.turnEnds).toEqual(a.turnEnds);
  }, 30000); // about 0.5 s measured, plus slack for load

  it('draws the same random numbers while building the round whatever the seat count', async () => {
    const solo = await play(1, { stopAtHandover: true });
    const four = await play(4, { stopAtHandover: true });
    // Bowling is deterministic: the round itself draws nothing (only the bot draws, per swing).
    expect(solo.factoryDraws).toBe(0);
    expect(four.factoryDraws).toBe(solo.factoryDraws);
    four.dispose();
  }, 30000);

  it('a single player never hands over and finishes with plain finish()', async () => {
    const g = await play(1);
    expect(g.handOvers).toEqual([]);
    expect(g.multis).toHaveLength(0);
    expect(g.singles).toHaveLength(1);
    expect(g.singles[0]?.detail?.frames).toBe(2);
    expect(g.standings).toEqual([]);
    expect(g.sport.seatCount).toBe(1);
    expect(g.turnEnds).toEqual([]);
  }, 30000);

  it('reads the next seat hand at the handover: the rack moves to the other side', async () => {
    const g = await play(2, { stopAtHandover: true, handedness: ['right', 'left'] });
    const ball = (): number => {
      let x = Number.NaN;
      g.ctx.stage.scene.traverse((o) => {
        if (o.name === 'bowling-ball') x = o.position.x;
      });
      return x;
    };
    expect(g.sport.phase).toBe('handover');
    g.finishHandover();
    expect(g.sport.phase).toBe('pickup');
    expect(ball()).toBeCloseTo(rackSpot('left').x, 5);
    g.dispose();
  }, 30000);
});
