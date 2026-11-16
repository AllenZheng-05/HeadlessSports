import { describe, expect, it, vi } from 'vitest';
import type { Coach } from '../../core/sport';
import { syntheticCalibration } from '../../input/testing/runScript';
import { TrackedInput } from '../../input/TrackedInput';
import type { FrameProblem, RejectedMotion } from '../../input/types';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { createBowlingBot } from './bot';
import { bowlingConfig } from './config';
import { BowlingGame } from './game';
import type { RollOutcome } from './game';
import type { BowlingPhysics } from './physics';
import {
  countPickup,
  countRelease,
  countRoll,
  countThrow,
  countWindup,
  createBowlTutorial,
  createTutorialCounts,
} from './tutorial';
import type { BodyView, BowlTutorial, TutorialCounts, TutorialProbe } from './tutorial';

const DT = 1 / 120;

function fakeCoach() {
  let skip: (() => void) | null = null;
  const shown: string[] = [];
  const details: (string | null)[] = [];
  const coach = {
    show: vi.fn((_i: number, _n: number, text: string, detail: string | null) => {
      shown.push(text);
      details.push(detail);
    }),
    setFeedback: vi.fn(),
    confirm: vi.fn(),
    onSkip: vi.fn((h: () => void) => {
      skip = h;
      return () => undefined;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, shown, details, pressSkip: () => skip?.() };
}

/** Scripted physics: each launch knocks down the next number from `plan`. */
class FakePhysics implements BowlingPhysics {
  plan: number[] = [];
  committed = 0;
  standing = 0;
  ballActive = false;
  ballX = 0;
  ballY = 0.1;
  ballZ = -1;
  ballSpeed = 0;
  ballInGutter = false;
  contacted = false;
  private t = 0;
  private contactGiven = false;
  private down = 0;

  rack(fresh: boolean): void {
    if (fresh) this.standing = 10;
  }
  launch(): void {
    this.ballActive = true;
    this.t = 0;
    this.contactGiven = false;
    this.contacted = false;
    this.down = this.plan.shift() ?? 0;
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
    this.committed++;
  }
  takeContact(): number {
    if (this.contacted && !this.contactGiven) {
      this.contactGiven = true;
      return 6;
    }
    return 0;
  }
  dispose(): void {
    this.ballActive = false;
  }
}

/**
 * Closed loop without a browser: the bot's moves go through the synthetic source and the real
 * tracking (filters, kinematics, recognizers) into the real game rules, and the tutorial watches.
 */
function simulate(seed: number, seconds: number) {
  const cfg = { ...bowlingConfig };
  const hand = 'right' as const;
  const physics = new FakePhysics();
  // Varied results: a strike, leftovers, a gutter and a spare in the mix.
  const plans = [
    [10, 6, 4, 0, 7, 3, 9, 1, 5, 5, 8, 2],
    [7, 3, 0, 10, 4, 6, 8, 1, 10, 5, 5, 9],
    [0, 8, 2, 10, 10, 3, 6, 5, 4, 7, 1, 9],
    [9, 1, 5, 5, 0, 0, 10, 6, 3, 8, 2, 7],
  ];
  physics.plan = [...plans[(seed - 1) % plans.length]!];
  const counts: TutorialCounts = createTutorialCounts();
  const probe: TutorialProbe = { gate: 0 };
  const { coach, shown } = fakeCoach();
  let finishedAt = -1;
  let now = 0;
  const game: BowlingGame = new BowlingGame(
    physics,
    cfg,
    {
      pickedUp: () => {
        countPickup(counts);
      },
      released: (r) => {
        countRelease(counts, r.hook);
      },
      rolled: (o: RollOutcome) => {
        countRoll(counts, o.kind);
      },
    },
    { hand, frames: cfg.frames },
  );
  const source = createSyntheticSource({
    script: { name: 'idle', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  input.setCalibration(syntheticCalibration());
  input.on('FistClosed', (e) => game.onFistClosed(e.hand));
  input.on('ThrowWindup', (e) => {
    countWindup(counts, game.phase, hand, e.hand);
    game.onWindup(e.hand);
  });
  input.on('ThrowReleased', (e) => {
    countThrow(counts, game.phase, hand, e.hand, game.onThrow(e));
  });
  void input.start({ pose: true, handCrops: true, fullFrameHands: false });
  const botView = {
    get phase() {
      return game.phase;
    },
    get launches() {
      return counts.launches;
    },
  };
  const bot = createBowlingBot(botView, hand, mulberry(seed), -0.14, probe);
  const enqueue = (steps: ScriptStep[]): void => {
    source.queue?.enqueue(steps);
  };
  source.setDirector((_q, _rel, frameT) => bot.next(enqueue, frameT));
  const tutorial = createBowlTutorial({
    cfg,
    coach,
    game,
    counts,
    mouse: false,
    body: {
      tracking: () => input.state.tracking,
      problem: () => input.state.problem,
      handPresent: () => input.state.hands[hand].present,
      rejected: () => input.state.rejected,
    },
    probe,
    onFinished: () => {
      finishedAt = now;
    },
  });
  game.start();
  const frameMs = 1000 / 60;
  const phases = new Set<string>();
  for (let i = 0; i * frameMs < seconds * 1000 && finishedAt < 0; i++) {
    now = i * frameMs;
    input.update(now);
    game.fixedUpdate(DT, input.state);
    game.fixedUpdate(DT, input.state);
    phases.add(game.phase);
    tutorial.update(now);
  }
  input.stop();
  return { finishedAt, shown, counts, steps: tutorial.stepCount, rolls: game.rolls.length, phases };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rig {
  tutorial: BowlTutorial;
  counts: TutorialCounts;
  probe: TutorialProbe;
  game: {
    phase: 'pickup' | 'aim' | 'rolling' | 'settle' | 'reset' | 'done';
    aimAngle: number;
    bowlerX: number;
    next: { frame: number; ball: number; pinsUp: number; freshRack: boolean; done: boolean };
    rolls: number[];
  };
  body: { tracking: boolean; problem: FrameProblem; hand: boolean; rejected?: RejectedMotion };
  finished: ReturnType<typeof vi.fn>;
  coach: ReturnType<typeof fakeCoach>;
}

function rig(mouse = false): Rig {
  const cfg = { ...bowlingConfig };
  const counts = createTutorialCounts();
  const probe: TutorialProbe = { gate: 0 };
  const finished = vi.fn();
  const coach = fakeCoach();
  const game: Rig['game'] = {
    phase: 'pickup',
    aimAngle: 0,
    bowlerX: 0,
    next: { frame: 0, ball: 0, pinsUp: 10, freshRack: true, done: false },
    rolls: [],
  };
  const body: Rig['body'] = { tracking: true, problem: 'none', hand: true };
  const view: BodyView = {
    tracking: () => body.tracking,
    problem: () => body.problem,
    handPresent: () => body.hand,
    rejected: () => body.rejected,
  };
  const tutorial = createBowlTutorial({
    cfg,
    coach: coach.coach,
    game,
    counts,
    mouse,
    body: mouse ? null : view,
    probe,
    onFinished: finished,
  });
  return { tutorial, counts, probe, game, body, finished, coach };
}

function clock(t: Rig): (ms: number) => void {
  let now = 0;
  return (ms: number): void => {
    for (const end = now + ms; now < end;) {
      now += 50;
      t.tutorial.update(now);
    }
  };
}

describe('bowling tutorial (camera)', () => {
  it('the bot completes every step on several lanes', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = simulate(seed, 150);
      expect(r.finishedAt, `seed ${seed}`).toBeGreaterThan(0);
      expect(r.shown.length, `seed ${seed}`).toBe(7);
      expect(r.counts.launches, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(r.phases.has('done')).toBe(false);
    }
  }, 60_000); // four whole tutorials through the real tracking pipeline

  it('shows the steps in the planned order, one short line each', () => {
    // Seed 2's first ball leaves pins standing; seed 1 opens with a strike (next test).
    const r = simulate(2, 150);
    expect(r.shown).toEqual([
      'Stand so I can see your whole body',
      'Close your fist to pick up the ball',
      'Step or move your hand to line up the arrows',
      'Swing back, then forward, and let go to bowl',
      'Knock down what is left',
      'Curve your swing to hook the ball',
      'Bowl one more frame for fun',
    ]);
    for (const line of r.shown) expect(line.length).toBeLessThan(50);
  }, 30_000);

  it('after a strike on the first ball the next step does not talk about what is left', () => {
    const r = simulate(1, 150);
    expect(r.finishedAt).toBeGreaterThan(0);
    expect(r.shown[4]).toBe('A strike! Bowl again');
    expect(r.shown).not.toContain('Knock down what is left');
  }, 30_000);

  it('step 1 says what it cannot see, only after a pause', () => {
    const t = rig();
    t.body.tracking = false;
    t.body.problem = 'lost';
    const fb = t.coach.coach.setFeedback;
    t.tutorial.update(0);
    t.tutorial.update(1000);
    expect(fb).toHaveBeenLastCalledWith(null);
    t.tutorial.update(2600);
    expect(fb).toHaveBeenLastCalledWith("I can't see you. Step back a little");
    t.body.problem = 'step-closer';
    t.tutorial.update(2700);
    expect(fb).toHaveBeenLastCalledWith('Step a little closer');
    t.body.tracking = true;
    t.body.problem = 'none';
    t.tutorial.update(2800);
    t.tutorial.update(3600);
    expect(t.coach.coach.confirm).toHaveBeenCalledTimes(1);
  });

  it('the swing step explains a weak or missing swing and a hand it cannot see', () => {
    const t = rig();
    const run = clock(t);
    t.game.phase = 'aim';
    for (let i = 0; i < 3; i++) {
      t.coach.pressSkip();
      run(100);
    }
    expect(t.tutorial.step).toBe(3);
    run(3000);
    const fb = t.coach.coach.setFeedback;
    expect(fb).toHaveBeenLastCalledWith('Draw your arm further back first');
    t.counts.windups++;
    run(100);
    expect(fb).toHaveBeenLastCalledWith('Swing forward and let go');
    t.counts.weak++;
    run(100);
    expect(fb).toHaveBeenLastCalledWith('Swing a bit faster');
    t.body.hand = false;
    run(100);
    expect(fb).toHaveBeenLastCalledWith("I can't see your arm");
    t.body.hand = true;
    t.body.rejected = { seq: 1, t: 0, kind: 'throw', reason: 'steep', speed: 3, hand: 'right' };
    run(100);
    expect(fb).toHaveBeenLastCalledWith('Swing low and forward, like a real bowler');
  });

  it('a gutter gets a friendly line on the later steps', () => {
    const t = rig();
    const run = clock(t);
    t.counts.pickups = 1;
    t.counts.launches = 1;
    t.game.phase = 'settle';
    t.game.rolls = [0];
    for (let i = 0; i < 3; i++) {
      t.coach.pressSkip();
      run(100);
    }
    expect(t.tutorial.step).toBe(3);
    t.coach.pressSkip();
    run(100);
    expect(t.tutorial.step).toBe(4);
    t.counts.lastKind = 'gutter';
    run(3000);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith(
      'That went in the gutter. Aim nearer the middle',
    );
  });

  it('the bot probe gates the bot step by step and stays open', () => {
    const t = rig();
    const run = clock(t);
    run(50);
    expect(t.probe.gate).toBe(0);
    run(2000);
    expect(t.probe.gate).toBe(1);
    t.counts.pickups = 1;
    run(2000);
    expect(t.probe.gate).toBe(2);
    t.coach.pressSkip();
    run(100);
    expect(t.probe.gate).toBe(3);
    t.coach.pressSkip();
    run(100);
    expect(t.probe.gate).toBe(3);
  });

  it('a skipped step moves on, and skipping the last one finishes once', () => {
    const t = rig();
    t.tutorial.update(0);
    for (let i = 0; i < 7; i++) {
      t.coach.pressSkip();
      t.tutorial.update(100 + i * 16);
      t.tutorial.update(110 + i * 16);
    }
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.tutorial.dispose();
    expect(t.coach.coach.hide).toHaveBeenCalled();
  });

  it('the free frame needs a whole frame: nothing in flight, the next ball opens a frame', () => {
    const t = rig();
    const run = clock(t);
    t.counts.pickups = 1;
    t.counts.launches = 1;
    t.game.rolls = [3];
    t.game.next = { frame: 0, ball: 1, pinsUp: 7, freshRack: false, done: false };
    for (let i = 0; i < 6; i++) {
      t.coach.pressSkip();
      run(100);
    }
    expect(t.tutorial.step).toBe(6);
    // The second ball of the open frame goes and is counted: the frame is done.
    t.counts.launches = 2;
    run(1000);
    expect(t.tutorial.step).toBe(6);
    t.game.rolls = [3, 4];
    t.game.next = { frame: 1, ball: 0, pinsUp: 10, freshRack: true, done: false };
    run(3000);
    expect(t.tutorial.finished).toBe(true);
  });
});

describe('bowling tutorial (mouse)', () => {
  it('has the five mouse steps and names the mouse actions', () => {
    const t = rig(true);
    expect(t.tutorial.stepCount).toBe(5);
    t.tutorial.update(0);
    expect(t.coach.shown[0]).toBe('Move the mouse to line up the arrows');
    t.tutorial.update(2700);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Move the pointer across the lane');
  });

  it('counts the aim, the press, the let go, a second ball and a frame', () => {
    const t = rig(true);
    const run = clock(t);
    run(100);
    expect(t.tutorial.step).toBe(0);
    t.game.aimAngle = 0.02;
    run(100);
    t.game.aimAngle = -0.02;
    run(3000);
    expect(t.tutorial.step).toBe(1);
    t.counts.pickups = 1;
    t.game.phase = 'aim';
    run(3000);
    expect(t.tutorial.step).toBe(2);
    run(2800);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Let go of the button to bowl');
    t.counts.launches = 1;
    t.game.phase = 'rolling';
    run(3000);
    // Launched, but not scored yet: the step waits for the ball to land.
    expect(t.tutorial.step).toBe(2);
    t.game.rolls = [3];
    run(3000);
    expect(t.tutorial.step).toBe(3);
    t.counts.launches = 2;
    run(3000);
    expect(t.tutorial.step).toBe(4);
    t.counts.launches = 3;
    t.game.rolls = [3, 4, 10];
    t.game.next = { frame: 2, ball: 0, pinsUp: 10, freshRack: true, done: false };
    run(3000);
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
  });
});

describe('bowling tutorial, the step after the first ball depends on its result', () => {
  function toStepAfterFirstBall(mouse: boolean, kind: 'strike' | 'open') {
    const t = rig(mouse);
    const run = clock(t);
    t.counts.pickups = 1;
    t.counts.launches = 1;
    t.game.rolls = [kind === 'strike' ? 10 : 6];
    t.counts.lastKind = kind === 'strike' ? 'strike' : 'count';
    t.game.next =
      kind === 'strike'
        ? { frame: 1, ball: 0, pinsUp: 10, freshRack: true, done: false }
        : { frame: 0, ball: 1, pinsUp: 4, freshRack: false, done: false };
    const target = mouse ? 3 : 4;
    for (let i = 0; i < target; i++) {
      t.coach.pressSkip();
      run(100);
    }
    expect(t.tutorial.step).toBe(target);
    return t;
  }

  it.each([false, true])('a strike says so and asks for another ball (mouse %s)', (mouse) => {
    const t = toStepAfterFirstBall(mouse, 'strike');
    expect(t.coach.shown.at(-1)).toBe('A strike! Bowl again');
    expect(t.coach.details.at(-1)).toContain('clears every pin');
    // The next ball completes it, as before.
    t.counts.launches = 2;
    t.game.rolls = [10, 3];
    const run = clock(t);
    run(3000);
    expect(t.tutorial.step).toBeGreaterThan(mouse ? 3 : 4);
  });

  it.each([false, true])('anything else keeps "knock down what is left" (mouse %s)', (mouse) => {
    const t = toStepAfterFirstBall(mouse, 'open');
    expect(t.coach.shown.at(-1)).toBe('Knock down what is left');
  });

  it('the swing step waits for the first ball to be scored, not just launched', () => {
    const t = rig();
    const run = clock(t);
    t.game.phase = 'aim';
    for (let i = 0; i < 3; i++) {
      t.coach.pressSkip();
      run(100);
    }
    expect(t.tutorial.step).toBe(3);
    t.counts.launches = 1;
    t.game.phase = 'rolling';
    run(3000);
    expect(t.tutorial.step).toBe(3);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith(null);
    t.game.rolls = [10];
    run(3000);
    expect(t.tutorial.step).toBe(4);
  });
});
