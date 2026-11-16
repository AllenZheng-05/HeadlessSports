import type { Coach } from '../../core/sport';
import { TutorialRunner } from '../../core/tutorial/TutorialRunner';
import type { TutorialStep } from '../../core/tutorial/TutorialRunner';
import type { TutorialProbe } from './bot';
import type { ArcheryConfig } from './config';

/** What the tutorial reads of the sport. Plain getters over the sport's own state. */
export interface TutorialView {
  /** Camera play: shoulders and both wrists are seen. */
  tracked(): boolean;
  /** Camera play: the bow arm is raised (the game's own test). */
  bowUp(): boolean;
  /** 'ready', 'drawing', 'flying', 'showing' or 'finishing'. */
  phase(): string;
  /** Smoothed draw, 0..1. */
  draw(): number;
  /** Camera play: drawing, but the hands are out of sight and the draw is being held. */
  lost(): boolean;
  /** Distance from the target centre of the full-draw landing point for the current aim, m. */
  aimOff(): number;
  /** Arrows released so far. */
  launched(): number;
  /** Arrows that have landed so far. */
  impacts(): number;
}

export interface TutorialEnv {
  cfg: ArcheryConfig;
  coach: Coach;
  /** Mouse play: pointer steps instead of the body steps. */
  mouse: boolean;
  view: TutorialView;
  /** The bot reads this to know when it may shoot. */
  probe: TutorialProbe;
  /** The last step is done. */
  onFinished(): void;
}

export interface ArcheryTutorial {
  update(nowMs: number): void;
  /** An arrow landed with this ring (0 is a miss): the praise for the last step names it. */
  noteImpact(ring: number): void;
  /** Current step index (0-based); the step count once finished. */
  readonly step: number;
  readonly stepCount: number;
  readonly finished: boolean;
  dispose(): void;
}

const NO_HANDS = "I can't see your hands yet";
const LOST_HOLD = 'I lost your hand. Hold on, the draw is safe';
const RAISE_ARM = 'Raise your arm to shoulder height';
const KEEP_ARM = 'Keep your bow arm up';
const FIST_NEXT = 'Bring your fist right next to your bow hand';
const NOCK_AGAIN = 'Put your fist next to your bow hand to nock again';
const FURTHER = 'Pull back a little further';
const AIM_CIRCLE = 'Move your bow arm until the circle is on the target';
const OPEN_WIDE = 'Open your hand wide';
const PULL_FIRST = 'Pull back first, then open your hand';
const AGAIN = 'Nock, pull back, then open your hand';
const POINTER_ON = 'Move the pointer over the target';
const PRESS_HOLD = 'Press and hold the button';
const KEEP_HOLDING = 'Keep the button down';
const LET_GO = 'Let go of the button';
const HOLD_FIRST = 'Hold the button to draw first';
const AGAIN_MOUSE = 'Hold to draw, then let go';

const RINGS_DETAIL = 'Rings score 1 to 10. The gold middle is 10.';

/**
 * The archery tutorial: body steps (camera) or pointer steps (mouse), one `TutorialRunner` over
 * them. Everything is read from the sport's state, and the facts that can pass while the praise
 * for the previous step is up (nocked, fully drawn, shot) are latched, so nothing is missed. A
 * shot counts for every earlier "nock, draw, aim" step. Nothing here can lose.
 */
export function createArcheryTutorial(env: TutorialEnv): ArcheryTutorial {
  const { cfg, view, probe } = env;
  let fresh = false;
  let stepStartMs = 0;
  let nockSeen = false;
  let fullSeen = false;
  let trackedSince = -1;
  let bowSince = -1;
  let aimSince = -1;
  let lostSince = -1;
  let ringPraise = 'Nice shot';
  // Arrows loosed before the "shoot more" step began (an arrow still in the air counts as one).
  let launchedAtEnter = 0;

  const begin = (now: number): void => {
    if (!fresh) return;
    fresh = false;
    stepStartMs = now;
  };
  const waited = (now: number): boolean => now - stepStartMs >= cfg.tutorialHintDelayMs;
  const shot = (): boolean => view.launched() >= 1;
  const drawing = (): boolean => view.phase() === 'drawing';

  /** Sees the facts once per frame, whichever step is on screen. */
  const observe = (now: number): void => {
    if (drawing()) {
      nockSeen = true;
      if (view.draw() >= cfg.tutorialDrawFull) fullSeen = true;
    }
    if (view.lost()) {
      if (lostSince < 0) lostSince = now;
    } else lostSince = -1;
  };

  /** True once the hand has been out of sight long enough to say so. */
  const handLost = (now: number): boolean =>
    lostSince >= 0 && now - lostSince >= cfg.tutorialLostMs;

  /** When a condition that must hold without a break began (-1 while it does not hold). */
  const held = (now: number, ok: boolean, since: number): number => {
    if (!ok) return -1;
    return since < 0 ? now : since;
  };

  const enterPlain = (): void => {
    fresh = true;
    trackedSince = -1;
    bowSince = -1;
    aimSince = -1;
  };

  const enterMore = (): void => {
    enterPlain();
    launchedAtEnter = view.launched();
  };
  const moreLanded = (): boolean => view.impacts() >= launchedAtEnter + cfg.tutorialMoreShots;

  const aimed = (now: number): boolean => {
    // Camera play also needs the bow drawn, so raising the arm on the way up does not count.
    const on = view.aimOff() <= cfg.tutorialAimRadiusM && (env.mouse || drawing());
    aimSince = held(now, on, aimSince);
    return aimSince >= 0 && now - aimSince >= cfg.tutorialAimHoldMs;
  };

  const cameraSteps: TutorialStep[] = [
    {
      text: 'Stand so I can see your shoulders and both hands',
      detail: 'Keep both hands in the picture.',
      praise: 'Got you',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        trackedSince = held(now, view.tracked(), trackedSince);
        return trackedSince >= 0 && now - trackedSince >= cfg.tutorialTrackedMs;
      },
      feedback(now) {
        return waited(now) && !view.tracked() ? NO_HANDS : null;
      },
    },
    {
      text: 'Hold your bow arm out to the side',
      detail: 'This is the arm that aims.',
      praise: 'Nice and steady',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        bowSince = held(now, view.bowUp(), bowSince);
        return nockSeen || (bowSince >= 0 && now - bowSince >= cfg.tutorialBowMs);
      },
      feedback(now) {
        if (!waited(now)) return null;
        return view.tracked() ? RAISE_ARM : NO_HANDS;
      },
    },
    {
      text: 'Bring your other hand to your bow hand and make a fist',
      detail: 'If I miss your fist, keep your hands together for a few seconds.',
      praise: 'Nocked',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        return nockSeen || shot();
      },
      feedback(now) {
        if (!waited(now)) return null;
        if (!view.tracked()) return NO_HANDS;
        return view.bowUp() ? FIST_NEXT : KEEP_ARM;
      },
    },
    {
      text: 'Pull your fist back toward your shoulder',
      detail: 'The draw meter shows how far you are.',
      praise: 'Full draw',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        return fullSeen || shot();
      },
      feedback(now) {
        if (handLost(now)) return LOST_HOLD;
        if (!waited(now)) return null;
        if (!drawing()) return NOCK_AGAIN;
        return view.bowUp() ? FURTHER : KEEP_ARM;
      },
    },
    {
      text: 'Move your bow arm to aim',
      detail: 'Put the circle on the target and hold it there.',
      praise: 'On target',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        return aimed(now) || shot();
      },
      feedback(now) {
        if (handLost(now)) return LOST_HOLD;
        if (!waited(now)) return null;
        if (!drawing()) return NOCK_AGAIN;
        return view.bowUp() ? AIM_CIRCLE : KEEP_ARM;
      },
    },
    {
      text: 'Open your hand to shoot',
      detail: 'Open the hand that is pulling the string.',
      praise: 'Away it goes',
      enter() {
        enterPlain();
        probe.hold = false;
      },
      done(now) {
        begin(now);
        observe(now);
        return shot();
      },
      feedback(now) {
        if (handLost(now)) return LOST_HOLD;
        if (!waited(now)) return null;
        if (!drawing()) return NOCK_AGAIN;
        return view.draw() < cfg.minDraw ? PULL_FIRST : OPEN_WIDE;
      },
    },
    {
      text: 'Shoot two more',
      detail: RINGS_DETAIL,
      get praise(): string {
        return ringPraise;
      },
      enter: enterMore,
      done(now) {
        begin(now);
        observe(now);
        return moreLanded();
      },
      feedback(now) {
        if (handLost(now)) return LOST_HOLD;
        return waited(now) && view.phase() === 'ready' ? AGAIN : null;
      },
    },
  ];

  const mouseSteps: TutorialStep[] = [
    {
      text: 'Move the mouse onto the target',
      detail: 'Your bow hand follows the pointer.',
      praise: 'On target',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        return aimed(now) || shot();
      },
      feedback(now) {
        return waited(now) ? POINTER_ON : null;
      },
    },
    {
      text: 'Hold the button until the draw is full',
      detail: 'The draw meter fills in under a second.',
      praise: 'Full draw',
      enter: enterPlain,
      done(now) {
        begin(now);
        observe(now);
        return fullSeen || shot();
      },
      feedback(now) {
        if (!waited(now)) return null;
        return drawing() ? KEEP_HOLDING : PRESS_HOLD;
      },
    },
    {
      text: 'Let go to shoot',
      detail: 'The arrow flies where the pointer is.',
      praise: 'Away it goes',
      enter() {
        enterPlain();
        probe.hold = false;
      },
      done(now) {
        begin(now);
        observe(now);
        return shot();
      },
      feedback(now) {
        if (!waited(now)) return null;
        return drawing() ? LET_GO : HOLD_FIRST;
      },
    },
    {
      text: 'Shoot two more',
      detail: RINGS_DETAIL,
      get praise(): string {
        return ringPraise;
      },
      enter: enterMore,
      done(now) {
        begin(now);
        observe(now);
        return moreLanded();
      },
      feedback(now) {
        return waited(now) && view.phase() === 'ready' ? AGAIN_MOUSE : null;
      },
    },
  ];

  // The bot keeps its full draw until the shoot step.
  probe.hold = true;
  const steps = env.mouse ? mouseSteps : cameraSteps;
  const runner = new TutorialRunner(env.coach, steps, env.onFinished);

  return {
    update(nowMs: number): void {
      observe(nowMs);
      runner.update(nowMs);
    },
    noteImpact(ring: number): void {
      ringPraise =
        ring === 10 ? 'Bullseye, 10' : ring === 0 ? 'Missed, no problem' : `Ring ${ring}`;
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
      probe.hold = false;
      runner.dispose();
    },
  };
}
