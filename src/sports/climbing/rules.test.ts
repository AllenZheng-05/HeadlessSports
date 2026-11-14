import { beforeEach, describe, expect, it } from 'vitest';
import { climbingConfig } from './config';
import type { ClimbingConfig } from './config';
import { KIND_CRIMP, KIND_JUG } from './layout';
import type { HoldField } from './layout';
import { wallToHand } from './reach';
import { createClimbState, createStepInput, heightOf, shoulderDrop, step } from './rules';
import type { ClimbState, StepInput } from './rules';

const DT = 1 / 120;

/** A handful of explicit holds, the ground and ledges every 20 m. */
class TestField implements HoldField {
  holds: { x: number; y: number; kind: number }[] = [];
  constructor(private readonly cfg: ClimbingConfig) {}
  add(x: number, y: number, kind = KIND_JUG): number {
    this.holds.push({ x, y, kind });
    return this.holds.length - 1;
  }
  findNearest(x: number, y: number, skipA: number, skipB: number): number {
    let best = -1;
    let bestD = Infinity;
    this.holds.forEach((h, i) => {
      if (i === skipA || i === skipB) return;
      const r = h.kind === KIND_CRIMP ? this.cfg.crimpRadius : this.cfg.jugRadius;
      const d = (h.x - x) ** 2 + (h.y - y) ** 2;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
  holdX(i: number): number {
    return this.holds[i]!.x;
  }
  holdY(i: number): number {
    return this.holds[i]!.y;
  }
  holdKind(i: number): number {
    return this.holds[i]!.kind;
  }
  standLevel(feetY: number): number {
    const k = Math.max(0, Math.round(feetY / 20));
    const d = feetY - k * 20;
    return d >= -0.15 && d <= 0.3 ? k * 20 : -1;
  }
}

let cfg: ClimbingConfig;
let field: TestField;
let state: ClimbState;
let input: StepInput;
let drop: number;

const run = (seconds: number): void => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) step(state, cfg, field, input, DT);
};

/** Image position that puts the hand's cursor on the wall point (relative to the climber). */
const aim = (hand: 'left' | 'right', relX: number, relY: number): void => {
  const p = wallToHand(cfg, relX, relY, { x: 0, y: 0 });
  input[hand].x = p.x;
  input[hand].y = p.y;
};

beforeEach(() => {
  cfg = { ...climbingConfig };
  field = new TestField(cfg);
  state = createClimbState(cfg, 75);
  input = createStepInput();
  drop = shoulderDrop(cfg);
});

describe('grabbing', () => {
  it('needs a fresh close with the cursor inside the grab radius', () => {
    const h = field.add(0.3, drop + 0.5);
    // Closed far from the hold: nothing.
    aim('right', 0.3, 0.9);
    input.right.closed = true;
    run(0.1);
    expect(state.right.holding).toBe(false);
    // Slides onto the hold after the grab window has passed: still nothing.
    run(0.4);
    aim('right', 0.3, 0.5);
    run(0.3);
    expect(state.right.holding).toBe(false);
    // Open, then close on it: grabbed.
    input.right.closed = false;
    run(0.05);
    input.right.closed = true;
    run(0.05);
    expect(state.right.holding).toBe(true);
    expect(state.right.hold).toBe(h);
    expect(state.status).toBe('climbing');
    expect(state.grabs).toBe(1);
  });

  it('still grabs when the cursor arrives inside the short window after the close', () => {
    field.add(0.3, drop + 0.5);
    aim('right', 0.3, 0.9);
    input.right.closed = true;
    run(0.1);
    aim('right', 0.3, 0.5);
    run(0.05);
    expect(state.right.holding).toBe(true);
  });

  it('grabs the nearest hold in range and not outside the radius', () => {
    const far = field.add(0.3 + 0.15, drop + 0.5);
    const near = field.add(0.3 + 0.03, drop + 0.5);
    aim('right', 0.3, 0.5);
    input.right.closed = true;
    run(0.05);
    expect(state.right.hold).toBe(near);
    expect(far).not.toBe(near);
    input.right.closed = false;
    run(0.05);
    aim('right', 0.3 + 0.3, 0.5);
    input.right.closed = true;
    run(0.05);
    expect(state.right.holding).toBe(false);
  });

  it('uses the smaller radius for a crimp', () => {
    field.add(0.3, drop + 0.5, KIND_CRIMP);
    aim('right', 0.3 + 0.14, 0.5);
    input.right.closed = true;
    run(0.05);
    expect(state.right.holding).toBe(false);
  });

  it('does not let both hands take the same hold', () => {
    field.add(0, drop + 0.5);
    aim('left', 0, 0.5);
    aim('right', 0, 0.5);
    input.left.closed = true;
    run(0.05);
    input.right.closed = true;
    run(0.05);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(false);
  });
});

describe('climbing', () => {
  const holdWith = (hand: 'left' | 'right', hx: number, hy: number): void => {
    field.add(hx, hy);
    aim(hand, hx - state.x, hy - state.y);
    input[hand].closed = true;
    run(0.05);
    expect(state[hand].holding).toBe(true);
  };

  it('raises the climber by d * reachHeight when the closed hand moves down by d', () => {
    holdWith('right', 0.2, drop + 0.5);
    run(1);
    const before = state.y;
    input.right.y += 0.2;
    run(1);
    expect(state.y - before).toBeCloseTo(0.2 * cfg.reachHeight, 2);
    // The hold stays under the hand.
    expect(state.x + state.right.cursorX).toBeCloseTo(0.2, 2);
    expect(state.y + state.right.cursorY).toBeCloseTo(drop + 0.5, 2);
  });

  it('shifts the climber sideways the other way when the hand moves sideways', () => {
    holdWith('right', 0.2, drop + 0.5);
    run(1);
    const before = state.x;
    input.right.x += 0.1;
    run(1);
    expect(state.x - before).toBeCloseTo(-0.1 * cfg.reachWidth, 2);
  });

  it('averages the two solutions when both hands hold', () => {
    holdWith('left', -0.3, drop + 0.5);
    holdWith('right', 0.3, drop + 0.5);
    run(1);
    const before = state.y;
    input.right.y += 0.2; // alone this would raise the climber 0.3 m
    run(1.5);
    expect(state.y - before).toBeCloseTo(0.15, 2);
  });

  it('lets go when the hand opens, and a lost hand holds for the grace period', () => {
    holdWith('right', 0.2, drop + 0.5);
    input.right.closed = false;
    run(0.02);
    expect(state.right.holding).toBe(false);
    expect(state.lastRelease).toBe('open');

    input.right.closed = true;
    input.right.x = wallToHand(cfg, 0.2 - state.x, 0, { x: 0, y: 0 }).x;
    aim('right', 0.2 - state.x, drop + 0.5 - state.y);
    run(0.05);
    expect(state.right.holding).toBe(true);
    input.right.present = false;
    run(cfg.lostHandGraceMs / 1000 - 0.05);
    expect(state.right.holding).toBe(true);
    run(0.15);
    expect(state.right.holding).toBe(false);
    expect(state.lastRelease).toBe('lost');
  });

  it('keeps the hold under the hand while it is briefly lost', () => {
    holdWith('right', 0.2, drop + 0.5);
    run(0.5);
    const y = state.y;
    input.right.present = false;
    input.right.y += 0.3; // garbage while lost: ignored
    run(0.3);
    expect(state.y).toBeCloseTo(y, 3);
  });

  it('limits the climber speed', () => {
    holdWith('right', 0.2, drop + 0.5);
    run(0.5);
    let maxSpeed = 0;
    input.right.y += 0.5; // a 0.75 m jump in one step
    for (let i = 0; i < 120; i++) {
      step(state, cfg, field, input, DT);
      maxSpeed = Math.max(maxSpeed, state.speed);
    }
    expect(maxSpeed).toBeLessThanOrEqual(cfg.maxClimbSpeed + 1e-6);
    expect(maxSpeed).toBeGreaterThan(cfg.maxClimbSpeed * 0.9);
  });

  it('clamps the climber to the wall', () => {
    holdWith('right', 0.2, drop + 0.5);
    input.right.x -= 0.4; // asks for +0.68 m
    run(0.5);
    input.right.x = 0.5;
    run(1);
    expect(Math.abs(state.x)).toBeLessThanOrEqual(cfg.wallHalfWidth + 1e-9);
  });

  it('lets go of a hold that ends up beyond reach', () => {
    holdWith('right', 0.2, drop + 0.5);
    state.y -= 2; // pretend the climber lagged far below
    step(state, cfg, field, input, DT);
    expect(state.right.holding).toBe(false);
    expect(state.lastRelease).toBe('reach');
  });
});

describe('slipping and falling', () => {
  const hangFrom = (): void => {
    field.add(0, drop + 3.5);
    state.y = drop + 3;
    aim('right', 0, 0.5);
    input.right.closed = true;
    run(0.05);
    expect(state.right.holding).toBe(true);
  };

  it('falls only after the coyote time and ends the round', () => {
    hangFrom();
    input.right.closed = false;
    run(cfg.slipGraceMs / 1000 - 0.05);
    expect(state.status).toBe('climbing');
    run(0.1);
    expect(state.status).toBe('fell');
    expect(state.endReason).toBe('slip');
    expect(state.falls).toBe(1);
  });

  it('forgives a re-grab inside the coyote time', () => {
    hangFrom();
    input.right.closed = false;
    run(0.2);
    input.right.closed = true;
    run(0.05);
    expect(state.right.holding).toBe(true);
    run(1);
    expect(state.status).toBe('climbing');
  });

  it('keeps the best height after the fall', () => {
    hangFrom();
    run(0.5);
    const best = state.best;
    expect(best).toBeGreaterThan(2.9);
    input.right.closed = false;
    run(2);
    expect(state.status).toBe('fell');
    expect(heightOf(state, cfg)).toBeLessThan(best);
    expect(state.best).toBe(best);
  });

  it('stands on the ground without hands and never slips', () => {
    field.add(0, drop + 0.5);
    aim('right', 0, 0.5);
    input.right.closed = true;
    run(0.05);
    input.right.closed = false;
    run(3);
    expect(state.status).toBe('climbing');
    expect(state.standing).toBe(true);
  });

  it('stands on a rest ledge without hands and refills stamina fast', () => {
    state.status = 'climbing';
    state.y = 20 + drop + 0.1;
    state.stamina = 0.2;
    run(1);
    expect(state.status).toBe('climbing');
    expect(state.standing).toBe(true);
    expect(heightOf(state, cfg)).toBeCloseTo(20, 6);
    expect(state.stamina).toBeCloseTo(0.2 + cfg.ledgeRefillPerSecond, 1);
  });
});

describe('stamina', () => {
  const hang = (hand: 'left' | 'right', kind: number, hx: number): void => {
    field.add(hx, drop + 3.5, kind);
    aim(hand, hx - state.x, drop + 3.5 - state.y);
    input[hand].closed = true;
    run(0.05);
    expect(state[hand].holding).toBe(true);
  };

  beforeEach(() => {
    state.y = drop + 3;
    state.status = 'climbing';
  });

  it('drains at the one-hand rate', () => {
    hang('right', KIND_JUG, 0.3);
    const s = state.stamina;
    run(2);
    expect(s - state.stamina).toBeCloseTo(cfg.drainOneHand * 2, 2);
  });

  it('drains 1.6x on a lone crimp', () => {
    hang('right', KIND_CRIMP, 0.3);
    const s = state.stamina;
    run(2);
    expect(s - state.stamina).toBeCloseTo(cfg.drainOneHand * cfg.crimpDrainMult * 2, 2);
  });

  it('drains at the two-hand rate while moving and refills slightly while still on two jugs', () => {
    hang('left', KIND_JUG, -0.3);
    hang('right', KIND_JUG, 0.3);
    state.stamina = 0.5;
    run(2);
    expect(state.stamina).toBeCloseTo(0.5 + cfg.restRefillPerSecond * 2, 2);
    // A crimp in the pair is not restful.
    state.left.hold = field.add(-0.3, drop + 3.5, KIND_CRIMP);
    state.stamina = 0.5;
    run(2);
    expect(0.5 - state.stamina).toBeCloseTo(cfg.drainTwoHands * 2, 2);
  });

  it('opens the hands by itself at zero and then slips', () => {
    hang('right', KIND_JUG, 0.3);
    state.stamina = 0.01;
    run(0.5);
    expect(state.right.holding).toBe(false);
    expect(state.lastRelease).toBe('stamina');
    expect(state.stamina).toBe(0);
    run(0.5);
    expect(state.status).toBe('fell');
    expect(state.endReason).toBe('stamina');
  });

  it('will not grab again with an empty tank', () => {
    state.stamina = 0;
    field.add(0.3, drop + 3.5);
    aim('right', 0.3 - state.x, drop + 3.5 - state.y);
    input.right.closed = true;
    run(0.1);
    expect(state.right.holding).toBe(false);
  });
});

describe('the round', () => {
  it('starts the clock at the first grab and ends the round on time', () => {
    cfg.roundSeconds = 2;
    state = createClimbState(cfg, 2);
    run(5);
    expect(state.elapsed).toBe(0);
    expect(state.status).toBe('ready');
    field.add(0.3, drop + 0.5);
    aim('right', 0.3, 0.5);
    input.right.closed = true;
    run(1);
    expect(state.status).toBe('climbing');
    expect(state.elapsed).toBeCloseTo(1, 1);
    run(1.2);
    expect(state.status).toBe('timeout');
    expect(state.endReason).toBe('time');
    const y = state.y;
    run(1);
    expect(state.y).toBe(y);
  });

  it('scores the best height, not the final height', () => {
    field.add(0.3, drop + 0.5);
    aim('right', 0.3, 0.5);
    input.right.closed = true;
    run(0.5);
    input.right.y += 0.3;
    run(1);
    const peak = heightOf(state, cfg);
    expect(peak).toBeGreaterThan(0.4);
    input.right.y -= 0.3; // back up the image: the climber lowers itself
    run(1);
    expect(heightOf(state, cfg)).toBeLessThan(peak - 0.3);
    expect(state.best).toBeCloseTo(peak, 2);
  });
});
