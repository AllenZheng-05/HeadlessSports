import { beforeEach, describe, expect, it } from 'vitest';
import { climbingConfig } from './config';
import type { ClimbingConfig } from './config';
import { KIND_JUG } from './layout';
import type { HoldField } from './layout';
import { createPointerControl, pointerClick, pointerStep } from './pointer';
import type { PointerControl } from './pointer';
import { wallToHand } from './reach';
import { createClimbState, createStepInput, step } from './rules';
import type { ClimbState, StepInput } from './rules';

const DT = 1 / 120;

class Field implements HoldField {
  holds: { x: number; y: number }[] = [];
  constructor(private readonly cfg: ClimbingConfig) {}
  add(x: number, y: number): number {
    this.holds.push({ x, y });
    return this.holds.length - 1;
  }
  findNearest(x: number, y: number, skipA: number, skipB: number): number {
    let best = -1;
    let bestD = Infinity;
    this.holds.forEach((h, i) => {
      if (i === skipA || i === skipB) return;
      const d = (h.x - x) ** 2 + (h.y - y) ** 2;
      if (d <= this.cfg.jugRadius ** 2 && d < bestD) {
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
  holdKind(): number {
    return KIND_JUG;
  }
  standLevel(feetY: number): number {
    return feetY >= -0.15 && feetY <= 0.3 ? 0 : -1;
  }
}

let cfg: ClimbingConfig;
let field: Field;
let state: ClimbState;
let input: StepInput;
let ctl: PointerControl;
const img = { x: 0, y: 0 };

/** Click the mouse at a hold (its exact position), then let the game run. */
const clickHold = (i: number, seconds = 0.6): boolean => {
  wallToHand(cfg, field.holdX(i) - state.x, field.holdY(i) - state.y, img);
  const handled = pointerClick(ctl, state, cfg, field, img.x, img.y);
  run(seconds);
  return handled;
};

const run = (seconds: number): void => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    pointerStep(ctl, state, cfg, field, input, DT);
    step(state, cfg, field, input, DT);
  }
};

beforeEach(() => {
  cfg = { ...climbingConfig };
  field = new Field(cfg);
  state = createClimbState(cfg, 60);
  input = createStepInput();
  ctl = createPointerControl();
});

describe('click to grab', () => {
  it('grabs the clicked hold, keeps it after the click ends, and hands the mouse to the other hand', () => {
    const a = field.add(0.3, state.y + 0.5);
    expect(ctl.active).toBe(1);
    expect(clickHold(a)).toBe(true);
    expect(state.right.holding).toBe(true);
    expect(state.right.hold).toBe(a);
    expect(ctl.active).toBe(0);
    run(2);
    expect(state.right.holding).toBe(true);
  });

  it('a second click grabs with the other hand and leaves the first hand on the wall', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    clickHold(a);
    clickHold(b);
    expect(state.right.hold).toBe(a);
    expect(state.left.hold).toBe(b);
    expect(ctl.active).toBe(1);
  });

  it('a hand that already holds lets go of its old hold for the new one', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.8);
    const c = field.add(0.3, state.y + 1.2);
    clickHold(a);
    clickHold(b);
    const releases = state.releaseSeq;
    expect(clickHold(c, 0.8)).toBe(true);
    expect(state.right.hold).toBe(c);
    expect(state.releaseSeq).toBe(releases + 1);
    expect(state.left.hold).toBe(b);
    expect(state.left.holding).toBe(true);
    expect(ctl.active).toBe(0);
  });

  it('climbs hand over hand with a hand always on the wall', () => {
    const holds: number[] = [];
    for (let k = 0; k < 8; k++) {
      holds.push(field.add(k % 2 === 0 ? 0.3 : -0.3, state.y + 0.45 + k * 0.4));
    }
    const y0 = state.y;
    for (const h of holds) {
      clickHold(h);
      expect(state.left.holding || state.right.holding).toBe(true);
    }
    expect(state.left.holding && state.right.holding).toBe(true);
    expect(state.y - y0).toBeGreaterThan(1.5);
    expect(state.status).toBe('climbing');
  });

  it('a click that is not on a hold does nothing', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    clickHold(a);
    clickHold(b);
    const grabs = state.grabs;
    const releases = state.releaseSeq;
    const active = ctl.active;
    expect(pointerClick(ctl, state, cfg, field, 0.5, 0.95)).toBe(false);
    run(1);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(true);
    expect(state.grabs).toBe(grabs);
    expect(state.releaseSeq).toBe(releases);
    expect(ctl.active).toBe(active);
  });

  it('does not grab the hold the other hand is on', () => {
    const a = field.add(0.3, state.y + 0.5);
    clickHold(a);
    expect(clickHold(a)).toBe(false);
    expect(state.left.holding).toBe(false);
    expect(state.right.hold).toBe(a);
  });
});
