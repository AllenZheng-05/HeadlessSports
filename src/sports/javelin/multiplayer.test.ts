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
import { Matrix4, Vector3 } from 'three/webgpu';
import type { InstancedMesh } from 'three/webgpu';
import type { JavelinSport } from './index';
import { createJavelin } from './index';
import { shownDistance } from './game';
import { rankResults } from '../../core/multiplayer/ranking';

/** The card stays up this long, like the shell's minimum. */
const CARD_MS = 2000;
const FRAME_MS = 1000 / 60;

interface Launch {
  seat: number;
  attempt: number;
  hand: Side;
}

interface Game {
  handOvers: number[];
  singles: RoundResult[];
  multis: RoundResult[][];
  standings: { seat: number; score: number; text: string }[];
  launches: Launch[];
  sport: JavelinSport;
  ctx: SportContext;
  /** Random draws taken by the end of the factory, and by the end of creating the bot. */
  factoryDraws: number;
  botDraws: number;
  seconds: number;
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
    /** Stop at the first handover (for tests that look at the moment). */
    stopAtHandover?: boolean;
    keepAlive?: boolean;
    handedness?: Side[];
    /** The full three attempts instead of the short round's one. */
    full?: boolean;
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
    short: options.full !== true,
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

  const sport = (await createJavelin(ctx)) as JavelinSport;
  const factoryDraws = draws;
  const bot = sport.createBot();
  const botDraws = draws - factoryDraws;
  const synthetic = source as SyntheticSource;
  synthetic.setDirector((_q, _rel, frameT) =>
    bot.next((steps) => synthetic.queue?.enqueue(steps), frameT),
  );
  sport.start();

  const launches: Launch[] = [];
  let lastPhase = sport.phase;
  const maxFrames = 60 * 60 * 8;
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
    if (sport.phase === 'flight' && lastPhase !== 'flight') {
      launches.push({ seat: sport.seat, attempt: sport.attempt, hand: sport.handedness });
    }
    lastPhase = sport.phase;
    if (singles.length > 0 || multis.length > 0) break;
  }
  const game: Game = {
    handOvers,
    singles,
    multis,
    standings,
    launches,
    sport,
    ctx,
    factoryDraws,
    botDraws,
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

describe('javelin pass-and-play, closed loop with the real sport and bot', () => {
  it('two players alternate one attempt at a time and finish with one result per seat', async () => {
    const g = await play(2);
    expect(g.singles).toHaveLength(0);
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    expect(results).toHaveLength(2);
    // A short round is one attempt each: seat 0, then seat 1.
    expect(g.handOvers).toEqual([1]);
    for (const r of results) {
      expect(r.detail?.attempts).toBe(1);
      expect(r.headline).toBe(r.score > 0 ? `${r.score.toFixed(2)} m` : 'No mark');
      expect(r.lines?.[0]).toBe(r.score > 0 ? r.score.toFixed(1) : 'foul');
    }
    expect(g.sport.scores.map(shownDistance)).toEqual(results.map((r) => r.score));
    for (const r of results) expect(r.score).toBe(Number((r.detail?.best as number).toFixed(2)));
    // The bot is a decent thrower: both seats got a mark.
    expect(results.every((r) => r.score > 10)).toBe(true);
  }, 60000);

  it('marks that read the same share a rank: 34.201 m and 34.204 m', () => {
    const players = makePlayers([], 2);
    const mk = (d: number): RoundResult => ({
      score: shownDistance(d),
      headline: `${d.toFixed(2)} m`,
    });
    const rows = rankResults(players, [mk(34.201), mk(34.204)], true);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
    expect(rows[0]?.result.score).toBe(34.2);
  });

  it('four players take turns in seat order, and the standings follow every landing', async () => {
    const g = await play(4);
    expect(g.multis).toHaveLength(1);
    expect(g.multis[0]).toHaveLength(4);
    expect(g.handOvers).toEqual([1, 2, 3]);
    expect(g.launches.map((l) => l.seat)).toEqual([0, 1, 2, 3]);
    expect(g.standings.slice(0, 4).map((s) => s.text)).toEqual([
      'no mark',
      'no mark',
      'no mark',
      'no mark',
    ]);
    expect(g.standings).toHaveLength(4 + 4);
    for (let seat = 0; seat < 4; seat++) {
      const last = g.standings.filter((s) => s.seat === seat).pop();
      const result = (g.multis[0] as RoundResult[])[seat] as RoundResult;
      expect(last?.score).toBe(result.score);
      expect(last?.text).toBe(result.score > 0 ? `${result.score.toFixed(2)} m` : 'no mark');
    }
  }, 120000);

  it('with the full three attempts the seats alternate 0, 1, 0, 1, 0, 1', async () => {
    const g = await play(2, { full: true, seed: 2 });
    expect(g.multis).toHaveLength(1);
    expect(g.handOvers).toEqual([1, 0, 1, 0, 1]);
    expect(g.launches.map((l) => `${l.seat}:${l.attempt}`)).toEqual([
      '0:0',
      '1:0',
      '0:1',
      '1:1',
      '0:2',
      '1:2',
    ]);
    for (const r of g.multis[0] as RoundResult[]) {
      expect(r.detail?.attempts).toBe(3);
      expect(r.lines?.[0]?.split(', ')).toHaveLength(3);
    }
  }, 240000);

  it('is deterministic: the same seed gives the same game', async () => {
    const a = await play(3, { seed: 5 });
    const b = await play(3, { seed: 5 });
    expect(b.multis).toEqual(a.multis);
    expect(b.launches).toEqual(a.launches);
    expect(b.handOvers).toEqual(a.handOvers);
  }, 120000);

  it('draws the same random numbers while building the sport and its bot whatever the seat count', async () => {
    const solo = await play(1, { stopAtHandover: true });
    const four = await play(4, { stopAtHandover: true });
    // The sport itself draws nothing; the bot draws its arm power and loft once, for every seat.
    expect(solo.factoryDraws).toBe(0);
    expect(four.factoryDraws).toBe(solo.factoryDraws);
    expect(solo.botDraws).toBe(2);
    expect(four.botDraws).toBe(solo.botDraws);
    solo.dispose();
    four.dispose();
  }, 60000);

  it('a single player never hands over and finishes with plain finish()', async () => {
    const g = await play(1);
    expect(g.handOvers).toEqual([]);
    expect(g.multis).toHaveLength(0);
    expect(g.singles).toHaveLength(1);
    expect(g.singles[0]?.detail?.attempts).toBe(1);
    expect(g.standings).toEqual([]);
    expect(g.sport.seatCount).toBe(1);
  }, 60000);

  it('stands a pennant in the seat colour for each best mark, and none for one player', async () => {
    const marks = (game: Game): InstancedMesh | null =>
      game.ctx.stage.scene.getObjectByName('seat-marks') as InstancedMesh | null;
    const solo = await play(1, { keepAlive: true });
    expect(marks(solo) ?? null).toBeNull();
    solo.dispose();
    const mid = await play(2, { stopAtHandover: true });
    const m = marks(mid) as InstancedMesh;
    expect(m.count).toBe(2);
    const first = new Matrix4();
    const second = new Matrix4();
    m.getMatrixAt(0, first);
    m.getMatrixAt(1, second);
    // Seat 0 has a mark already, seat 1 does not.
    expect(first.elements[0]).toBeGreaterThan(0);
    expect(second.elements[0]).toBe(0);
    expect(m.instanceColor).not.toBeNull();
    mid.dispose();
  }, 60000);

  it('a left-hander after a right-hander throws left: the javelin moves to the other mitt', async () => {
    const g = await play(2, { stopAtHandover: true, handedness: ['right', 'left'] });
    expect(g.sport.phase).toBe('handover');
    expect(g.sport.handedness).toBe('right');
    g.finishHandover();
    expect(g.sport.phase).toBe('ready');
    expect(g.sport.seat).toBe(1);
    expect(g.sport.handedness).toBe('left');
    expect(g.sport.attempt).toBe(0);
    expect(g.sport.best).toBe(0);
    expect(g.sport.position).toBe(0);
    g.sport.frame(1 / 60, 99999, 0);
    const javelin = g.ctx.stage.scene.getObjectByName('javelin') as unknown as {
      position: Vector3;
    };
    const mitt = new Vector3();
    g.ctx.avatar.mitts.left.getWorldPosition(mitt);
    expect(javelin.position.distanceTo(mitt)).toBeLessThan(1e-6);
    g.dispose();
  }, 60000);

  it('plays a right-hander then a left-hander to the end, each with a mark', async () => {
    const g = await play(2, { handedness: ['right', 'left'], seed: 3 });
    expect(g.multis).toHaveLength(1);
    expect(g.launches.map((l) => l.hand)).toEqual(['right', 'left']);
    const results = g.multis[0] as RoundResult[];
    expect(results[0]?.score).toBeGreaterThan(10);
    expect(results[1]?.score).toBeGreaterThan(10);
  }, 60000);

  it('starts every seat from the start of the runway with no run speed', async () => {
    const g = await play(2, { stopAtHandover: true });
    g.finishHandover();
    expect(g.sport.position).toBe(0);
    expect(g.sport.speed).toBe(0);
    expect(g.sport.notice).toBe('');
    expect(g.sport.ignoredThrows).toBeGreaterThanOrEqual(0);
    g.dispose();
  }, 60000);
});
