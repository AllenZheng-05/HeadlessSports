import type { Coach } from '../../core/sport';
import { TutorialRunner } from '../../core/tutorial/TutorialRunner';
import type { TutorialStep } from '../../core/tutorial/TutorialRunner';
import type { Side } from '../../input/types';
import type { PitchKind } from './aim';
import { gloveSide } from './aim';
import type { TutorialProbe } from './bot';
import type { PitchingConfig } from './config';
import { restartCall } from './game';
import type { GameState } from './game';
import type { PitchRecord } from './scoring';
import { GRID, cellCentre } from './zone';
import type { Point } from './zone';

/** The aim ring as the tutorial reads it: shown or not, and where (scored plane, m). Updated in place. */
export interface RingView {
  visible: boolean;
  x: number;
  y: number;
}

/** What the tracker can see right now (camera play). Updated in place. */
export interface SeenView {
  /** Shoulders and body found. */
  tracked: boolean;
  glove: boolean;
  thrower: boolean;
}

export interface TutorialEnv {
  cfg: PitchingConfig;
  game: GameState;
  coach: Coach;
  /** The throwing (dominant) hand. */
  hand: Side;
  /** Mouse play: buttons, press and release instead of the camera steps. */
  mouse: boolean;
  ring: RingView;
  seen: SeenView;
  /** The bot reads this to know which glove-only step is on. */
  probe: TutorialProbe;
  /** The last step is done. */
  onFinished(): void;
}

export interface PitchTutorial {
  update(nowMs: number): void;
  /** Current step index (0-based); the step count once finished. */
  readonly step: number;
  readonly stepCount: number;
  readonly finished: boolean;
  dispose(): void;
}

// Feedback lines: why the action has not counted yet.
const NO_BODY = "I can't see your shoulders";
const NO_HANDS = "I can't see your hands";
const NO_GLOVE: Record<Side, string> = {
  left: "I can't see your left hand",
  right: "I can't see your right hand",
};
const GLOVE_LOST = "I can't see your glove hand, so I'm aiming at the middle";
const WAIT_CALL = 'Wait for the catcher to call a pitch';
const MOVE_MORE = 'Move your glove hand more';
const ON_SQUARE = 'Keep your glove hand on the glowing square';
const THROW_FASTER = 'Throw a little faster';
const THROW_OTHER = 'Throw with your other arm';
const THROW_OVER = 'Swing your throwing arm over your shoulder';
const NO_THROW_HAND = "I can't see your throwing hand";
const MAKE_FIST = 'Close your hand into a fist';
const OPEN_HAND = 'Open your hand flat';
const HOLD_STILL = 'Hold it still';
const WAS_CURVE = 'That was a curveball. Make a fist instead';
const WAS_FASTBALL = 'That was a fastball. Open your hand instead';
const CANT_READ = "I couldn't read your hand. Hold it up and still";
const NOT_CALLED_CAMERA = 'Not the pitch called. Fist is fastball, open is curve';
const NOT_CALLED_MOUSE = 'Not the pitch called. Pick the one in the bubble';
const CLICK_BUTTON = 'Click a pitch button at the bottom left';
const PRESS_FIELD = 'Press and hold on the field';
const RING_ONTO = 'Move the ring onto the glowing square';
const LET_GO = 'Let go of the button';
const PRESS_FIRST = 'Press and hold, then let go';

const FALLBACK_FASTBALL = "I couldn't read your hand, so I picked a fastball";
const FALLBACK_CURVE = "I couldn't read your hand. In a game, an open hand is a curveball";

const GLOVE_DETAIL: Record<Side, string> = {
  left: 'Your glove hand is your left one. The ring follows it.',
  right: 'Your glove hand is your right one. The ring follows it.',
};
const SCORING = 'The called pitch scores a bonus. The wrong pitch halves your points.';

// Confirmation text for the last step: what was matched.
const RIGHT_BOTH = 'Right pitch, right spot';
const RIGHT_ZONE = 'Right pitch, in the zone';
const RIGHT_PITCH = 'Right pitch';

/**
 * The pitching tutorial: camera steps (the glove hand steers the ring, the throwing arm throws,
 * a fist or an open hand picks the pitch) or mouse steps (buttons, press, release), one
 * `TutorialRunner` over them. It reads the sport's own game state, so the synthetic bot can finish
 * it. Throws and picks are counted as they happen, so nothing is missed while the praise for the
 * previous step is on screen. There is no clock and nothing to lose: the game it watches has no
 * balk timer and never ends.
 */
export function createPitchTutorial(env: TutorialEnv): PitchTutorial {
  const { cfg, game, ring, seen, probe } = env;
  const glove = gloveSide(env.hand);
  const scratch: Point = { x: 0, y: 0 };

  let stepStartMs = 0;
  let fresh = false;
  // Counters of things seen so far, and the marks the steps compare with.
  let seenRelease = game.releaseSeq;
  let seenSelect = game.selectSeq;
  let seenResult = game.resultSeq;
  let curveThrows = 0;
  let lastRecord: PitchRecord | null = null;
  /** A throw that finished the previous step carries over to the next one. */
  let throwMark = game.releaseSeq;
  let carried = false;
  // Pitch choice (steps 5 and 6): what is being asked, and how the last pick went.
  let choice: PitchKind | null = null;
  let picked = false;
  let wrong = 0;
  let curveMark = 0;
  /** Picks in a row on this step that fell back to a fastball (the hand was never read). */
  let fallbacks = 0;
  /** The step is accepted without a real read of the hand. */
  let gaveUp = false;
  // Ring steps.
  let refSet = false;
  let refX = 0;
  let refY = 0;
  let moved = false;
  let holdSinceMs = -1;
  let seenSinceMs = -1;
  // The called pitch (last step).
  let minIndex = 0;
  let pickMark = game.pickSeq;
  let slowMark = game.ignored.slow;
  let handMark = game.ignored.wrongHand;

  const begin = (now: number): void => {
    if (!fresh) return;
    fresh = false;
    stepStartMs = now;
  };
  const waited = (now: number): boolean => now - stepStartMs >= cfg.tutorialHintDelayMs;

  /** Sees every throw, pick and result once, whichever step is current. */
  const observe = (): void => {
    if (game.releaseSeq !== seenRelease) {
      seenRelease = game.releaseSeq;
      if (game.kind === 'curve') curveThrows++;
    }
    if (game.resultSeq !== seenResult) {
      seenResult = game.resultSeq;
      lastRecord = game.records[game.records.length - 1] ?? null;
    }
    if (game.selectSeq !== seenSelect) {
      seenSelect = game.selectSeq;
      if (choice !== null) {
        if (game.usedFallback) {
          fallbacks++;
          if (fallbacks >= cfg.tutorialReadTries) {
            // The hand is never read: stop asking, keep the fastball the game picked.
            gaveUp = true;
            wrong = 0;
            picked = choice === 'fastball';
          } else {
            wrong = 3;
            picked = false;
            restartCall(game, cfg.curveShare);
          }
        } else if (game.kind !== choice) {
          fallbacks = 0;
          wrong = game.kind === 'curve' ? 1 : 2;
          picked = false;
          restartCall(game, cfg.curveShare);
        } else {
          fallbacks = 0;
          wrong = 0;
          picked = true;
        }
      }
    }
  };

  const enterPlain = (): void => {
    fresh = true;
    if (!carried) throwMark = game.releaseSeq;
    carried = false;
    refSet = false;
    moved = false;
    holdSinceMs = -1;
    seenSinceMs = -1;
    slowMark = game.ignored.slow;
    handMark = game.ignored.wrongHand;
    choice = null;
    picked = false;
    wrong = 0;
    fallbacks = 0;
    gaveUp = false;
    probe.stage = 'normal';
  };

  const threw = (): boolean => game.releaseSeq > throwMark;
  /** A step is done: a throw made from here on belongs to the next one. */
  const complete = (): boolean => {
    carried = true;
    throwMark = game.releaseSeq;
    return true;
  };

  const onTarget = (): boolean => {
    if (!ring.visible) return false;
    cellCentre(cfg, game.target, scratch);
    const hw = cfg.zoneWidth / GRID / 2 + cfg.tutorialCellMarginM;
    const hh = cfg.zoneHeight / GRID / 2 + cfg.tutorialCellMarginM;
    return Math.abs(ring.x - scratch.x) <= hw && Math.abs(ring.y - scratch.y) <= hh;
  };
  /** The ring has been on the glowing square for the hold time. */
  const held = (now: number): boolean => {
    if (!onTarget()) {
      holdSinceMs = -1;
      return false;
    }
    if (holdSinceMs < 0) holdSinceMs = now;
    return now - holdSinceMs >= cfg.tutorialHoldMs;
  };
  const ringMoved = (): boolean => {
    if (moved) return true;
    if (!ring.visible) {
      refSet = false;
      return false;
    }
    if (!refSet) {
      refSet = true;
      refX = ring.x;
      refY = ring.y;
    } else if (Math.hypot(ring.x - refX, ring.y - refY) >= cfg.tutorialMoveM) moved = true;
    return moved;
  };

  const throwFeedback = (): string => {
    if (game.ignored.wrongHand > handMark) return THROW_OTHER;
    if (game.ignored.slow > slowMark) return THROW_FASTER;
    return THROW_OVER;
  };

  /** Shoulders and both hands in view for a moment. */
  const bodySeen = (now: number): boolean => {
    if (seen.tracked && seen.glove && seen.thrower) {
      if (seenSinceMs < 0) seenSinceMs = now;
    } else seenSinceMs = -1;
    return seenSinceMs >= 0 && now - seenSinceMs >= cfg.tutorialSeenMs;
  };

  const enterChoice = (kind: PitchKind): void => {
    enterPlain();
    game.autoSelect = false;
    game.callKind = kind;
    // A pitch already picked for you in the glove steps is thrown away: call again.
    if (game.phase === 'windup' || kind === 'curve') restartCall(game, cfg.curveShare);
    choice = kind;
    curveMark = curveThrows;
  };

  const calledDone = (): boolean => {
    const r = lastRecord;
    return r !== null && r.index >= minIndex && !r.balk && r.score.matched;
  };
  const calledFeedback = (mouseText: boolean): string | null => {
    const r = lastRecord;
    if (r !== null && r.index >= minIndex && !r.score.matched) {
      return mouseText ? NOT_CALLED_MOUSE : NOT_CALLED_CAMERA;
    }
    return null;
  };
  const enterCalled = (): void => {
    enterPlain();
    game.autoSelect = false;
    game.callKind = null;
    // The pitch already in the air belongs to the step before.
    minIndex = game.phase === 'flight' || game.phase === 'result' ? game.index + 1 : game.index;
  };
  const calledPraise = (): string => {
    const r = lastRecord;
    if (r === null) return RIGHT_PITCH;
    if (r.score.cell >= 0 && r.score.cell === r.target) return RIGHT_BOTH;
    return r.score.cell >= 0 ? RIGHT_ZONE : RIGHT_PITCH;
  };

  const cameraSteps: TutorialStep[] = [
    {
      text: 'Stand so I can see your shoulders and both hands',
      detail: 'Step back until your upper body is in view.',
      praise: 'Got it',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return bodySeen(now);
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!seen.tracked) return NO_BODY;
        if (!seen.glove && !seen.thrower) return NO_HANDS;
        if (!seen.glove) return NO_GLOVE[glove];
        if (!seen.thrower) return NO_GLOVE[env.hand];
        return null;
      },
    },
    {
      text: 'Move your glove hand to steer the ring',
      detail: GLOVE_DETAIL[glove],
      praise: 'Nice steering',
      enter() {
        enterPlain();
        probe.stage = 'steer';
      },
      done(now) {
        begin(now);
        observe();
        return ringMoved();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!seen.glove) return GLOVE_LOST;
        return ring.visible ? MOVE_MORE : WAIT_CALL;
      },
    },
    {
      text: 'Hold the ring on the glowing square',
      detail: 'The closer you are to it, the more points.',
      praise: 'Right on it',
      enter() {
        enterPlain();
        probe.stage = 'hold';
      },
      done(now) {
        begin(now);
        observe();
        return held(now) && complete();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!seen.glove) return GLOVE_LOST;
        return ring.visible ? ON_SQUARE : WAIT_CALL;
      },
    },
    {
      text: 'Now throw with your other arm',
      detail: 'The ring locks while you throw.',
      praise: 'Nice throw',
      enter() {
        enterPlain();
        probe.stage = 'throw';
      },
      done(now) {
        begin(now);
        observe();
        return threw() && complete();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!seen.glove) return GLOVE_LOST;
        return throwFeedback();
      },
    },
    {
      text: 'Hold your throwing hand still in a fist for a fastball',
      detail: 'A fist is a fastball. Hold it for a moment.',
      get praise(): string {
        return gaveUp ? FALLBACK_FASTBALL : 'Fastball picked';
      },
      enter() {
        enterChoice('fastball');
      },
      done(now) {
        begin(now);
        observe();
        return picked && complete();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (wrong === 1) return WAS_CURVE;
        if (wrong === 3) return CANT_READ;
        if (game.phase !== 'sign') return null;
        if (game.reading === 'none') return NO_THROW_HAND;
        return game.reading === 'curve' ? MAKE_FIST : HOLD_STILL;
      },
    },
    {
      text: 'Hold it open for a curveball, then throw',
      detail: 'A curveball breaks down and away from your throwing hand.',
      get praise(): string {
        return gaveUp ? FALLBACK_CURVE : 'Nice curve';
      },
      enter() {
        enterChoice('curve');
      },
      done(now) {
        begin(now);
        observe();
        return (curveThrows > curveMark || gaveUp) && complete();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (wrong === 2) return WAS_FASTBALL;
        if (wrong === 3) return CANT_READ;
        if (game.phase === 'sign') {
          if (game.reading === 'none') return NO_THROW_HAND;
          return game.reading === 'fastball' ? OPEN_HAND : HOLD_STILL;
        }
        if (game.phase === 'windup' && picked) {
          return !seen.glove ? GLOVE_LOST : throwFeedback();
        }
        return null;
      },
    },
    {
      text: 'The catcher asks for a pitch and a spot. Match both',
      detail: SCORING,
      get praise(): string {
        return calledPraise();
      },
      enter: enterCalled,
      done(now) {
        begin(now);
        observe();
        return calledDone();
      },
      feedback(now) {
        if (!waited(now)) return null;
        const miss = calledFeedback(false);
        if (miss !== null) return miss;
        if (!seen.glove) return GLOVE_LOST;
        if (game.phase === 'sign' && game.reading === 'none') return NO_THROW_HAND;
        return null;
      },
    },
  ];

  const mouseSteps: TutorialStep[] = [
    {
      text: 'Pick Fastball or Curveball with a button',
      detail: 'The catcher calls one of them. Try the one in the bubble.',
      praise: 'Picked',
      enter() {
        enterPlain();
        pickMark = game.pickSeq;
      },
      done(now) {
        begin(now);
        observe();
        return game.pickSeq > pickMark;
      },
      feedback(now) {
        return waited(now) ? CLICK_BUTTON : null;
      },
    },
    {
      text: 'Hold on the field to aim at the glowing square',
      detail: 'The ring follows your pointer.',
      praise: 'Right on it',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return held(now) && complete();
      },
      feedback(now) {
        if (!waited(now)) return null;
        return ring.visible ? RING_ONTO : PRESS_FIELD;
      },
    },
    {
      text: 'Now let go to throw',
      detail: 'The pitch goes where the ring is when you let go.',
      praise: 'Nice throw',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe();
        return threw() && complete();
      },
      feedback(now) {
        if (!waited(now)) return null;
        return ring.visible ? LET_GO : PRESS_FIRST;
      },
    },
    {
      text: 'Match the call: pick the pitch, aim, throw',
      detail: SCORING,
      get praise(): string {
        return calledPraise();
      },
      enter: enterCalled,
      done(now) {
        begin(now);
        observe();
        return calledDone();
      },
      feedback(now) {
        if (!waited(now)) return null;
        return calledFeedback(true);
      },
    },
  ];

  const steps = env.mouse ? mouseSteps : cameraSteps;
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
    dispose(): void {
      probe.stage = 'normal';
      runner.dispose();
    },
  };
}
