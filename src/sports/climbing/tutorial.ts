import type { Coach } from '../../core/sport';
import { TutorialRunner } from '../../core/tutorial/TutorialRunner';
import type { TutorialStep } from '../../core/tutorial/TutorialRunner';
import type { TutorialProbe } from './bot';
import type { ClimbingConfig } from './config';
import type { HoldField } from './layout';
import { heightOf } from './rules';
import type { ClimbState } from './rules';

/** What the tutorial reads of one hand. */
export interface HandView {
  present: boolean;
  closed: boolean;
}

export interface TutorialEnv {
  cfg: ClimbingConfig;
  state: ClimbState;
  field: HoldField;
  coach: Coach;
  /** The tracked hands (camera) or the hands the mouse drives (mouse play). */
  hands(): { left: HandView; right: HandView };
  /** Mouse play: the pointer. Null for camera play, which gets the fist steps. */
  mouse: { dragging(): boolean; aimable(): boolean } | null;
  /** The bot reads this to know when to hang on. */
  probe: TutorialProbe;
  /** The last step is done. */
  onFinished(): void;
}

export interface ClimbTutorial {
  update(nowMs: number): void;
  /** Current step index (0-based); the step count once finished. */
  readonly step: number;
  readonly stepCount: number;
  readonly finished: boolean;
  /** The stamina bar belongs to the stamina step and the ones after it. */
  readonly showStamina: boolean;
  dispose(): void;
}

// Feedback lines: why the action has not counted yet.
const NO_HANDS = "I can't see your hands";
const NO_LEFT = "I can't see your left hand";
const NO_RIGHT = "I can't see your right hand";
const CLOSE_FIST = 'Close your fist on a hold';
const CLOSER = 'Move closer to a hold';
const GRAB_FIRST = 'Grab a hold first';
const OPEN_ONE = 'Open one hand first';
const REACH_HIGHER = 'Reach up and close your fist on a higher hold';
const PULL_DOWN = 'Keep your fist closed and pull it down';
const BOTH_HANDS = 'Hold on with both hands';
const HOLD_STILL = 'Hold still to rest';
const KEEP_CLIMBING = 'Grab a hold to keep climbing';
const POINTER_ON_HOLD = 'Move the pointer onto a hold';
const KEEP_BUTTON = 'Keep the button down';
const PRESS_THEN_DRAG = 'Press and hold a hold, then drag down';
const LET_GO_BUTTON = 'Let go of the button to switch hands';
const LET_GO_HANG = 'Let go of the button and hang';
const HIGHER_HOLD = 'Press and hold a hold above your hand';

/** Moving faster than this (m/s) is not resting. */
const STILL_SPEED = 0.3;

/**
 * Nothing to lose in the tutorial: after every rules step the stamina is held above a floor and
 * the slip timer is cleared, so the climber neither runs out of stamina nor falls.
 */
export function keepSafe(state: ClimbState, cfg: ClimbingConfig): void {
  if (state.stamina < cfg.tutorialStaminaFloor) state.stamina = cfg.tutorialStaminaFloor;
  state.slipMs = 0;
}

/**
 * The climbing tutorial: camera steps (fists grab) or mouse steps (press, drag, release), one
 * `TutorialRunner` over them. Everything is read from the sport's own state, so the synthetic
 * bot (which only plays the game) can finish it. Conditions are state based wherever they can
 * be, so nothing is missed while the praise for the previous step is on screen.
 */
export function createClimbTutorial(env: TutorialEnv): ClimbTutorial {
  const { cfg, state, field, probe } = env;
  const mouse = env.mouse;
  let seenSeq = state.grabSeq;
  let everLeft = false;
  let everRight = false;
  let fresh = false;
  let stepStartMs = 0;
  let entryHeight = 0;
  let refY = Number.POSITIVE_INFINITY;
  let regrabbed = false;
  let restSinceMs = -1;
  let handsSinceMs = -1;
  let restIndex = 0;

  const begin = (now: number): void => {
    if (!fresh) return;
    fresh = false;
    stepStartMs = now;
  };
  const waited = (now: number): boolean => now - stepStartMs >= cfg.tutorialHintDelayMs;
  const holdingAny = (): boolean => state.left.holding || state.right.holding;
  const holdingBoth = (): boolean => state.left.holding && state.right.holding;
  const highestHeld = (): number => {
    let y = state.y;
    let any = false;
    if (state.left.holding) {
      y = field.holdY(state.left.hold);
      any = true;
    }
    if (state.right.holding) {
      const r = field.holdY(state.right.hold);
      y = any && y > r ? y : r;
    }
    return y;
  };

  /** Sees each new grab once: which hands have grabbed, and whether one reached higher. */
  const observe = (): void => {
    if (state.grabSeq === seenSeq) return;
    seenSeq = state.grabSeq;
    const left = state.lastGrabSide === 0;
    if (left) everLeft = true;
    else everRight = true;
    const slot = left ? state.left : state.right;
    if (slot.holding && field.holdY(slot.hold) > refY + cfg.tutorialRegrabRiseM) regrabbed = true;
  };

  const enterPlain = (): void => {
    fresh = true;
    probe.rest = false;
    entryHeight = heightOf(state, cfg);
    restSinceMs = -1;
    handsSinceMs = -1;
  };

  const gained = (): boolean => heightOf(state, cfg) - entryHeight >= cfg.tutorialPullGainM;
  const atFlag = (): boolean => heightOf(state, cfg) >= cfg.tutorialTopM;

  /** Both hands (or the one hand, with the mouse) hanging on for a while. */
  const hung = (now: number, ok: boolean): boolean => {
    if (!ok) {
      restSinceMs = -1;
      return false;
    }
    if (restSinceMs < 0) restSinceMs = now;
    return now - restSinceMs >= cfg.tutorialRestMs;
  };

  const missingHand = (): string | null => {
    const hands = env.hands();
    const side = everLeft ? hands.right : hands.left;
    if (!side.present) return everLeft ? NO_RIGHT : NO_LEFT;
    return side.closed ? CLOSER : CLOSE_FIST;
  };

  const cameraSteps: TutorialStep[] = [
    {
      text: 'Hold both hands up so I can see them',
      detail: 'Keep them close to the camera.',
      praise: 'Got it',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        const hands = env.hands();
        if (hands.left.present && hands.right.present) {
          if (handsSinceMs < 0) handsSinceMs = now;
        } else handsSinceMs = -1;
        return handsSinceMs >= 0 && now - handsSinceMs >= cfg.tutorialHandsMs;
      },
      feedback(now) {
        if (!waited(now)) return null;
        const hands = env.hands();
        if (!hands.left.present && !hands.right.present) return NO_HANDS;
        if (!hands.left.present) return NO_LEFT;
        if (!hands.right.present) return NO_RIGHT;
        return null;
      },
    },
    {
      text: 'Reach for a hold and make a fist to grab it',
      detail: 'Either hand. Open your hand to let go.',
      praise: 'Nice grab',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return state.grabs >= 1;
      },
      feedback(now) {
        if (!waited(now)) return null;
        const hands = env.hands();
        const l = hands.left;
        const r = hands.right;
        if (!l.present && !r.present) return NO_HANDS;
        if (!(l.present && l.closed) && !(r.present && r.closed)) return CLOSE_FIST;
        return CLOSER;
      },
    },
    {
      text: 'Now grab a hold with your other hand',
      detail: 'Both fists can hold on at once.',
      praise: 'Both hands in',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return everLeft && everRight;
      },
      feedback(now) {
        return waited(now) ? missingHand() : null;
      },
    },
    {
      text: 'Pull your fists down to climb',
      detail: 'Keep your grip while you pull.',
      praise: 'Nice pull',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return gained();
      },
      feedback(now) {
        if (!holdingAny()) return GRAB_FIRST;
        return waited(now) ? PULL_DOWN : null;
      },
    },
    {
      text: 'Open one hand, reach higher, grab again',
      detail: 'Climbing is hand over hand.',
      praise: 'Hand over hand',
      enter() {
        enterPlain();
        regrabbed = false;
        refY = highestHeld();
      },
      done(now) {
        begin(now);
        observe();
        return regrabbed;
      },
      feedback(now) {
        if (holdingBoth()) return OPEN_ONE;
        if (!holdingAny()) return GRAB_FIRST;
        return waited(now) ? REACH_HIGHER : null;
      },
    },
    {
      text: 'Hang on with both hands and hold still',
      detail: 'Stamina drops as you climb. Two holds rest it.',
      praise: 'Good rest',
      enter() {
        enterPlain();
        probe.rest = true;
      },
      done(now) {
        begin(now);
        observe();
        return hung(now, holdingBoth());
      },
      feedback(now) {
        if (!holdingBoth()) return waited(now) ? BOTH_HANDS : null;
        return waited(now) && state.speed > STILL_SPEED ? HOLD_STILL : null;
      },
    },
    {
      text: 'Climb to the flag',
      detail: 'Hand over hand, all the way up.',
      praise: 'You made it',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return atFlag();
      },
      feedback(now) {
        return !holdingAny() && waited(now) ? KEEP_CLIMBING : null;
      },
    },
  ];

  const mouseSteps: TutorialStep[] = [
    {
      text: 'Press and hold a hold to grab it',
      detail: 'Holds light up under the pointer.',
      praise: 'Nice grab',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return state.grabs >= 1;
      },
      feedback(now) {
        if (!waited(now)) return null;
        return mouse?.aimable() === true ? KEEP_BUTTON : POINTER_ON_HOLD;
      },
    },
    {
      text: 'Drag down to pull yourself up',
      detail: 'Keep the button down while you drag.',
      praise: 'Nice pull',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return gained();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!holdingAny()) return GRAB_FIRST;
        return mouse?.dragging() === true ? null : PRESS_THEN_DRAG;
      },
    },
    {
      text: 'Let go, then press a hold with your other hand',
      detail: 'Letting go keeps your grip and switches hands.',
      praise: 'Hands switched',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return everLeft && everRight;
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (mouse?.dragging() === true) return LET_GO_BUTTON;
        return mouse?.aimable() === true ? KEEP_BUTTON : POINTER_ON_HOLD;
      },
    },
    {
      text: 'Keep going: grab a higher hold',
      detail: 'Each new grab frees your other hand.',
      praise: 'Hand over hand',
      enter() {
        enterPlain();
        regrabbed = false;
        refY = highestHeld();
      },
      done(now) {
        begin(now);
        observe();
        return regrabbed;
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (mouse?.dragging() === true) return LET_GO_BUTTON;
        return HIGHER_HOLD;
      },
    },
    {
      text: 'Hang on a hold for a moment',
      detail: 'Stamina drops while you hang. Ledges refill it.',
      praise: 'Good rest',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return hung(now, holdingAny() && mouse?.dragging() !== true);
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!holdingAny()) return GRAB_FIRST;
        return mouse?.dragging() === true ? LET_GO_HANG : null;
      },
    },
    {
      text: 'Climb to the flag',
      detail: 'Press, drag down, let go, and switch hands.',
      praise: 'You made it',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return atFlag();
      },
      feedback(now) {
        return !holdingAny() && waited(now) ? KEEP_CLIMBING : null;
      },
    },
  ];

  const steps = mouse === null ? cameraSteps : mouseSteps;
  restIndex = mouse === null ? 5 : 4;
  const runner = new TutorialRunner(env.coach, steps, env.onFinished);

  return {
    update(nowMs: number): void {
      observe();
      runner.update(nowMs);
    },
    get step(): number {
      return runner.index;
    },
    get stepCount(): number {
      return steps.length;
    },
    get finished(): boolean {
      return runner.finished;
    },
    get showStamina(): boolean {
      return runner.index >= restIndex;
    },
    dispose(): void {
      probe.rest = false;
      runner.dispose();
    },
  };
}
