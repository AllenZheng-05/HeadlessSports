import type { SportBot } from '../../core/sport';
import type { BodyControls } from '../../tracking/synthetic/controls';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { handsOnlyStart, idle } from '../../tracking/synthetic/scripts/moves';
import type { ClimbingConfig } from './config';
import type { Layout } from './layout';
import { chooseHold } from './plan';
import { wallToHand } from './reach';
import type { Vec2 } from './reach';
import { isDone, shoulderDrop } from './rules';
import type { ClimbState, HandSlot } from './rules';

/** How far down (metres of climber rise) the pulling hand draws per cycle, at most. */
const PULL_RISE = 1.0;
/** The pulling hand never goes lower than this cursor height below the shoulders. */
const PULL_FLOOR = -0.4;

type Side = 'left' | 'right';

/** Set by the tutorial so the bot can do what the current step asks. */
export interface TutorialProbe {
  /** The step wants both hands to stay on their holds for a while. */
  rest: boolean;
}

function fistStep(side: Side, value: number, ms: number, label: string): ScriptStep {
  return { dur: ms, to: side === 'left' ? { leftFist: value } : { rightFist: value }, label };
}

function posTo(side: Side, x: number | null, y: number): Partial<BodyControls> {
  if (side === 'left') return x === null ? { leftHandY: y } : { leftHandX: x, leftHandY: y };
  return x === null ? { rightHandY: y } : { rightHandX: x, rightHandY: y };
}

/**
 * The closed-loop climber. One hand holds and pulls down while the free hand lifts off, reaches
 * the next hold chosen from the live layout and closes on it; then the roles swap. A missed
 * grab is noticed (the hand is not holding when the bot is asked again) and re-aimed.
 */
export function createClimbBot(
  cfg: ClimbingConfig,
  state: ClimbState,
  layout: Layout,
  probe?: TutorialProbe,
): SportBot {
  let started = false;
  let lastGrabs = 0;
  let reachSide: 0 | 1 = 1;
  const tmp: Vec2 = { x: 0, y: 0 };
  const sides: readonly Side[] = ['left', 'right'];
  const slots = (): readonly HandSlot[] => [state.left, state.right];

  return {
    next(enqueue): void {
      if (!started) {
        started = true;
        enqueue([{ dur: 250, to: handsOnlyStart(), label: 'start' }]);
        return;
      }
      if (isDone(state)) {
        enqueue(idle(100));
        return;
      }
      const [l, r] = slots() as [HandSlot, HandSlot];
      if (probe !== undefined && probe.rest && l.holding && r.holding) {
        // The tutorial asks for a rest: hang on with both hands and wait.
        enqueue(idle(250));
        return;
      }
      let pull: 0 | 1 | -1 = -1;
      if (l.holding && r.holding) {
        pull = layout.holdY(l.hold) >= layout.holdY(r.hold) ? 0 : 1;
      } else if (l.holding) pull = 0;
      else if (r.holding) pull = 1;

      let reach: 0 | 1;
      if (pull === -1) {
        // Nothing holds: try a hand, and the other one after a miss.
        if (state.grabs === lastGrabs && lastGrabs > 0) reachSide = reachSide === 1 ? 0 : 1;
        reach = reachSide;
      } else {
        reach = pull === 0 ? 1 : 0;
        reachSide = reach;
      }
      lastGrabs = state.grabs;
      const reachName = sides[reach]!;

      const steps: ScriptStep[] = [];
      let cx = state.x;
      let cy = state.y;
      const drop = shoulderDrop(cfg);
      if (pull !== -1) {
        const slot = pull === 0 ? l : r;
        const pullName = sides[pull]!;
        const newRel = Math.max(PULL_FLOOR, slot.cursorY - PULL_RISE);
        cx = Math.max(
          -cfg.wallHalfWidth,
          Math.min(cfg.wallHalfWidth, layout.holdX(slot.hold) - slot.cursorX),
        );
        cy = Math.max(drop, layout.holdY(slot.hold) - newRel);
        const pullTo = wallToHand(cfg, slot.cursorX, newRel, tmp).y;
        const target = chooseHold(layout, cfg, cx, cy, reach, slot.hold);
        steps.push(fistStep(reachName, 0, 120, 'release'));
        if (target < 0) {
          steps.push({ dur: 650, to: posTo(pullName, null, pullTo), label: 'pull' });
        } else {
          const h = wallToHand(cfg, layout.holdX(target) - cx, layout.holdY(target) - cy, tmp);
          steps.push({
            dur: 650,
            to: { ...posTo(pullName, null, pullTo), ...posTo(reachName, h.x, h.y) },
            label: 'pull-reach',
          });
        }
      } else {
        const target = chooseHold(layout, cfg, cx, cy, reach, -1);
        steps.push(fistStep(reachName, 0, 120, 'release'));
        if (target >= 0) {
          const h = wallToHand(cfg, layout.holdX(target) - cx, layout.holdY(target) - cy, tmp);
          steps.push({ dur: 450, to: posTo(reachName, h.x, h.y), label: 'reach' });
        } else {
          enqueue(idle(100));
          return;
        }
      }
      steps.push({ dur: 120, label: 'settle' });
      steps.push(fistStep(reachName, 1, 180, 'grab'));
      steps.push({ dur: 160, label: 'dwell' });
      enqueue(steps);
    },
  };
}
