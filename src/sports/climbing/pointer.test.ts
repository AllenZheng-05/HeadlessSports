import { beforeEach, describe, expect, it } from 'vitest';
import { climbingConfig } from './config';
import type { ClimbingConfig } from './config';
import { KIND_JUG } from './layout';
import type { HoldField } from './layout';
import {
  createPointerControl,
  pointerPress,
  pointerRelease,
  pointerStep,
  pointerTarget,
} from './pointer';
import type { PointerControl } from './pointer';
import { wallToHand } from './reach';
import { createScreenMap, updateScreenMap, wallToScreen } from './screenMap';
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
/** Steps taken after the first grab with no hand on the wall (must stay 0 in normal play). */
let zeroGripSteps = 0;
const stepRules = (): void => {
  step(state, cfg, field, input, DT);
  if (
    state.grabs > 0 &&
    state.status === 'climbing' &&
    !state.left.holding &&
    !state.right.holding
  ) {
    zeroGripSteps++;
  }
};

const run = (seconds: number): void => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    pointerStep(ctl, state, cfg, field, input, mouse.x, mouse.y, DT);
    stepRules();
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
    stepRules();
  }
  run(0.3);
};

beforeEach(() => {
  cfg = { ...climbingConfig };
  field = new Field(cfg);
  state = createClimbState(cfg, 60);
  input = createStepInput();
  ctl = createPointerControl();
  zeroGripSteps = 0;
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

  it('grabbing a second hold with the other hand makes the first hand let go, never leaving no grip', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    press(a);
    drag(0.1);
    pointerRelease(ctl);
    const releases = state.releaseSeq;
    expect(press(b)).toBe(true);
    expect(state.left.hold).toBe(b);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(false);
    expect(state.releaseSeq).toBe(releases + 1);
    expect(zeroGripSteps).toBe(0);
  });

  it('the other hand keeps its grip until the new grab has taken', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.3, state.y + 0.9);
    press(a);
    pointerRelease(ctl);
    wallToHand(cfg, field.holdX(b) - state.x, field.holdY(b) - state.y, img);
    mouse.x = img.x;
    mouse.y = img.y;
    run(0.05);
    expect(pointerPress(ctl, state, cfg, field, mouse.x, mouse.y)).toBe(true);
    // Right after the press the left hand is still closing, so the right hand still holds.
    pointerStep(ctl, state, cfg, field, input, mouse.x, mouse.y, DT);
    expect(input.right.closed).toBe(true);
    run(0.4);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(false);
  });

  it('a hand that already holds lets go of its old hold for the new one', () => {
    const a = field.add(0.3, state.y + 0.5);
    const c = field.add(0.3, state.y + 1.0);
    press(a);
    pointerRelease(ctl);
    // Hand the mouse back to the holding hand (as if the other grab had not happened).
    ctl.active = 1;
    const releases = state.releaseSeq;
    expect(press(c)).toBe(true);
    expect(state.right.hold).toBe(c);
    expect(state.releaseSeq).toBe(releases + 1);
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
    expect(state.right.holding).toBe(false);
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

  it('the old hold no longer limits the pull once the other hand has let go', () => {
    const y0 = state.y;
    const a = field.add(0.3, y0 + 0.5);
    const b = field.add(-0.3, y0 + 0.9);
    press(a);
    pointerRelease(ctl);
    press(b);
    // A huge pull: the body goes past where the old hold (a) would have stopped it (a.y + 0.5).
    drag(1.5, 1);
    expect(state.left.holding).toBe(true);
    expect(state.right.holding).toBe(false);
    expect(state.y).toBeGreaterThan(y0 + 1.1);
    expect(state.status).toBe('climbing');
    expect(zeroGripSteps).toBe(0);
  });

  it('one grip drains stamina at the eased mouse rate', () => {
    const a = field.add(0.3, state.y + 0.5);
    press(a);
    drag(0.3);
    pointerRelease(ctl);
    state.oneHandDrainMult = cfg.mouseOneHandDrainMult;
    run(0.5);
    const s0 = state.stamina;
    run(2);
    const rate = (s0 - state.stamina) / 2;
    expect(rate).toBeCloseTo(cfg.drainOneHand * cfg.mouseOneHandDrainMult, 3);
  });

  it('climbs hand over hand with a hand always on the wall (one grip at a time)', () => {
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
    expect(state.left.holding || state.right.holding).toBe(true);
    expect(state.y - y0).toBeGreaterThan(2);
    expect(state.status).toBe('climbing');
    expect(zeroGripSteps).toBe(0);
  });
});

describe('with a screen map (real pointer position)', () => {
  const at = { x: 0, y: 0 };
  const aim = (i: number): void => {
    wallToScreen(ctl.map!, field.holdX(i), field.holdY(i), at);
  };
  beforeEach(() => {
    const map = createScreenMap();
    // Camera 2.5 m above the start shoulders, looking at a wall 3.2 m away.
    updateScreenMap(map, 0.1, state.y + 0.8, 2.75, -0.45 + 0.07, 45, 16 / 9);
    ctl.map = map;
  });

  it('takes the hold under the cursor, wherever it is on screen', () => {
    const a = field.add(0.3, state.y + 0.5);
    const b = field.add(-0.4, state.y + 0.9);
    const far = field.add(0.3, state.y + 1.9);
    aim(a);
    expect(pointerTarget(ctl, state, cfg, field, at.x, at.y)).toBe(a);
    aim(b);
    expect(pointerTarget(ctl, state, cfg, field, at.x, at.y)).toBe(b);
    // Visible on screen but beyond the reach of the shoulders: not takeable.
    aim(far);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(pointerTarget(ctl, state, cfg, field, at.x, at.y)).toBe(-1);
  });

  it('a press on the hold grabs it and a drag moves the body as far as the pointer moves', () => {
    const a = field.add(0.3, state.y + 0.5);
    aim(a);
    mouse.x = at.x;
    mouse.y = at.y;
    run(0.05);
    expect(pointerPress(ctl, state, cfg, field, mouse.x, mouse.y)).toBe(true);
    run(0.4);
    expect(state.right.hold).toBe(a);
    const y0 = state.y;
    const metresPerUnit = ctl.map!.halfH * 2;
    drag(0.1, 0.4);
    expect(state.y - y0).toBeCloseTo(0.1 * metresPerUnit, 1);
  });

  it('the free hand follows the pointer to the world position under it', () => {
    const a = field.add(0.3, state.y + 0.5);
    aim(a);
    mouse.x = at.x;
    mouse.y = at.y;
    run(0.05);
    expect(pointerPress(ctl, state, cfg, field, mouse.x, mouse.y)).toBe(true);
    run(0.4);
    pointerRelease(ctl);
    wallToScreen(ctl.map!, -0.2, state.y + 0.7, at);
    mouse.x = at.x;
    mouse.y = at.y;
    run(0.3);
    expect(state.x + state.left.cursorX).toBeCloseTo(-0.2, 3);
    expect(state.y + state.left.cursorY).toBeCloseTo(state.y + 0.7, 3);
  });
});
