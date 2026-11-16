import type { Coach } from '../../core/sport';
import { TutorialRunner } from '../../core/tutorial/TutorialRunner';
import type { TutorialStep } from '../../core/tutorial/TutorialRunner';
import type { InputState } from '../../input/types';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { TutorialProbe } from './bot';
import type { BattingConfig } from './config';
import { HOMER_FEET } from './config';
import { powerFromSpeed } from './judge';
import type { PitchResult, ResultKind } from './round';

/** How the pitching goes: none yet, slow practice pitches, or normal speed. */
export type PitchMode = 'off' | 'slow' | 'full';

/**
 * What the sport has seen so far, written by `index.ts` (and by the closed-loop test) through the
 * `note*` functions below, read by the steps. Everything is a number or a constant string, so
 * the steps can poll it every frame without allocating, and an event that happens while the praise
 * for the previous step is on screen is not lost.
 */
export interface TutorialFeed {
  /** Game ms of the latest SwingStarted / SwingPeak, and the peak's speed (sw/s). */
  startT: number;
  peakT: number;
  peakSpeed: number;
  /** The latest "why nothing counted" text and when it was said. */
  notice: string | null;
  noticeAtMs: number;
  /** Index of the latest resolved pitch, and what became of it. */
  lastIndex: number;
  lastKind: ResultKind;
  /** Timing error of the latest swing (ms, negative early), 0 without a swing. */
  lastError: number;
  /** 'early' | 'late' | 'under' | 'over' for a miss, '' otherwise. */
  lastReason: string;
  /** Index of the latest pitch that was hit (fair), 0 for none. */
  hitIndex: number;
}

export function createFeed(): TutorialFeed {
  return {
    startT: -1,
    peakT: -1,
    peakSpeed: 0,
    notice: null,
    noticeAtMs: -1e9,
    lastIndex: 0,
    lastKind: 'strike',
    lastError: 0,
    lastReason: '',
    hitIndex: 0,
  };
}

export function noteSwingStart(feed: TutorialFeed, t: number): void {
  feed.startT = t;
}

export function noteSwingPeak(feed: TutorialFeed, t: number, speed: number): void {
  feed.peakT = t;
  feed.peakSpeed = speed;
}

export function noteNotice(feed: TutorialFeed, text: string, nowMs: number): void {
  feed.notice = text;
  feed.noticeAtMs = nowMs;
}

export function noteResult(feed: TutorialFeed, r: PitchResult): void {
  feed.lastIndex = r.pitch.index;
  feed.lastKind = r.kind;
  const j = r.judgement;
  feed.lastError = j === null ? 0 : j.timingError;
  feed.lastReason = j === null || j.reason === null ? '' : j.reason;
  if (r.kind === 'hit') feed.hitIndex = r.pitch.index;
}

/** What the tutorial reads of the player's arms for the stance step. */
export interface StanceView {
  /** A body is tracked and its shoulders measured. */
  tracked: boolean;
  /** Wrists seen: 0, 1 or 2. */
  wrists: number;
  /** Distance between the wrists (sw), from the arms' shoulder-relative wrists; Infinity unless both are seen. */
  gap: number;
  /** Height of the seen wrists above the shoulder line (sw): lowest and highest. */
  lowY: number;
  highY: number;
  /** The faster of the seen wrists (sw/s). */
  speed: number;
}

export function createStanceView(): StanceView {
  return { tracked: false, wrists: 0, gap: Infinity, lowY: 0, highY: 0, speed: 0 };
}

/** Fill `out` from the filtered input state. Allocation-free. */
export function readStance(state: InputState, wristVisibility: number, out: StanceView): void {
  out.tracked = state.tracking && state.shoulderWidth > 0 && state.hasPose;
  out.wrists = 0;
  out.gap = Infinity;
  out.lowY = 0;
  out.highY = 0;
  out.speed = 0;
  if (!out.tracked) return;
  // Whether a wrist is seen is the one thing read from the pose: the input state has no flag.
  const p = state.pose;
  const lw = PoseIndex.LEFT_WRIST;
  const rw = PoseIndex.RIGHT_WRIST;
  const seenL = p[lw * POSE_STRIDE + 3]! >= wristVisibility;
  const seenR = p[rw * POSE_STRIDE + 3]! >= wristVisibility;
  const l = state.arms.left;
  const r = state.arms.right;
  if (seenL) {
    out.wrists++;
    out.lowY = l.wristY;
    out.highY = l.wristY;
    out.speed = l.speed;
  }
  if (seenR) {
    if (out.wrists === 0) {
      out.lowY = r.wristY;
      out.highY = r.wristY;
      out.speed = r.speed;
    } else {
      if (r.wristY < out.lowY) out.lowY = r.wristY;
      if (r.wristY > out.highY) out.highY = r.wristY;
      if (r.speed > out.speed) out.speed = r.speed;
    }
    out.wrists++;
  }
  if (seenL && seenR) {
    // The shoulders are one shoulder width apart, the left one on the screen's left, and each
    // wrist is measured from its own shoulder (x toward screen right, y up).
    out.gap = Math.hypot(1 + r.wristX - l.wristX, r.wristY - l.wristY);
  }
}

export interface TutorialEnv {
  cfg: BattingConfig;
  coach: Coach;
  feed: TutorialFeed;
  /** Mouse play (click to swing) gets its own, shorter steps. */
  mouse: boolean;
  /** Which way the batter's hands travel in the image: 1 toward screen right, -1 toward screen left. */
  direction: -1 | 1;
  /** Fills and returns the shared stance view (camera play). */
  stance(): StanceView;
  /** The number of pitches the round has started so far. */
  pitchesStarted(): number;
  /** Start or retime the pitching. */
  setPitching(mode: PitchMode): void;
  /** The bot reads this to know what the step wants. */
  probe: TutorialProbe;
  /** The last step is done. */
  onFinished(): void;
}

export interface BattingTutorial {
  update(nowMs: number): void;
  /** Current step index (0-based); the step count once finished. */
  readonly step: number;
  readonly stepCount: number;
  readonly finished: boolean;
  dispose(): void;
}

// Feedback lines: why the action has not counted yet.
const NOT_TRACKED = "I can't see you. Step back until your shoulders show";
const NO_HANDS = "I can't see your hands";
const HANDS_APART = 'Bring your hands closer together';
const HANDS_LOW = 'Hold your hands up at chest height';
const HOLD_STILL = 'Hold still for a moment';
const SWING_ACROSS_RIGHT = 'Swing your hands fast toward the right of the screen';
const SWING_ACROSS_LEFT = 'Swing your hands fast toward the left of the screen';
const A_BIT_GENTLE = 'A bit gentle. Swing a little faster';
const TOO_EARLY = 'Too early. Swing a little later';
const TOO_LATE = 'Too late. Swing a little sooner';
const UNDER_IT = 'Under it. Swing a little higher';
const OVER_IT = 'Over it. Swing a little lower';
const FOUL_EARLY = 'Foul, a little early';
const FOUL_LATE = 'Foul, a little late';
const NO_SWING = 'No swing. Swing as the ball reaches the plate';
const NO_CLICK = 'No click. Click as the ball reaches the plate';

/**
 * The batting tutorial: camera steps (stance, practice swings without a ball, then slow and
 * normal pitches) or mouse steps (watch a pitch, then click on time), one `TutorialRunner` over
 * them. Everything comes from the feed the sport fills, so the synthetic bot (which only plays
 * the game) can finish it. Nothing here can be lost: pitches keep coming and a miss only
 * explains itself.
 */
export function createBattingTutorial(env: TutorialEnv): BattingTutorial {
  const { cfg, feed, probe } = env;
  const right = env.direction > 0;
  let fresh = false;
  let stepStartMs = 0;
  /** Pitches with a higher index than this count for the step. */
  let entryIndex = 0;
  let sinceMs = -1;

  const begin = (now: number): void => {
    if (!fresh) return;
    fresh = false;
    stepStartMs = now;
  };
  const waited = (now: number): boolean => now - stepStartMs >= cfg.tutorialHintDelayMs;
  const enterPlain = (): void => {
    fresh = true;
    probe.stance = false;
    probe.practice = false;
    entryIndex = env.pitchesStarted();
    sinceMs = -1;
  };
  /**
   * Entering a pitching step. A slow step takes over from a slow step, so a pitch already coming
   * counts; a full-speed step only counts pitches planned after it began (a slow one may be set).
   */
  const enterPitching = (mode: PitchMode): void => {
    enterPlain();
    if (mode === 'slow') entryIndex = feed.lastIndex;
    env.setPitching(mode);
  };
  /** A condition that must hold for `ms` in a row. */
  const held = (now: number, ok: boolean, ms: number): boolean => {
    if (!ok) {
      sinceMs = -1;
      return false;
    }
    if (sinceMs < 0) sinceMs = now;
    return now - sinceMs >= ms;
  };
  const recentNotice = (now: number): string | null =>
    feed.notice !== null && now - feed.noticeAtMs < cfg.noticeMs ? feed.notice : null;
  /** A swing (start and peak) that happened after this step appeared. */
  const swungSince = (): boolean => feed.startT > stepStartMs && feed.peakT > stepStartMs;
  const gripOk = (v: StanceView): boolean =>
    v.wrists > 0 &&
    (v.wrists < 2 || v.gap <= cfg.tutorialStanceGapSw) &&
    v.lowY >= cfg.tutorialStanceMinY &&
    v.highY <= cfg.tutorialStanceMaxY;

  /** Feedback for the latest pitch since this step began: what to change. */
  const pitchFeedback = (): string | null => {
    if (feed.lastIndex <= entryIndex || feed.lastIndex < env.pitchesStarted()) return null;
    if (feed.lastKind === 'hit') return null;
    if (feed.lastKind === 'strike') return env.mouse ? NO_CLICK : NO_SWING;
    if (feed.lastKind === 'foul') return feed.lastError < 0 ? FOUL_EARLY : FOUL_LATE;
    switch (feed.lastReason) {
      case 'early':
        return TOO_EARLY;
      case 'late':
        return TOO_LATE;
      case 'under':
        return UNDER_IT;
      default:
        return OVER_IT;
    }
  };

  /** Something was seen but did not count, else the pitch's own explanation. */
  const pitchStepFeedback = (now: number): string | null => {
    const n = recentNotice(now);
    if (n !== null) return n;
    return pitchFeedback();
  };

  const powerPercent = (): number => Math.round(100 * powerFromSpeed(feed.peakSpeed, cfg));

  const distanceDetail = `Distance is in feet. Past ${HOMER_FEET} ft is a home run.`;

  const swingAcross = right ? SWING_ACROSS_RIGHT : SWING_ACROSS_LEFT;
  const facing = right ? 'right' : 'left';

  const practiceFirst: TutorialStep = {
    text: 'Swing across your body, fast',
    detail: `Hands together, toward the ${facing} of the screen. No ball yet.`,
    praise: 'Nice swing',
    enter() {
      enterPlain();
      probe.practice = true;
    },
    done(now) {
      begin(now);
      return swungSince();
    },
    feedback(now) {
      const n = recentNotice(now);
      if (n !== null) return n;
      return waited(now) ? swingAcross : null;
    },
  };

  const practiceSecond: TutorialStep = {
    text: 'Do it again, a little faster',
    detail: 'A faster swing hits the ball farther.',
    praise: 'Nice swing',
    enter() {
      enterPlain();
      probe.practice = true;
    },
    done(now) {
      begin(now);
      if (!swungSince() || powerFromSpeed(feed.peakSpeed, cfg) < cfg.tutorialMinPower) return false;
      // The measured power is the confirmation. Built once, when the swing counts.
      practiceSecond.praise = `Power ${powerPercent()}%`;
      return true;
    },
    feedback(now) {
      const n = recentNotice(now);
      if (n !== null) return n;
      if (swungSince()) return A_BIT_GENTLE;
      return waited(now) ? swingAcross : null;
    },
  };

  const cameraSteps: TutorialStep[] = [
    {
      text: 'Stand so I can see your shoulders and hands',
      detail: 'Stand back until your arms are in view.',
      praise: 'Got it',
      enter: enterPlain,
      done(now) {
        begin(now);
        const v = env.stance();
        return held(now, v.tracked && v.wrists > 0, cfg.tutorialTrackedMs);
      },
      feedback(now) {
        if (!waited(now)) return null;
        const v = env.stance();
        if (!v.tracked) return NOT_TRACKED;
        return v.wrists === 0 ? NO_HANDS : null;
      },
    },
    {
      text: 'Bring both hands together like holding a bat',
      detail: right
        ? 'Face the camera or turn sideways, both work. You swing toward the right of the screen.'
        : 'Face the camera or turn sideways, both work. You swing toward the left of the screen.',
      praise: 'Good stance',
      enter() {
        enterPlain();
        probe.stance = true;
      },
      done(now) {
        begin(now);
        const v = env.stance();
        return held(now, gripOk(v) && v.speed < cfg.tutorialStanceMaxSpeed, cfg.tutorialStanceMs);
      },
      feedback(now) {
        if (!waited(now)) return null;
        const v = env.stance();
        if (!v.tracked || v.wrists === 0) return NO_HANDS;
        if (v.wrists === 2 && v.gap > cfg.tutorialStanceGapSw) return HANDS_APART;
        if (v.lowY < cfg.tutorialStanceMinY || v.highY > cfg.tutorialStanceMaxY) return HANDS_LOW;
        return v.speed >= cfg.tutorialStanceMaxSpeed ? HOLD_STILL : null;
      },
    },
    practiceFirst,
    practiceSecond,
    {
      text: 'A slow pitch: swing as it reaches the plate',
      detail: 'The ring grows to the size of the plate as the ball arrives.',
      praise: 'You hit it',
      enter() {
        enterPitching('slow');
      },
      done(now) {
        begin(now);
        return feed.hitIndex > entryIndex;
      },
      feedback: pitchStepFeedback,
    },
    {
      text: 'Now hit one at full speed',
      detail: distanceDetail,
      praise: 'Nice hitting',
      enter() {
        enterPitching('full');
      },
      done(now) {
        begin(now);
        return feed.hitIndex > entryIndex || feed.lastIndex - entryIndex >= cfg.tutorialFullPitches;
      },
      feedback: pitchStepFeedback,
    },
  ];

  const mouseSteps: TutorialStep[] = [
    {
      text: 'Watch a pitch come in',
      detail: 'The ring on the plate shows where the ball arrives.',
      praise: 'There it goes',
      enter() {
        enterPitching('slow');
      },
      done(now) {
        begin(now);
        return feed.lastIndex > entryIndex;
      },
    },
    {
      text: 'Click as the ball reaches the plate',
      detail: 'This one is slow. A click is a swing, so time it.',
      praise: 'You hit it',
      enter() {
        enterPitching('slow');
      },
      done(now) {
        begin(now);
        return feed.hitIndex > entryIndex;
      },
      feedback: pitchStepFeedback,
    },
    {
      text: 'Now full speed: click to hit one',
      detail: distanceDetail,
      praise: 'Nice hitting',
      enter() {
        enterPitching('full');
      },
      done(now) {
        begin(now);
        return feed.hitIndex > entryIndex || feed.lastIndex - entryIndex >= cfg.tutorialFullPitches;
      },
      feedback: pitchStepFeedback,
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
      probe.stance = false;
      probe.practice = false;
      runner.dispose();
    },
  };
}
