import { describe, expect, it } from 'vitest';
import { bowlingConfig } from './config';
import { BowlingGame, rollBanner } from './game';
import type { GameEvents, PlayerView, RollOutcome } from './game';
import type { BowlingPhysics } from './physics';

const DT = 1 / 120;

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

function view(
  over: Partial<{
    known: boolean;
    present: boolean;
    speed: number;
    wristX: number;
    wristY: number;
  }> = {},
): PlayerView {
  const o = { known: true, present: true, speed: 0, wristX: 0.12, wristY: -1.2, ...over };
  const hand = { present: o.present, known: o.known };
  const arm = { speed: o.speed, wristX: o.wristX, wristY: o.wristY };
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
    t.state.view = { ...view({ wristX: 0.62 }), lateral: 1 };
    t.game.onFistClosed('right');
    t.run(1);
    t.game.onThrow({
      hand: 'right',
      speed: 8,
      lateral: 0,
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

  it('times out when the pins never rest, 2.5 s after first contact', () => {
    const t = setup([4]);
    t.physics.pinsAtRest = () => false;
    t.game.onFistClosed('right');
    t.throwIt();
    // Contact is at 0.8 s in the fake physics.
    t.run(0.8 + bowlingConfig.settleTimeoutS - 0.1);
    expect(t.game.phase).toBe('rolling');
    t.run(0.3);
    expect(t.game.phase).not.toBe('rolling');
    expect(t.outcomes[0]?.pins).toBe(4);
  });
});

/** Seconds after launch at which the first new outcome arrives. */
function verdictTime(t: ReturnType<typeof setup>): number {
  const before = t.outcomes.length;
  t.game.onFistClosed('right');
  t.throwIt();
  let n = 0;
  while (t.outcomes.length === before && n < 20 * 120) {
    t.run(DT);
    n++;
  }
  return n * DT;
}

describe('early verdict', () => {
  it('commits the pin states once per scored roll', () => {
    const t = setup([7]);
    verdictTime(t);
    expect(t.physics.committed).toBe(1);
  });

  it('calls a strike the moment the last pin is down, before the pins rest', () => {
    const t = setup([10]);
    const at = verdictTime(t);
    expect(t.outcomes[0]).toMatchObject({ pins: 10, kind: 'strike' });
    // Contact at 0.8 s; the fake pins would not rest until 1.5 s.
    expect(at).toBeGreaterThan(0.79);
    expect(at).toBeLessThan(0.85);
    expect(t.game.phase).toBe('settle');
  });

  it('calls a spare at once too', () => {
    const t = setup([6, 4]);
    t.playBall();
    const at = verdictTime(t);
    expect(t.outcomes[1]).toMatchObject({ pins: 4, kind: 'spare' });
    expect(at).toBeLessThan(0.85);
  });

  it('ends a non-strike when the pins have rested for the rest window', () => {
    const t = setup([7]);
    const at = verdictTime(t);
    expect(t.outcomes[0]).toMatchObject({ pins: 7, kind: 'count' });
    // Rest starts at 1.5 s in the fake physics; the verdict follows settleRestS later.
    expect(at).toBeGreaterThanOrEqual(1.5 + bowlingConfig.settleRestS - 0.02);
    expect(at).toBeLessThan(1.5 + bowlingConfig.settleRestS + 0.05);
  });

  it('never waits past the cap after contact', () => {
    const t = setup([3]);
    t.physics.pinsAtRest = () => false;
    const at = verdictTime(t);
    expect(at).toBeLessThanOrEqual(0.8 + bowlingConfig.settleTimeoutS + 0.05);
    expect(at).toBeGreaterThanOrEqual(0.8 + bowlingConfig.settleTimeoutS - 0.05);
  });

  it('resolves a ball that passes the pins untouched almost at once', () => {
    const t = setup([0]);
    t.physics.ballInGutter = true;
    // No contact, never "done" or at rest: only passing the pins can end it.
    t.physics.takeContact = () => 0;
    t.physics.ballDone = () => false;
    t.physics.pinsAtRest = () => false;
    const at = verdictTime(t);
    expect(t.outcomes[0]?.kind).toBe('gutter');
    // The fake ball reaches z = head pin - 0.9 at (19.9 - 1) / 10 s.
    expect(at).toBeGreaterThan(1.89);
    expect(at).toBeLessThan(1.89 + bowlingConfig.missResolveS + 0.05);
  });

  it('reports the live count of pins down while rolling', () => {
    const physics = new FakePhysics();
    physics.plan = [6];
    const seen: number[] = [];
    const game = new BowlingGame(
      physics,
      { ...bowlingConfig },
      { pinsDown: (n) => seen.push(n) },
      { hand: 'right', frames: 10 },
    );
    game.start();
    game.onFistClosed('right');
    game.onThrow({ hand: 'right', speed: 6, lateral: 0.62, curvature: 0, style: 'underarm' });
    for (let i = 0; i < 4 * 120; i++) game.fixedUpdate(DT, view());
    expect(seen).toEqual([6]);
  });
});

describe('live aim', () => {
  it('follows a slow hand and reports the angle the ball will take', () => {
    const t = setup([5]);
    t.game.onFistClosed('right');
    t.run(0.5);
    expect(t.game.aimAngle).toBeCloseTo(0, 5);
    t.state.view = view({ wristX: 0.12 + 0.6 });
    t.run(1);
    expect(t.game.aimAngle).toBeCloseTo(0.6 * bowlingConfig.aimGain, 3);
    t.state.view = view({ wristX: 0.12 - 5 });
    t.run(1);
    expect(t.game.aimAngle).toBeCloseTo(-bowlingConfig.maxAngle, 5);
  });

  it('freezes once the swing starts and launches with exactly that aim', () => {
    const t = setup([5]);
    t.state.view = view({ wristX: 0.12 + 0.4 });
    t.game.onFistClosed('right');
    t.run(1);
    const shown = t.game.aimAngle;
    // The hand sweeps across during the swing; the aim must not follow it.
    t.state.view = view({ wristX: 2, speed: 5 });
    t.run(0.3);
    expect(t.game.aimAngle).toBeCloseTo(shown, 6);
    t.game.onThrow({ hand: 'right', speed: 6, lateral: -3, curvature: 0, style: 'underarm' });
    expect(t.physics.launches[0]?.angle).toBeCloseTo(shown, 6);
  });

  it('starts from where the hand is when the ball is picked up', () => {
    const t = setup([5]);
    t.state.view = view({ wristX: 0.12 + 0.5 });
    t.run(0.05);
    t.game.onFistClosed('right');
    expect(t.game.aimAngle).toBeCloseTo(0.5 * bowlingConfig.aimGain, 6);
  });

  it('mirrors for the left hand', () => {
    const t = setup([5], 10, 'left');
    t.state.view = view({ wristX: -0.12 - 0.5 });
    t.run(0.05);
    t.game.onFistClosed('left');
    expect(t.game.aimAngle).toBeCloseTo(-0.5 * bowlingConfig.aimGain, 6);
  });
});

describe('live aim, wind-up and bias', () => {
  it('locks the aim on a wind-up, then lets go after the hold', () => {
    const t = setup([5]);
    t.game.onFistClosed('right');
    t.run(0.5);
    const shown = t.game.aimAngle;
    t.game.onWindup('right');
    // A slow hand drifting while the throw is charged must not move the aim.
    t.state.view = view({ wristX: 0.12 + 0.8 });
    t.run(1);
    expect(t.game.aimAngle).toBeCloseTo(shown, 6);
    t.run(bowlingConfig.aimWindupHoldS);
    expect(t.game.aimAngle).toBeGreaterThan(shown + 0.01);
  });
});

describe('mouse play', () => {
  function mouseSetup(plan: number[] = [5, 4, 3, 2]) {
    const physics = new FakePhysics();
    physics.plan = plan;
    const seen = {
      picked: 0,
      released: [] as { ballSpeed: number; angle: number; hook: number }[],
    };
    const phases: string[] = [];
    const game = new BowlingGame(
      physics,
      { ...bowlingConfig },
      {
        phase: (n) => phases.push(n),
        pickedUp: () => seen.picked++,
        released: (r) => seen.released.push(r),
      },
      { hand: 'right', frames: 10, mouse: true },
    );
    game.start();
    const run = (s: number): void => {
      for (let i = 0; i < Math.round(s / DT); i++) game.fixedUpdate(DT, view());
    };
    return { physics, game, seen, phases, run };
  }

  it('a press gives the ball and starts the wind-up at once', () => {
    const t = mouseSetup();
    expect(t.game.mousePress()).toBe(true);
    expect(t.game.phase).toBe('aim');
    expect(t.seen.picked).toBe(1);
    t.run(1);
    expect(t.physics.launches).toHaveLength(0);
  });

  it('a release throws once at the fixed speed, the shown aim and no hook', () => {
    const t = mouseSetup();
    t.game.setMouseAim(0.02);
    t.game.mousePress();
    t.run(0.5);
    t.game.setMouseAim(-0.017);
    t.game.mouseRelease();
    t.run(0.05);
    expect(t.physics.launches).toHaveLength(1);
    const l = t.physics.launches[0];
    expect(l?.speed).toBe(bowlingConfig.mouseBallSpeed);
    expect(l?.angle).toBeCloseTo(-0.017, 9);
    expect(l?.hook).toBe(0);
    expect(l?.x).toBe(0);
    expect(t.game.aimAngle).toBeCloseTo(-0.017, 9);
    // Speed does not depend on the hold time.
    const u = mouseSetup();
    u.game.mousePress();
    u.run(3);
    u.game.mouseRelease();
    u.run(0.05);
    expect(u.physics.launches[0]?.speed).toBe(bowlingConfig.mouseBallSpeed);
    t.run(0.1);
    expect(t.physics.launches).toHaveLength(1);
  });

  it('clamps the aim to the max angle', () => {
    const t = mouseSetup();
    t.game.setMouseAim(1);
    expect(t.game.aimAngle).toBe(bowlingConfig.maxAngle);
    t.game.setMouseAim(-1);
    expect(t.game.aimAngle).toBe(-bowlingConfig.maxAngle);
  });

  it('a tap still plays the minimum back-swing, then throws', () => {
    const t = mouseSetup();
    t.game.mousePress();
    t.game.mouseRelease();
    t.run(bowlingConfig.mouseWindupMinS - 0.05);
    expect(t.physics.launches).toHaveLength(0);
    expect(t.game.phase).toBe('aim');
    t.run(0.1);
    expect(t.physics.launches).toHaveLength(1);
    expect(t.game.phase).toBe('rolling');
  });

  it('ignores a release with no press, and presses outside pickup', () => {
    const t = mouseSetup();
    t.game.mouseRelease();
    t.run(1);
    expect(t.game.phase).toBe('pickup');
    expect(t.physics.launches).toHaveLength(0);
    t.game.mousePress();
    t.game.mouseRelease();
    t.run(0.4);
    expect(t.game.phase).toBe('rolling');
    // Rolling, then settle and reset: presses do nothing.
    expect(t.game.mousePress()).toBe(false);
    t.run(2.5);
    expect(t.game.phase).toBe('settle');
    expect(t.game.mousePress()).toBe(false);
    t.run(bowlingConfig.settleHoldS);
    expect(t.game.phase).toBe('reset');
    expect(t.game.mousePress()).toBe(false);
    expect(t.physics.launches).toHaveLength(1);
    expect(t.seen.picked).toBe(1);
  });

  it('does not bowl the next ball from a release carried over from a missed press', () => {
    const t = mouseSetup();
    t.game.mousePress();
    t.game.mouseRelease();
    t.run(6);
    expect(t.game.phase).toBe('pickup');
    // A stray release now (the press was ignored during the reset) throws nothing.
    t.game.mouseRelease();
    t.run(1);
    expect(t.game.phase).toBe('pickup');
    expect(t.physics.launches).toHaveLength(1);
  });

  it('plays the next ball after a fresh press', () => {
    const t = mouseSetup();
    t.game.mousePress();
    t.game.mouseRelease();
    t.run(6);
    expect(t.game.phase).toBe('pickup');
    expect(t.game.mousePress()).toBe(true);
    t.game.mouseRelease();
    t.run(0.4);
    expect(t.physics.launches).toHaveLength(2);
  });

  it('turns the gesture entry points off', () => {
    const t = mouseSetup();
    t.game.onFistClosed('right');
    expect(t.game.phase).toBe('pickup');
    t.game.mousePress();
    t.game.onWindup('right');
    expect(
      t.game.onThrow({ hand: 'right', speed: 9, lateral: 0, curvature: 0.5, style: 'underarm' }),
    ).toBe(false);
    expect(t.physics.launches).toHaveLength(0);
  });

  it('does not pick up by holding still', () => {
    const t = mouseSetup();
    t.run(3);
    expect(t.game.phase).toBe('pickup');
  });
});
