// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import { makePlayers } from '../../core/multiplayer/players';
import type { Hud, RoundResult, SportContext, Turns } from '../../core/sport';
import { syntheticCalibration } from '../../input/testing/runScript';
import type { Calibration } from '../../input/types';
import { TrackedInput } from '../../input/TrackedInput';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { createFieldDayScene } from '../../render/style/scene';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import type { SyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import type { ClimbingSport } from './index';
import { createClimbing } from './index';
import { shownHeight } from './rules';
import { rankResults } from '../../core/multiplayer/ranking';

/** The card stays up this long, like the shell's minimum. */
const CARD_MS = 2000;
const FRAME_MS = 1000 / 60;

interface Game {
  handOvers: number[];
  singles: RoundResult[];
  multis: RoundResult[][];
  standings: { seat: number; score: number; text: string }[];
  /** Hold-layout checksum seen by each seat, read when its climb began. */
  checksums: number[];
  /** The climber's state the moment each later seat started (after the reset). */
  starts: { seat: number; height: number; grabs: number; stamina: number; status: string }[];
  sport: ClimbingSport;
  ctx: SportContext;
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
  options: { seed?: number; stopAtHandover?: boolean } = {},
): Promise<Game> {
  const seed = options.seed ?? 1;
  const cal: Calibration = syntheticCalibration();
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  input.setCalibration(cal);
  await input.start({ pose: false, handCrops: false, fullFrameHands: true });

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
      return cal;
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

  const sport = (await createClimbing(ctx)) as ClimbingSport;
  const factoryDraws = draws;
  const bot = sport.createBot();
  const synthetic = source as SyntheticSource;
  synthetic.setDirector((_q, _rel, frameT) =>
    bot.next((steps) => synthetic.queue?.enqueue(steps), frameT),
  );
  sport.start();

  const checksums: number[] = [sport.layoutChecksum];
  const starts: Game['starts'] = [];
  const maxFrames = 60 * 60 * 6;
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
        checksums.push(sport.layoutChecksum);
        starts.push({
          seat: sport.seat,
          height: sport.height,
          grabs: sport.grabs,
          stamina: sport.stamina,
          status: sport.status,
        });
      }
    }
    if (slot.pending === null) {
      sport.fixedUpdate(1 / 120, now);
      sport.fixedUpdate(1 / 120, now + FRAME_MS / 2);
    }
    sport.frame(1 / 60, now, 0);
    if (singles.length > 0 || multis.length > 0) break;
  }
  const game: Game = {
    handOvers,
    singles,
    multis,
    standings,
    checksums,
    starts,
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
  if (options.stopAtHandover !== true) game.dispose();
  return game;
}

describe('climbing pass-and-play, closed loop with the real sport and bot', () => {
  it('two players climb one after the other and finish with one result per seat', async () => {
    const g = await play(2);
    expect(g.singles).toHaveLength(0);
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    expect(results).toHaveLength(2);
    expect(g.handOvers).toEqual([1]);
    for (const r of results) {
      expect(r.score).toBeGreaterThan(3);
      expect(r.headline).toBe(`${r.score.toFixed(1)} m`);
      expect(r.lines?.[0]).toMatch(/best at \d+\.\d s$/);
      // Ranked on the height the table shows: floored to a tenth.
      expect(r.score).toBe(shownHeight(r.detail?.height as number));
      expect(r.tieBreak).toBe(-(r.detail?.seconds ?? Number.NaN));
    }
    expect(g.sport.seatBest.map(shownHeight)).toEqual(results.map((r) => r.score));
  }, 120000);

  it('ranks heights that read the same by time: 3.41 m and 3.44 m tie on score', () => {
    const players = makePlayers([], 2);
    const mk = (h: number, secs: number): RoundResult => ({
      score: shownHeight(h),
      headline: `${shownHeight(h).toFixed(1)} m`,
      tieBreak: -secs,
    });
    // Seat 0 climbed 3.44 m slowly, seat 1 3.41 m quickly: both read 3.4 m, the faster one wins.
    const rows = rankResults(players, [mk(3.44, 40), mk(3.41, 25)], true);
    expect(rows.map((r) => r.player.index)).toEqual([1, 0]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(shownHeight(3.41)).toBe(shownHeight(3.44));
  });

  it('four players climb in seat order and the standings follow each climb', async () => {
    const g = await play(4);
    expect(g.multis).toHaveLength(1);
    expect(g.multis[0]).toHaveLength(4);
    expect(g.handOvers).toEqual([1, 2, 3]);
    expect(g.standings.slice(0, 4).map((s) => s.text)).toEqual([
      '0.0 m',
      '0.0 m',
      '0.0 m',
      '0.0 m',
    ]);
    const results = g.multis[0] as RoundResult[];
    for (let seat = 0; seat < 4; seat++) {
      const last = g.standings.filter((s) => s.seat === seat).pop();
      expect(last?.score).toBe(results[seat]?.score);
    }
    // Updates arrive for one seat at a time, in seat order.
    const order = g.standings.slice(4).map((s) => s.seat);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  }, 240000);

  it('every seat climbs the same wall and starts from a clean slate', async () => {
    const g = await play(3, { seed: 3 });
    expect(new Set(g.checksums).size).toBe(1);
    expect(g.starts.map((s) => s.seat)).toEqual([1, 2]);
    for (const s of g.starts) {
      expect(s).toMatchObject({ height: 0, grabs: 0, stamina: 1, status: 'ready' });
    }
  }, 180000);

  it('is deterministic: the same seed gives the same game', async () => {
    const a = await play(2, { seed: 5 });
    const b = await play(2, { seed: 5 });
    expect(b.multis).toEqual(a.multis);
    expect(b.handOvers).toEqual(a.handOvers);
  }, 240000);

  it('draws the same random numbers while building the round whatever the seat count', async () => {
    const solo = await play(1, { stopAtHandover: true });
    const four = await play(4, { stopAtHandover: true });
    expect(solo.factoryDraws).toBe(1);
    expect(four.factoryDraws).toBe(solo.factoryDraws);
    expect(four.sport.layoutChecksum).toBe(solo.sport.layoutChecksum);
    solo.dispose();
    four.dispose();
  }, 60000);

  it('a single player never hands over and finishes with plain finish()', async () => {
    const g = await play(1);
    expect(g.handOvers).toEqual([]);
    expect(g.multis).toHaveLength(0);
    expect(g.singles).toHaveLength(1);
    expect(g.singles[0]?.lines).toHaveLength(2);
    expect(g.standings).toEqual([]);
    expect(g.sport.seatCount).toBe(1);
  }, 120000);

  it('shows earlier climbers as coloured lines on the wall, and none for one player', async () => {
    const marks = (game: Game): number | null => {
      let found: number | null = null;
      game.ctx.stage.scene.traverse((o) => {
        if (o.name === 'seat-marks') found = (o as unknown as { count: number }).count;
      });
      return found;
    };
    const solo = await play(1, { stopAtHandover: true });
    // One player has no seat-marks mesh at all: the draw-call count is what it was before.
    expect(marks(solo)).toBeNull();
    let instanced = 0;
    solo.ctx.stage.scene.traverse((o) => {
      if ((o as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true) instanced++;
    });
    expect(instanced).toBe(4);
    solo.dispose();
    const stop = await play(3, { stopAtHandover: true });
    expect(stop.sport.handingOver).toBe(true);
    stop.finishHandover();
    expect(stop.sport.seat).toBe(1);
    expect(stop.sport.handingOver).toBe(false);
    expect(marks(stop)).toBe(1);
    stop.dispose();
  }, 180000);
});
