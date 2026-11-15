/**
 * Pitching-specific synthetic moves. Wrist targets are in sw relative to the same-side shoulder,
 * y up (see `BodyControls`).
 */
import type { ScriptStep } from '../script';
import type { Hand } from './moves';

/** Move the glove wrist to (x, y) and stay there. A slow, steady reach (no throw-like speed). */
export function gloveReach(glove: Hand, x: number, y: number, ms = 500): ScriptStep[] {
  return [
    {
      dur: ms,
      to: glove === 'left' ? { leftWristX: x, leftWristY: y } : { rightWristX: x, rightWristY: y },
      label: 'gloveReach',
    },
  ];
}
