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
import type { ArcherySport } from './index';
import { createArchery } from './index';

/** The card stays up this long, like the shell's minimum. */
const CARD_MS = 2000;
const FRAME_MS = 1000 / 60;

interface Launch {
  seat: number;
  arrow: number;
  wind: number;
}

interface Game {
  handOvers: number[];
  singles: RoundResult[];
  multis: RoundResult[][];
  standings: { seat: number; score: number; text: string }[];
  launches: Launch[];
  sport: ArcherySport;
  ctx: SportContext;
  /** Random draws taken by the end of the factory. */
  factoryDraws: number;
  seconds: number;
  /** Complete the pending handover now, as the shell would when the player is ready. */
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
    /** Leave the sport alive after the loop (the test disposes it). */
    keepAlive?: boolean;
    handedness?: Side[];
    onHandover?: (next: number) => void;
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
      options.onHandover?.(index);
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

  const sport = (await createArchery(ctx)) as ArcherySport;
  const factoryDraws = draws;
  const bot = sport.createBot();
  const synthetic = source as SyntheticSource;
  synthetic.setDirector((_q, _rel, frameT) =>
    bot.next((steps) => synthetic.queue?.enqueue(steps), frameT),
  );
  sport.start();

  const launches: Launch[] = [];
  let lastPhase = sport.phase;
  const maxFrames = 60 * 60 * 6;
  let frame = 0;
  for (; frame < maxFrames; frame++) {
    const now = 1000 + frame * FRAME_MS;
    input.update(now);
    const waiting = slot.pending;
    if (waiting !== null) {
      if (waiting.since < 0) waiting.since = now;
      if (options.stopAtHandover) break;
      if (now - waiting.since >= CARD_MS) {
        const next = waiting;
        slot.pending = null;
        current = next.index;
        next.cb();
      }
    }
    if (slot.pending === null) {
      sport.fixedUpdate(1 / 120, now);
      sport.fixedUpdate(1 / 120, now + FRAME_MS / 2);
    }
    sport.frame(1 / 60, now, 0);
    if (sport.phase === 'flying' && lastPhase !== 'flying') {
      launches.push({ seat: sport.seat, arrow: sport.arrowsShot, wind: sport.wind });
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
    seconds: (frame * FRAME_MS) / 1000,
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

describe('archery pass-and-play, closed loop with the real sport and bot', () => {
  it('two players alternate one arrow at a time and finish with one result per seat', async () => {
    const g = await play(2);
    expect(g.singles).toHaveLength(0);
    expect(g.multis).toHaveLength(1);
    const results = g.multis[0] as RoundResult[];
    expect(results).toHaveLength(2);
    // Short rounds are two arrows each: seat 0, 1, 0, 1.
    expect(g.handOvers).toEqual([1, 0, 1]);
    for (const r of results) {
      expect(r.detail?.arrows).toBe(2);
      expect(r.headline).toBe(`${r.score} pts`);
      expect(r.lines?.[0]).toMatch(/^Rings: /);
    }
    expect(g.sport.turnsShot).toBe(4);
    expect(g.sport.turnsTotal).toBe(4);
    expect(g.sport.scores).toEqual(results.map((r) => r.score));
    // The bot is a decent shot: both seats scored.
    expect(results.every((r) => r.score > 0)).toBe(true);
  }, 60000);

  it('four players take turns in seat order, and the standings follow every arrow', async () => {
    const g = await play(4);
    expect(g.multis).toHaveLength(1);
    expect(g.multis[0]).toHaveLength(4);
    expect(g.handOvers).toEqual([1, 2, 3, 0, 1, 2, 3]);
    expect(g.launches.map((l) => l.seat)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(g.sport.turnsShot).toBe(8);
    // Initial zero lines for every seat, then one update per landed arrow.
    expect(g.standings.slice(0, 4).map((s) => s.text)).toEqual([
      '0 pts',
      '0 pts',
      '0 pts',
      '0 pts',
    ]);
    expect(g.standings).toHaveLength(4 + 8);
    const last = g.standings.filter((s) => s.seat === 3).pop();
    expect(last?.score).toBe((g.multis[0] as RoundResult[])[3]?.score);
  }, 120000);

  it('is deterministic: the same seed gives the same game', async () => {
    const a = await play(3, { seed: 5 });
    const b = await play(3, { seed: 5 });
    expect(b.multis).toEqual(a.multis);
    expect(b.launches).toEqual(a.launches);
    expect(b.handOvers).toEqual(a.handOvers);
  }, 120000);

  it('every seat faces the same wind on its arrow n', async () => {
    const g = await play(3, { seed: 3 });
    const byArrow = new Map<number, number[]>();
    for (const l of g.launches) byArrow.set(l.arrow, [...(byArrow.get(l.arrow) ?? []), l.wind]);
    expect([...byArrow.keys()]).toEqual([0, 1]);
    for (const [arrow, winds] of byArrow) {
      expect(winds, `arrow ${arrow}`).toHaveLength(3);
      expect(new Set(winds).size, `arrow ${arrow}`).toBe(1);
    }
    // The first arrow is calm for everyone; the second draws a real crosswind.
    expect(byArrow.get(0)).toEqual([0, 0, 0]);
    expect(Math.abs((byArrow.get(1) as number[])[0] as number)).toBeGreaterThan(0);
  }, 120000);

  it('draws the same random numbers while building the round whatever the seat count', async () => {
    const solo = await play(1, { stopAtHandover: true });
    const four = await play(4, { stopAtHandover: true });
    // 4 sway phases + one wind per arrow after the first (2 arrows in a short round).
    expect(solo.factoryDraws).toBe(4 + 1);
    expect(four.factoryDraws).toBe(solo.factoryDraws);
  }, 60000);

  it('a single player never hands over and finishes with plain finish()', async () => {
    const g = await play(1);
    expect(g.handOvers).toEqual([]);
    expect(g.multis).toHaveLength(0);
    expect(g.singles).toHaveLength(1);
    expect(g.singles[0]?.detail?.arrows).toBe(2);
    expect(g.standings).toEqual([]);
    expect(g.sport.seatCount).toBe(1);
  }, 60000);

  it('shows each landed arrow with a bead in its shooter colour, and none for one player', async () => {
    const beads = (game: Game): number | null => {
      let found: number | null = null;
      game.ctx.stage.scene.traverse((o) => {
        const m = o as unknown as {
          isInstancedMesh?: boolean;
          count: number;
          instanceColor?: unknown;
        };
        if (m.isInstancedMesh === true && m.instanceColor) found = m.count;
      });
      return found;
    };
    const solo = await play(1, { keepAlive: true });
    expect(beads(solo)).toBeNull();
    solo.dispose();
    const mid = await play(2, { stopAtHandover: true });
    expect(beads(mid)).toBe(1);
    mid.dispose();
  }, 120000);

  it('reads the next seat hands at the handover: bow and draw hands swap with the calibration', async () => {
    const g = await play(2, { stopAtHandover: true, handedness: ['right', 'left'] });
    expect(g.sport.phase).toBe('handover');
    expect(g.sport.handedness).toBe('right');
    expect(g.ctx.avatar.mitts.left.getObjectByName('bow')).toBeDefined();
    expect(g.ctx.avatar.mitts.right.getObjectByName('bow')).toBeUndefined();
    g.finishHandover();
    expect(g.sport.phase).toBe('ready');
    expect(g.sport.seat).toBe(1);
    expect(g.sport.handedness).toBe('left');
    // A left-handed archer holds the bow in the right mitt.
    expect(g.ctx.avatar.mitts.right.getObjectByName('bow')).toBeDefined();
    expect(g.ctx.avatar.mitts.left.getObjectByName('bow')).toBeUndefined();
    expect(g.sport.arrowsShot).toBe(0);
    g.dispose();
  }, 60000);
});
