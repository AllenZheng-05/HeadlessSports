import type { Coach } from '../../core/sport';
import { TutorialRunner } from '../../core/tutorial/TutorialRunner';
import type { TutorialStep } from '../../core/tutorial/TutorialRunner';
import type { FrameProblem, RejectedMotion } from '../../input/types';
import type { BowlingConfig } from './config';
import type { BowlPhase, RollKind } from './game';
import type { NextBall } from './scoring';

/**
 * Set by the tutorial so the synthetic bowler waits for the step that asks for each action.
 * 0 stand still, 1 pick up the ball, 2 line up the arrows, 3 swing and bowl (everything).
 */
export interface TutorialProbe {
  gate: number;
}

/** What the sport counts for the tutorial. The sport's event handlers bump these. */
export interface TutorialCounts {
  /** Balls picked up. */
  pickups: number;
  /** Wind-ups seen (camera). */
  windups: number;
  /** Balls launched. */
  launches: number;
  /** Throws that were noticed but too slow to launch the ball. */
  weak: number;
  /** What the last counted ball was, or null before the first. */
  lastKind: RollKind | null;
  /** The hook of the last launched ball, 0 before the first. */
  lastHook: number;
}

export function createTutorialCounts(): TutorialCounts {
  return { pickups: 0, windups: 0, launches: 0, weak: 0, lastKind: null, lastHook: 0 };
}

// The wiring from the sport's events to the counts, shared by the sport and the tests.
export function countPickup(counts: TutorialCounts): void {
  counts.pickups++;
}

export function countRelease(counts: TutorialCounts, hook: number): void {
  counts.launches++;
  counts.lastHook = hook;
}

export function countRoll(counts: TutorialCounts, kind: RollKind): void {
  counts.lastKind = kind;
}

/** A wind-up of the throwing hand while aiming. Call before the game takes it. */
export function countWindup(
  counts: TutorialCounts,
  phase: BowlPhase,
  hand: string,
  eventHand: string,
): void {
  if (phase === 'aim' && eventHand === hand) counts.windups++;
}

/** A throw of the throwing hand that the game did not turn into a launch (too slow). */
export function countThrow(
  counts: TutorialCounts,
  phase: BowlPhase,
  hand: string,
  eventHand: string,
  launched: boolean,
): void {
  if (!launched && phase === 'aim' && eventHand === hand) counts.weak++;
}

/** The slice of the game the tutorial reads. `BowlingGame` fits. */
export interface GameView {
  readonly phase: BowlPhase;
  readonly aimAngle: number;
  readonly bowlerX: number;
  readonly next: NextBall;
  readonly rolls: readonly number[];
}

/** What the tutorial reads of the tracked body (camera play only). */
export interface BodyView {
  tracking(): boolean;
  problem(): FrameProblem;
  /** The throwing hand is tracked right now. */
  handPresent(): boolean;
  rejected(): RejectedMotion | undefined;
}

export interface TutorialEnv {
  cfg: BowlingConfig;
  coach: Coach;
  game: GameView;
  counts: TutorialCounts;
  /** Mouse play (camera off). Null `body` goes with it. */
  mouse: boolean;
  body: BodyView | null;
  probe: TutorialProbe;
  /** The last step is done. */
  onFinished(): void;
}

export interface BowlTutorial {
  update(nowMs: number): void;
  /** Current step index (0-based); the step count once finished. */
  readonly step: number;
  readonly stepCount: number;
  readonly finished: boolean;
  dispose(): void;
}

// Feedback lines: why the action has not counted yet.
/** Hands out of view is a hint, not a block: the body is what this step asks for. */
const trackedOk = (p: FrameProblem): boolean => p === 'none' || p === 'hands-out-of-view';

const NO_BODY = "I can't see you. Step back a little";
const MOVE_LEFT = 'Move a little to the left';
const MOVE_RIGHT = 'Move a little to the right';
const STEP_BACK = 'Step back a little';
const STEP_CLOSER = 'Step a little closer';
const SHOW_ARMS = 'Keep your arms in view';
const NO_HAND = "I can't see your hand";
const NO_ARM = "I can't see your arm";
const MAKE_FIST = 'Make a clear fist by your side';
const PICK_UP = 'Close your fist to pick up the ball';
const SLIDE_HAND = 'Slide your hand or step sideways';
const SWING_FASTER = 'Swing a bit faster';
const SWING_LOW = 'Swing low and forward, like a real bowler';
const SWING_BACK = 'Draw your arm further back first';
const LET_GO = 'Swing forward and let go';
const GUTTER = 'That went in the gutter. Aim nearer the middle';
const STRIKE_AGAIN = 'A strike clears every pin. Bowl again';
const CURVE_MORE = 'Curve your hand a bit more as you let go';
const MOVE_MOUSE = 'Move the pointer across the lane';
const PRESS_HOLD = 'Press and hold the button';
const RELEASE_BUTTON = 'Let go of the button to bowl';

/**
 * The bowling tutorial: camera steps (fist, step and aim, swing, spare, hook, free frame) or mouse
 * steps (aim, hold, let go, spare, free frame), one `TutorialRunner` over them. Conditions are read
 * from running counts and the game's own state, so a ball that goes while the praise for the
 * previous step is showing still counts, and the synthetic bot can finish it.
 */
export function createBowlTutorial(env: TutorialEnv): BowlTutorial {
  const { cfg, game, counts, probe, body } = env;
  let fresh = false;
  let stepStartMs = 0;
  let trackedSinceMs = -1;
  let aimMin = 0;
  let aimMax = 0;
  let xMin = 0;
  let xMax = 0;
  let launchesAtEnter = 0;
  let weakAtEnter = 0;
  let windupsAtEnter = 0;
  let rejectAtEnter = 0;

  const begin = (now: number): void => {
    if (!fresh) return;
    fresh = false;
    stepStartMs = now;
  };
  const waited = (now: number): boolean => now - stepStartMs >= cfg.tutorialHintDelayMs;
  const rejectSeq = (): number => body?.rejected()?.seq ?? 0;

  const enterPlain = (): void => {
    fresh = true;
    launchesAtEnter = counts.launches;
    weakAtEnter = counts.weak;
    windupsAtEnter = counts.windups;
    rejectAtEnter = rejectSeq();
  };
  const enterAim = (): void => {
    enterPlain();
    aimMin = aimMax = game.aimAngle;
    xMin = xMax = game.bowlerX;
  };

  /** The arrows (or the bowler) have moved far enough, wherever they started. */
  const aimMoved = (): boolean => {
    const phase = game.phase;
    if (phase === 'aim' || (env.mouse && phase === 'pickup')) {
      const a = game.aimAngle;
      const x = game.bowlerX;
      if (a < aimMin) aimMin = a;
      if (a > aimMax) aimMax = a;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    return aimMax - aimMin >= cfg.tutorialAimSpreadRad || xMax - xMin >= cfg.tutorialStepM;
  };

  const bowled = (): boolean => counts.launches >= 1;
  /** The first ball was launched and has been scored, so what it left is known. */
  const firstScored = (): boolean => counts.launches >= 1 && game.rolls.length >= counts.launches;
  const bowledAgain = (): boolean => counts.launches >= launchesAtEnter + 1;
  /** A frame is over: nothing in flight, a new ball went, and the next ball opens a frame. */
  const frameDone = (): boolean =>
    counts.launches >= launchesAtEnter + 1 &&
    game.rolls.length >= counts.launches &&
    game.next.ball === 0;

  /** The line for a gutter or a strike on the ball just counted. */
  const lastBall = (): string | null => {
    if (counts.lastKind === 'gutter') return GUTTER;
    return null;
  };
  /** The first ball was a strike: the rack is full again, so there is nothing left to knock down. */
  const afterStrike = (): string | undefined =>
    counts.lastKind === 'strike' ? 'A strike! Bowl again' : undefined;
  const afterStrikeDetail = (): string | undefined =>
    counts.lastKind === 'strike'
      ? 'A strike clears every pin, so the rack is full again.'
      : undefined;
  const problemText = (): string | null => {
    switch (body?.problem()) {
      case 'lost':
        return NO_BODY;
      case 'move-left':
        return MOVE_LEFT;
      case 'move-right':
        return MOVE_RIGHT;
      case 'step-back':
        return STEP_BACK;
      case 'step-closer':
        return STEP_CLOSER;
      case 'hands-out-of-view':
        return SHOW_ARMS;
      default:
        return null;
    }
  };

  /** Camera feedback for "a ball must go": why the swing did not launch it. */
  const swingFeedback = (now: number): string | null => {
    if (!waited(now) || counts.launches > launchesAtEnter) return null;
    if (game.phase === 'pickup') return PICK_UP;
    if (body !== null && !body.handPresent()) return NO_ARM;
    const rej = body?.rejected();
    if (rej !== undefined && rej.seq !== rejectAtEnter && rej.kind === 'throw') {
      if (rej.reason === 'lost') return NO_ARM;
      if (rej.reason === 'steep') return SWING_LOW;
      return SWING_FASTER;
    }
    if (counts.weak > weakAtEnter) return SWING_FASTER;
    if (counts.windups === windupsAtEnter) return SWING_BACK;
    return LET_GO;
  };

  /** Feedback for the later steps: the gutter, a strike where a spare was meant, or no ball yet. */
  const nextBallFeedback = (now: number): string | null => {
    if (!waited(now)) return null;
    const last = lastBall();
    if (last !== null) return last;
    if (counts.lastKind === 'strike' && !env.mouse && game.next.ball === 0) return STRIKE_AGAIN;
    if (game.phase === 'pickup') return env.mouse ? PRESS_HOLD : PICK_UP;
    if (game.phase === 'aim') return env.mouse ? RELEASE_BUTTON : LET_GO;
    return null;
  };

  const cameraSteps: TutorialStep[] = [
    {
      text: 'Stand so I can see your whole body',
      detail: 'Step back until your arms and legs are in view.',
      praise: 'Got you',
      enter() {
        enterPlain();
        probe.gate = 0;
        trackedSinceMs = -1;
      },
      done(now) {
        begin(now);
        if (body !== null && body.tracking() && trackedOk(body.problem())) {
          if (trackedSinceMs < 0) trackedSinceMs = now;
        } else trackedSinceMs = -1;
        return trackedSinceMs >= 0 && now - trackedSinceMs >= cfg.tutorialTrackedMs;
      },
      feedback(now) {
        if (!waited(now)) return null;
        return problemText() ?? NO_BODY;
      },
    },
    {
      text: 'Close your fist to pick up the ball',
      detail: 'Or hold your hand still and low for a moment.',
      praise: 'Ball in hand',
      enter() {
        enterPlain();
        probe.gate = 1;
      },
      done(now) {
        begin(now);
        return counts.pickups >= 1;
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (body !== null && !body.handPresent()) return NO_HAND;
        return MAKE_FIST;
      },
    },
    {
      text: 'Step or move your hand to line up the arrows',
      detail: 'The arrows show where the ball will go.',
      praise: 'Lined up',
      enter() {
        enterAim();
        probe.gate = 2;
      },
      done(now) {
        begin(now);
        return bowled() || aimMoved();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (game.phase === 'pickup') return PICK_UP;
        if (body !== null && !body.handPresent()) return NO_HAND;
        return SLIDE_HAND;
      },
    },
    {
      text: 'Swing back, then forward, and let go to bowl',
      detail: 'Pins you knock down show on the scorecard.',
      praise: 'Nice roll',
      enter() {
        enterPlain();
        probe.gate = 3;
      },
      done(now) {
        begin(now);
        return firstScored();
      },
      feedback: swingFeedback,
    },
    {
      text: 'Knock down what is left',
      detail: 'Two balls a frame. Clear every pin for a spare.',
      textNow: afterStrike,
      detailNow: afterStrikeDetail,
      praise: 'Good ball',
      enter: enterPlain,
      done(now) {
        begin(now);
        return bowledAgain();
      },
      feedback: nextBallFeedback,
    },
    {
      text: 'Curve your swing to hook the ball',
      detail: 'Sweep your hand in an arc as you let go.',
      praise: 'Nice curve',
      enter: enterPlain,
      done(now) {
        begin(now);
        return bowledAgain();
      },
      feedback(now) {
        const base = nextBallFeedback(now);
        if (base !== null) return base;
        if (!waited(now) || counts.launches <= launchesAtEnter) return null;
        return Math.abs(counts.lastHook) < cfg.tutorialHookMin ? CURVE_MORE : null;
      },
    },
    {
      text: 'Bowl one more frame for fun',
      detail: 'Strikes and spares score extra. Nothing is saved here.',
      praise: 'That is bowling',
      enter: enterPlain,
      done(now) {
        begin(now);
        return frameDone();
      },
      feedback: nextBallFeedback,
    },
  ];

  const mouseSteps: TutorialStep[] = [
    {
      text: 'Move the mouse to line up the arrows',
      detail: 'The arrows show where the ball will go.',
      praise: 'Lined up',
      enter: enterAim,
      done(now) {
        begin(now);
        return counts.pickups >= 1 || aimMoved();
      },
      feedback(now) {
        return waited(now) ? MOVE_MOUSE : null;
      },
    },
    {
      text: 'Press and hold the button to wind up',
      detail: 'The ball goes in your hand.',
      praise: 'Wound up',
      enter: enterPlain,
      done(now) {
        begin(now);
        return counts.pickups >= 1;
      },
      feedback(now) {
        return waited(now) ? PRESS_HOLD : null;
      },
    },
    {
      text: 'Let go of the button to bowl',
      detail: 'Pins you knock down show on the scorecard.',
      praise: 'Nice roll',
      enter: enterPlain,
      done(now) {
        begin(now);
        return firstScored();
      },
      feedback(now) {
        if (!waited(now) || bowled()) return null;
        return game.phase === 'aim' ? RELEASE_BUTTON : PRESS_HOLD;
      },
    },
    {
      text: 'Knock down what is left',
      detail: 'Two balls a frame. Clear every pin for a spare.',
      textNow: afterStrike,
      detailNow: afterStrikeDetail,
      praise: 'Good ball',
      enter: enterPlain,
      done(now) {
        begin(now);
        return bowledAgain();
      },
      feedback: nextBallFeedback,
    },
    {
      text: 'Bowl one more frame for fun',
      detail: 'Strikes and spares score extra. Nothing is saved here.',
      praise: 'That is bowling',
      enter: enterPlain,
      done(now) {
        begin(now);
        return frameDone();
      },
      feedback: nextBallFeedback,
    },
  ];

  const steps = env.mouse ? mouseSteps : cameraSteps;
  const runner = new TutorialRunner(env.coach, steps, env.onFinished);

  return {
    update(nowMs: number): void {
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
      runner.dispose();
    },
  };
}
