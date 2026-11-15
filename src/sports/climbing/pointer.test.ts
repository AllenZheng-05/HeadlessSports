import { beforeEach, describe, expect, it } from 'vitest';
import { climbingConfig } from './config';
import type { ClimbingConfig } from './config';
import { KIND_JUG } from './layout';
import type { HoldField } from './layout';
import { createPointerControl, pointerPress, pointerRelease, pointerStep } from './pointer';
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
/** Mouse position, mirrored image coordinates. */
const mouse = { x: 0.5, y: 0.5 };
const img = { x: 0, y: 0 };

const run = (seconds: number): void => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    pointerStep(ctl, state, cfg, field, input, mouse.x, mouse.y, DT);
    step(state, cfg, field, input, DT);
  }
};

/** Move the mouse onto a hold (as the hold appears now), press, and let the grab settle. */
const press = (i: number): boolean => {
  wallToHand(cfg, field.holdX(i) - state.x, field.holdY(i) - state.y, img);
  mouse.x = img.x;
  mouse.y = img.y;
  run(0.05);
  const ok = pointerPress(ctl, state, cfg, field, mouse.x, mouse.y);
  run(0.4);
  return ok;
};

/** Drag the mouse down by `dy` (image units) over `seconds`. */
const drag = (dy: number, seconds = 0.5, dx = 0): void => {
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    mouse.y += dy / n;
    mouse.x += dx / n;
    pointerStep(ctl, state, cfg, field, input, mouse.x, mouse.y, DT);
    step(state, cfg, field, input, DT);
  }
  run(0.3);
};

beforeEach(() => {
  cfg = { ...climbingConfig };
  field = new Field(cfg);
  state = createClimbState(cfg, 60);
  input = createStepInput();
  ctl = createPointerControl();
  mouse.x = 0.5;
  mouse.y = 0.5;
});

describe('press, drag, release', () => {
  it('grabs the pressed hold with the selected hand', () => {
    const a = field.add(0.3, state.y + 0.5);
    expect(ctl.active).toBe(1);
    expect(press(a)).toBe(true);
    expect(state.right.holding).toBe(true);
    expect(state.right.hold).toBe(a);
    expect(ctl.dragging).toBe(true);
    expect(ctl.active).toBe(1);
  });

  it('dragging the mouse down pulls the body up while the hand stays on the hold', () => {
    const a = field.add(0.3, state.y + 0.5);
    press(a);
    const y0 = state.y;
    drag(0.3);
    expect(state.y - y0).toBeGreaterThan(0.3);
    expect(state.right.holding).toBe(true);
    expect(state.right.hold).toBe(a);
    // Dragging up lowers the body again, but never below the floor.
    drag(-0.9);
    expect(state.y).toBeGreaterThanOrEqual(y0 - 1e-6);
  });

  it('dragging sideways shifts the body sideways', () => {
    const a = field.add(0.3, state.y + 0.5);
    press(a);
    const x0 = state.x;
    drag(0, 0.5, 0.1);
    expect(state.x).toBeLessThan(x0 - 0.05);
  });

  it('releasing keeps the grip and switches to the other hand', () => {
    const a = field.add(0.3, state.y + 0.5);
    press(a);
    drag(0.2);
    const releases = state.releaseSeq;
    expect(pointerRelease(ctl)).toBe(true);
    run(2);
    expect(ctl.active).toBe(0);
    expect(state.right.holding).toBe(true);
    expect(state.right.hold).toBe(a);
    expect(state.releaseSeq).toBe(releases);
  });

  it('the free hand follows the mouse while the other one keeps gripping', () => {
    const a = field.add(0.3, state.y + 0.5);
    press(a);
    pointerRelease(ctl);
    mouse.x = 0.3;
    mouse.y = 0.4;
    run(0.5);
    expect(state.right.holding).toBe(true);
    expect(state.left.holding).toBe(false);
    expect(state.left.cursorX).toBeCloseTo((0.3 - 0.5) * cfg.reachWidth, 3);
  });

  it('the other hand grabs a second hold and the first hand never lets go', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    press(a);
    drag(0.1);
    pointerRelease(ctl);
    const releases = state.releaseSeq;
    expect(press(b)).toBe(true);
    expect(state.left.hold).toBe(b);
    expect(state.right.hold).toBe(a);
    expect(state.releaseSeq).toBe(releases);
  });

  it('a hand that already holds lets go of its old hold for the new one', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.8);
    const c = field.add(0.3, state.y + 1.0);
    press(a);
    pointerRelease(ctl);
    press(b);
    pointerRelease(ctl);
    const releases = state.releaseSeq;
    expect(ctl.active).toBe(1);
    expect(press(c)).toBe(true);
    expect(state.right.hold).toBe(c);
    expect(state.releaseSeq).toBe(releases + 1);
    expect(state.left.hold).toBe(b);
    expect(state.left.holding).toBe(true);
  });

  it('a press that is not on a hold does nothing', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    press(a);
    pointerRelease(ctl);
    press(b);
    pointerRelease(ctl);
    const grabs = state.grabs;
    const releases = state.releaseSeq;
    const active = ctl.active;
    mouse.x = 0.5;
    mouse.y = 0.95;
    expect(pointerPress(ctl, state, cfg, field, mouse.x, mouse.y)).toBe(false);
    expect(pointerRelease(ctl)).toBe(false);
    run(1);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(true);
    expect(state.grabs).toBe(grabs);
    expect(state.releaseSeq).toBe(releases);
    expect(ctl.active).toBe(active);
  });

  it('does not grab the hold the other hand is on', () => {
    const a = field.add(0.3, state.y + 0.5);
    press(a);
    pointerRelease(ctl);
    expect(press(a)).toBe(false);
    expect(state.left.holding).toBe(false);
    expect(state.right.hold).toBe(a);
  });

  it('dragging never makes the other hand let go of its hold', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    press(a);
    pointerRelease(ctl);
    press(b);
    const releases = state.releaseSeq;
    // A huge pull: the body is stopped by the reach of the other hand.
    drag(1.5, 1);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(true);
    expect(state.releaseSeq).toBe(releases);
  });

  it('resting on two hands with the button up refills stamina', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    press(a);
    pointerRelease(ctl);
    press(b);
    pointerRelease(ctl);
    run(1);
    const s = state.stamina;
    run(2);
    expect(state.stamina).toBeGreaterThanOrEqual(s);
  });

  it('climbs hand over hand with a hand always on the wall', () => {
    const y0 = state.y;
    for (let k = 0; k < 8; k++) {
      const i = field.add(k % 2 === 0 ? 0.3 : -0.3, y0 + 0.45 + k * 0.4);
      expect(press(i)).toBe(true);
      expect(state.left.holding || state.right.holding).toBe(true);
      // Pull down so the new hold ends up near the shoulders, then let go of the button.
      drag(0.3);
      expect(pointerRelease(ctl)).toBe(true);
      expect(state.left.holding || state.right.holding).toBe(true);
    }
    expect(state.left.holding && state.right.holding).toBe(true);
    expect(state.y - y0).toBeGreaterThan(2);
    expect(state.status).toBe('climbing');
  });
});
