/** Ten-pin scoring, pure. Rolls are the number of pins knocked down by each ball, in order. */

export const PINS = 10;

export interface NextBall {
  /** All frames are complete. */
  done: boolean;
  /** 0-based frame and ball within the frame. */
  frame: number;
  ball: number;
  /** Pins standing for this ball. */
  pinsUp: number;
  /** The pins must be racked fresh before this ball. */
  freshRack: boolean;
}

/** Where the next ball goes, given the rolls so far. `frames` is 10 for a full game. */
export function nextBall(rolls: readonly number[], frames = 10): NextBall {
  let i = 0;
  for (let f = 0; f < frames; f++) {
    const last = f === frames - 1;
    const r1 = rolls[i];
    if (r1 === undefined) return { done: false, frame: f, ball: 0, pinsUp: PINS, freshRack: true };
    if (!last) {
      if (r1 === PINS) {
        i += 1;
        continue;
      }
      const r2 = rolls[i + 1];
      if (r2 === undefined) {
        return { done: false, frame: f, ball: 1, pinsUp: PINS - r1, freshRack: false };
      }
      i += 2;
      continue;
    }
    // Tenth frame.
    const r2 = rolls[i + 1];
    if (r2 === undefined) {
      return r1 === PINS
        ? { done: false, frame: f, ball: 1, pinsUp: PINS, freshRack: true }
        : { done: false, frame: f, ball: 1, pinsUp: PINS - r1, freshRack: false };
    }
    const bonus = r1 === PINS || r1 + r2 === PINS;
    if (!bonus) return { done: true, frame: f, ball: 2, pinsUp: 0, freshRack: false };
    const r3 = rolls[i + 2];
    if (r3 === undefined) {
      if (r1 === PINS && r2 !== PINS) {
        return { done: false, frame: f, ball: 2, pinsUp: PINS - r2, freshRack: false };
      }
      return { done: false, frame: f, ball: 2, pinsUp: PINS, freshRack: true };
    }
    return { done: true, frame: f, ball: 3, pinsUp: 0, freshRack: false };
  }
  return { done: true, frame: frames - 1, ball: 0, pinsUp: 0, freshRack: false };
}

export function isComplete(rolls: readonly number[], frames = 10): boolean {
  return nextBall(rolls, frames).done;
}

/**
 * Cumulative score after each frame, or null where the frame is not resolved yet (waiting for
 * bonus balls). Length is `frames`.
 */
export function frameTotals(rolls: readonly number[], frames = 10): (number | null)[] {
  const out: (number | null)[] = [];
  let i = 0;
  let total = 0;
  let stuck = false;
  for (let f = 0; f < frames; f++) {
    let score: number | null = null;
    if (!stuck) {
      const r1 = rolls[i];
      const r2 = rolls[i + 1];
      const r3 = rolls[i + 2];
      if (f < frames - 1) {
        if (r1 === PINS) {
          if (r2 !== undefined && r3 !== undefined) score = PINS + r2 + r3;
          i += 1;
        } else {
          if (r1 !== undefined && r2 !== undefined) {
            if (r1 + r2 === PINS) {
              if (r3 !== undefined) score = PINS + r3;
            } else score = r1 + r2;
          }
          i += 2;
        }
      } else if (r1 !== undefined && r2 !== undefined) {
        if (r1 === PINS || r1 + r2 === PINS) {
          if (r3 !== undefined) score = r1 + r2 + r3;
        } else score = r1 + r2;
      }
    }
    if (score === null) {
      stuck = true;
      out.push(null);
    } else {
      total += score;
      out.push(total);
    }
  }
  return out;
}

/** The running total: the cumulative score of the last resolved frame, 0 before any. */
export function runningTotal(rolls: readonly number[], frames = 10): number {
  let t = 0;
  for (const v of frameTotals(rolls, frames)) if (v !== null) t = v;
  return t;
}

/** `fresh`: the ball was thrown at a fresh rack, so clearing it is a strike, not a spare. */
function symbol(roll: number, up: number, fresh: boolean): string {
  if (roll === up) return fresh ? 'X' : '/';
  return roll === 0 ? '-' : String(roll);
}

/** Scorecard marks per frame: 'X', '7/', '9-', tenth 'X81'. Empty string for frames not started. */
export function frameMarks(rolls: readonly number[], frames = 10): string[] {
  const out: string[] = [];
  let i = 0;
  for (let f = 0; f < frames; f++) {
    const last = f === frames - 1;
    let marks = '';
    let up = PINS;
    let fresh = true;
    let thrown = 0;
    while (i < rolls.length && thrown < (last ? 3 : 2)) {
      const roll = rolls[i] as number;
      marks += symbol(roll, up, fresh);
      i++;
      thrown++;
      up -= roll;
      fresh = false;
      if (up === 0) {
        if (!last) break;
        up = PINS;
        fresh = true;
      }
    }
    out.push(marks);
  }
  return out;
}

/**
 * Scorecard rows for `hud.setTable`: frame numbers, marks, running totals. Each row has one cell
 * per frame, so the highlight column is the current frame index.
 */
export function scorecardRows(rolls: readonly number[], frames = 10): string[][] {
  const head: string[] = [];
  const score: string[] = [];
  const totals = frameTotals(rolls, frames);
  for (let f = 0; f < frames; f++) {
    head.push(String(f + 1));
    const t = totals[f];
    score.push(t === null || t === undefined ? '' : String(t));
  }
  return [head, frameMarks(rolls, frames), score];
}
