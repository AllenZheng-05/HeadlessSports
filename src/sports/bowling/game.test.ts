import { describe, expect, it } from 'vitest';
import { bowlingConfig } from './config';
import { BowlingGame, rollBanner } from './game';
import type { GameEvents, PlayerView, RollOutcome } from './game';
import type { BowlingPhysics } from './physics';

const DT = 1 / 120;

/** Scripted physics: each launch knocks down the next number from `plan`. */
class FakePhysics implements BowlingPhysics {
  plan: number[] = [];
  standing = 0;
  ballActive = false;
  ballX = 0;
  ballY = 0.1;
  ballZ = -1;
  ballSpeed = 0;
  ballInGutter = false;
  contacted = false;
  racked = 0;
  swept = 0;
  launches: { x: number; speed: number; angle: number; hook: number }[] = [];
  private t = 0;
  private contactGiven = false;
  private down = 0;

  rack(fresh: boolean): void {
    if (fresh) {
      this.standing = 10;
      this.racked++;
    } else this.swept++;
  }
  launch(x: number, speed: number, angle: number, hook: number): void {
    this.launches.push({ x, speed, angle, hook });
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

function view(
  over: Partial<{ known: boolean; present: boolean; speed: number; wristY: number }> = {},
): PlayerView {
  const o = { known: true, present: true, speed: 0, wristY: -1.2, ...over };
  const hand = { present: o.present, known: o.known };
  const arm = { speed: o.speed, wristY: o.wristY };
  return { lateral: 0, hands: { left: hand, right: hand }, arms: { left: arm, right: arm } };
}

function setup(plan: number[], frames = 10, hand: 'left' | 'right' = 'right') {
  const physics = new FakePhysics();
  physics.plan = plan;
  const outcomes: RollOutcome[] = [];
  const phases: string[] = [];
  let finished: { total: number; rolls: readonly number[] }[] = [];
  const events: GameEvents = {
    phase: (n) => phases.push(n),
    rolled: (o) => outcomes.push(o),
    finished: (total, rolls) => finished.push({ total, rolls }),
  };
  const game = new BowlingGame(physics, { ...bowlingConfig }, events, { hand, frames });
  game.start();
  const state = { view: view() };
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) game.fixedUpdate(DT, state.view);
  };
  const throwIt = (
    speed = 6,
    hand2: 'left' | 'right' = hand,
    style: 'underarm' | 'overarm' = 'underarm',
  ) => game.onThrow({ hand: hand2, speed, lateral: 0.62, curvature: 0, style });
  /** One whole ball: pick up, release, wait for the result and the reset. */
  const playBall = (): void => {
    game.onFistClosed(hand);
    throwIt();
    run(5);
  };
  return {
    physics,
    game,
    outcomes,
    phases,
    run,
    state,
    throwIt,
    playBall,
    finished: () => finished,
    resetFinished: () => (finished = []),
  };
}

describe('pickup', () => {
  it('starts in pickup and racks the pins', () => {
    const t = setup([]);
    expect(t.game.phase).toBe('pickup');
    expect(t.physics.standing).toBe(10);
  });

  it('picks up on a fist from the throwing hand only', () => {
    const t = setup([]);
    t.game.onFistClosed('left');
    expect(t.game.phase).toBe('pickup');
    t.game.onFistClosed('right');
    expect(t.game.phase).toBe('aim');
  });

  it('picks up with the left hand for a left-hander', () => {
    const t = setup([], 10, 'left');
    t.game.onFistClosed('right');
    expect(t.game.phase).toBe('pickup');
    t.game.onFistClosed('left');
    expect(t.game.phase).toBe('aim');
  });

  it('picks up by holding still and low when the fist is not known', () => {
    const t = setup([]);
    t.state.view = view({ known: false });
    t.run(1.2);
    expect(t.game.phase).toBe('pickup');
    t.run(0.4);
    expect(t.game.phase).toBe('aim');
  });

  it('also falls back when the hand is not present', () => {
    const t = setup([]);
    t.state.view = view({ present: false });
    t.run(1.6);
    expect(t.game.phase).toBe('aim');
  });

  it('does not use the fallback while the fist is readable', () => {
    const t = setup([]);
    t.run(3);
    expect(t.game.phase).toBe('pickup');
  });

  it('restarts the hold when the hand moves or rises above the shoulder', () => {
    const t = setup([]);
    t.state.view = view({ known: false });
    t.run(1.0);
    t.state.view = view({ known: false, speed: 2 });
    t.run(0.1);
    t.state.view = view({ known: false });
    t.run(1.0);
    expect(t.game.phase).toBe('pickup');
    t.state.view = view({ known: false, wristY: 0.4 });
    t.run(2);
    expect(t.game.phase).toBe('pickup');
  });
});

describe('throws', () => {
  it('ignores throws in pickup, rolling and settle', () => {
    const t = setup([5]);
    expect(t.throwIt()).toBe(false);
    expect(t.physics.launches).toHaveLength(0);
    t.game.onFistClosed('right');
    expect(t.throwIt()).toBe(true);
    expect(t.throwIt()).toBe(false);
    expect(t.physics.launches).toHaveLength(1);
    t.run(2.2);
    expect(t.game.phase).toBe('settle');
    expect(t.throwIt()).toBe(false);
  });

  it('ignores the other hand and slow releases', () => {
    const t = setup([5]);
    t.game.onFistClosed('right');
    expect(t.throwIt(6, 'left')).toBe(false);
    expect(t.throwIt(bowlingConfig.minReleaseSpeed - 0.1)).toBe(false);
    expect(t.game.phase).toBe('aim');
    expect(t.throwIt(bowlingConfig.minReleaseSpeed)).toBe(true);
  });

  it('accepts overarm style by default and rejects it when asked to', () => {
    const t = setup([5]);
    t.game.onFistClosed('right');
    expect(t.throwIt(6, 'right', 'overarm')).toBe(true);
    const u = setup([5]);
    const cfg = { ...bowlingConfig, acceptAnyStyle: false };
    const g = new BowlingGame(u.physics, cfg, {}, { hand: 'right', frames: 10 });
    g.start();
    g.onFistClosed('right');
    expect(
      g.onThrow({ hand: 'right', speed: 6, lateral: 0.6, curvature: 0, style: 'overarm' }),
    ).toBe(false);
    expect(
      g.onThrow({ hand: 'right', speed: 6, lateral: 0.6, curvature: 0, style: 'underarm' }),
    ).toBe(true);
  });

  it('launches from the bowler position with the mapped release', () => {
    const t = setup([5]);
    t.state.view = { ...view(), lateral: 1 };
    t.game.onFistClosed('right');
    t.run(1);
    t.game.onThrow({
      hand: 'right',
      speed: 8,
      lateral: 0.62 + 0.5,
      curvature: 0.3,
      style: 'underarm',
    });
    const l = t.physics.launches[0];
    expect(l?.x).toBeGreaterThan(0.2);
    expect(l?.speed).toBeCloseTo(bowlingConfig.maxBallSpeed);
    expect(l?.angle).toBeGreaterThan(0);
    expect(l?.hook).toBeGreaterThan(0);
  });
});

describe('frames', () => {
  it('goes through the phases and counts the pins', () => {
    const t = setup([7, 3]);
    t.playBall();
    expect(t.outcomes[0]).toMatchObject({ pins: 7, kind: 'count', frame: 0, ball: 0 });
    expect(t.game.phase).toBe('pickup');
    expect(t.phases.slice(0, 6)).toEqual(['pickup', 'aim', 'rolling', 'settle', 'reset', 'pickup']);
    // The second ball keeps the 3 standing pins: no fresh rack.
    expect(t.physics.racked).toBe(1);
    expect(t.physics.swept).toBe(1);
    expect(t.game.next).toMatchObject({ frame: 0, ball: 1, pinsUp: 3 });
    t.playBall();
    expect(t.outcomes[1]).toMatchObject({ pins: 3, kind: 'spare', frame: 0, ball: 1 });
    expect(t.game.next).toMatchObject({ frame: 1, ball: 0, pinsUp: 10 });
    expect(t.physics.racked).toBe(2);
  });

  it('skips the second ball after a strike', () => {
    const t = setup([10, 4]);
    t.playBall();
    expect(t.outcomes[0]).toMatchObject({ pins: 10, kind: 'strike' });
    expect(t.game.next).toMatchObject({ frame: 1, ball: 0 });
    expect(t.game.strikes).toBe(1);
  });

  it('counts 0 then 10 as a spare, not a strike', () => {
    const t = setup([0, 10, 10]);
    t.playBall();
    expect(t.outcomes[0]?.kind).toBe('miss');
    t.playBall();
    expect(t.outcomes[1]).toMatchObject({ pins: 10, kind: 'spare', frame: 0, ball: 1 });
    expect(rollBanner(t.outcomes[1]!)).toBe('Spare!');
    expect(t.game.strikes).toBe(0);
    expect(t.game.spares).toBe(1);
    // The next frame starts on a fresh rack: a clean sweep there is a strike.
    t.playBall();
    expect(t.outcomes[2]).toMatchObject({ pins: 10, kind: 'strike', frame: 1, ball: 0 });
    expect(rollBanner(t.outcomes[2]!)).toBe('Strike!');
    expect(t.game.strikes).toBe(1);
    expect(t.game.spares).toBe(1);
  });

  it('counts tenth-frame X, 0, 10 as a spare and a fresh-rack ball as a strike', () => {
    // Nine open frames of 0 0, then X, 0, 10.
    const t = setup([...new Array<number>(18).fill(0), 10, 0, 10]);
    for (let i = 0; i < 21; i++) t.playBall();
    const tenth = t.outcomes.slice(18);
    expect(tenth.map((o) => o.kind)).toEqual(['strike', 'miss', 'spare']);
    expect(t.game.strikes).toBe(1);
    expect(t.game.spares).toBe(1);
    // X after a tenth-frame spare is a strike again (fresh rack).
    const u = setup([...new Array<number>(18).fill(0), 4, 6, 10]);
    for (let i = 0; i < 21; i++) u.playBall();
    expect(u.outcomes.slice(18).map((o) => o.kind)).toEqual(['count', 'spare', 'strike']);
  });

  it('reports a gutter or a miss when nothing falls', () => {
    const t = setup([0, 0]);
    t.physics.ballInGutter = true;
    t.playBall();
    expect(t.outcomes[0]?.kind).toBe('gutter');
    t.physics.ballInGutter = false;
    t.playBall();
    expect(t.outcomes[1]?.kind).toBe('miss');
  });

  it('plays the tenth frame with bonus balls and finishes once with the total', () => {
    // Nine strikes, then X X X in the tenth: a perfect game.
    const t = setup(new Array<number>(12).fill(10));
    for (let i = 0; i < 12; i++) {
      expect(t.game.phase).toBe('pickup');
      t.playBall();
    }
    expect(t.game.next.done).toBe(true);
    expect(t.game.phase).toBe('done');
    t.run(2);
    expect(t.finished()).toHaveLength(1);
    expect(t.finished()[0]?.total).toBe(300);
    t.run(5);
    expect(t.finished()).toHaveLength(1);
  });

  it('gives a tenth-frame spare one bonus ball', () => {
    const plan = [...new Array<number>(18).fill(0), 6, 4, 5];
    const t = setup(plan);
    for (let i = 0; i < 20; i++) t.playBall();
    expect(t.game.phase).toBe('pickup');
    expect(t.game.next).toMatchObject({ frame: 9, ball: 2, pinsUp: 10 });
    t.playBall();
    expect(t.game.phase).toBe('done');
    t.run(2);
    expect(t.finished()[0]?.total).toBe(10 + 5);
  });

  it('plays a short game of two frames with tenth-frame rules on the last', () => {
    const t = setup([10, 10, 10, 10], 2);
    for (let i = 0; i < 4; i++) t.playBall();
    expect(t.game.phase).toBe('done');
    t.run(2);
    expect(t.finished()[0]?.total).toBe(60);
    expect(t.game.rolls).toEqual([10, 10, 10, 10]);
  });

  it('ends a short game after two open balls in the last frame', () => {
    const t = setup([3, 4, 2, 2], 2);
    for (let i = 0; i < 4; i++) t.playBall();
    t.run(2);
    expect(t.finished()[0]?.total).toBe(11);
  });

  it('times out when the pins never rest', () => {
    const t = setup([4]);
    t.physics.pinsAtRest = () => false;
    t.game.onFistClosed('right');
    t.throwIt();
    t.run(7.5);
    expect(t.game.phase).toBe('rolling');
    t.run(2.6);
    expect(t.game.phase).not.toBe('rolling');
    expect(t.outcomes[0]?.pins).toBe(4);
  });
});
