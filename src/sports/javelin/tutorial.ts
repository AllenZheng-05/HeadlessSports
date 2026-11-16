import type { Coach } from '../../core/sport';
import { TutorialRunner } from '../../core/tutorial/TutorialRunner';
import type { TutorialStep } from '../../core/tutorial/TutorialRunner';
import type { FrameProblem } from '../../input/types';
import type { TutorialProbe } from './bot';
import type { JavelinConfig } from './config';
import { distanceToLine, restartAttempt } from './game';
import type { GameState } from './game';

export interface TutorialEnv {
  cfg: JavelinConfig;
  game: GameState;
  /** The throwing hand. */
  hand: 'left' | 'right';
  coach: Coach;
  /** Mouse play (camera off) gets the mouse steps. */
  mouse: boolean;
  /** Camera play: is a body tracked, and what the tracker says is wrong when it is not. */
  body(): { tracking: boolean; problem: FrameProblem };
  /** Why the last refused throw was refused, while it is still worth showing; '' for none. */
  notice(): string;
  /** The bot reads this to know what the current step asks of it. */
  probe: TutorialProbe;
  /** The last step is done. */
  onFinished(): void;
}

export interface JavelinTutorial {
  update(nowMs: number): void;
  /** Current step index (0-based); the step count once finished. */
  readonly step: number;
  readonly stepCount: number;
  readonly finished: boolean;
  /** The speed meter belongs to the running steps. */
  readonly showSpeed: boolean;
  /** The foul line meter belongs to the run-up steps. */
  readonly showLine: boolean;
  /** From the run-up step on the athlete may reach the line; before it she is held short of it. */
  readonly free: boolean;
  dispose(): void;
}

// Lines that say why the action has not counted yet.
const NO_BODY = "I can't see you";
const STEP_BACK = 'Step back a little';
const STEP_CLOSER = 'Step a little closer';
const MOVE_LEFT = 'Move a little to the left';
const MOVE_RIGHT = 'Move a little to the right';
const MORE_LEGS = 'Lift your knees or pump your arms a little more';
const FASTER = 'Jog faster, with bigger steps';
const THROW_MOTION = 'Throw with a quick motion, forward';
const JOG_FIRST = 'Jog on the spot to build speed';
const THROW_NOW = 'Throw now';
const CROSSED = 'You crossed the line. Throw a little sooner';
const RUN_FIRST = 'Run first, then throw';
const RUN_FIRST_MOUSE = 'Hold the button a little longer to run';
const HOLD_BUTTON = 'Press and hold the mouse button';
const KEEP_HOLDING = 'Keep the button down to speed up';
const LET_GO_NOW = 'Let go now';

/**
 * The athlete is held this far short of the foul line (metres) until the run-up step, so the
 * running steps can go on as long as the player likes. Call after every rules step.
 */
export function holdBack(game: GameState, cfg: JavelinConfig): void {
  if (game.phase !== 'run') return;
  const cap = cfg.runwayLength - cfg.tutorialHoldBackM;
  if (game.position > cap) game.position = cap;
}

/**
 * The javelin tutorial: camera steps (see you, jog, jog faster, a standing throw, a run-up throw,
 * one more) or mouse steps (hold to run, let go before the line, one more). Everything is read
 * from the rules' own state, so the synthetic bot can finish it. Conditions are state based and a
 * landing is latched by its counter, so nothing is missed while the praise is on screen.
 */
export function createJavelinTutorial(env: TutorialEnv): JavelinTutorial {
  const { cfg, game, probe } = env;
  let lastNow = 0;
  let fresh = false;
  let stepStartMs = 0;
  let since = -1;
  let entryLand = game.landSeq;
  let seenLand = game.landSeq;
  /** The explanation of the last landing that did not count, and when it appeared. */
  let msg = '';
  let msgAtMs = -1e9;
  let free = false;
  let speedOn = false;
  let lineOn = false;

  const begin = (now: number): void => {
    if (!fresh) return;
    fresh = false;
    stepStartMs = now;
  };
  const waited = (now: number): boolean => now - stepStartMs >= cfg.tutorialHintDelayMs;
  const holdFor = (now: number, ok: boolean, ms: number): boolean => {
    if (!ok) {
      since = -1;
      return false;
    }
    if (since < 0) since = now;
    return now - since >= ms;
  };

  /** Sees each new landing once: a foul or a throw without a run-up gets its explanation. */
  const observe = (now: number): void => {
    if (game.landSeq === seenLand) return;
    seenLand = game.landSeq;
    if (game.lastFoul) {
      msg = CROSSED;
      msgAtMs = now;
    } else if (free && game.release.runSpeed < cfg.tutorialMinRunSpeed) {
      msg = env.mouse ? RUN_FIRST_MOUSE : RUN_FIRST;
      msgAtMs = now;
    }
  };
  const explained = (now: number): string | null =>
    now - msgAtMs < cfg.tutorialFoulMs ? msg : null;

  /** A legal landing since the step began (any run speed). */
  const landed = (): boolean => game.landSeq !== entryLand && !game.lastFoul;
  /** ...after a real run-up. */
  const landedRunning = (): boolean => landed() && game.release.runSpeed >= cfg.tutorialMinRunSpeed;

  /** Set the rules up for a step. `restart` starts a fresh run-up at once. */
  const enterStep = (hold: boolean, standing: boolean, isFree: boolean, restart: boolean): void => {
    fresh = true;
    since = -1;
    msg = '';
    msgAtMs = -1e9;
    game.noThrow = hold;
    game.standing = standing;
    probe.hold = hold;
    probe.standing = standing;
    free = isFree;
    lineOn = isFree;
    if (restart) restartAttempt(game, cfg, lastNow);
    entryLand = game.landSeq;
    seenLand = game.landSeq;
  };

  const bodyProblem = (): string => {
    switch (env.body().problem) {
      case 'step-back':
        return STEP_BACK;
      case 'step-closer':
        return STEP_CLOSER;
      case 'move-left':
        return MOVE_LEFT;
      case 'move-right':
        return MOVE_RIGHT;
      default:
        return NO_BODY;
    }
  };

  const nearLine = (): boolean =>
    game.phase === 'run' && distanceToLine(game, cfg) <= cfg.throwZone;

  const cameraSteps: TutorialStep[] = [
    {
      text: 'Stand so I can see your whole body',
      detail: 'I can still follow you if your feet are out of view.',
      praise: 'Got you',
      enter() {
        enterStep(true, false, false, false);
        speedOn = false;
      },
      done(now) {
        begin(now);
        return holdFor(now, env.body().tracking, cfg.tutorialSeeMs);
      },
      feedback(now) {
        return waited(now) && !env.body().tracking ? bodyProblem() : null;
      },
    },
    {
      text: 'Jog on the spot',
      detail: 'Your speed shows at the top of the screen.',
      praise: 'Nice pace',
      enter() {
        enterStep(true, false, false, false);
        speedOn = true;
      },
      done(now) {
        begin(now);
        return holdFor(now, game.cadenceNow >= cfg.tutorialJogCadence, cfg.tutorialJogMs);
      },
      feedback(now) {
        return waited(now) ? MORE_LEGS : null;
      },
    },
    {
      text: 'Jog faster: speed adds distance',
      detail: 'Quick feet make a quick athlete.',
      praise: 'Fast feet',
      enter() {
        enterStep(true, false, false, false);
        speedOn = true;
      },
      done(now) {
        begin(now);
        return holdFor(now, game.cadenceNow >= cfg.tutorialFastCadence, cfg.tutorialFastMs);
      },
      feedback(now) {
        return waited(now) ? FASTER : null;
      },
    },
    {
      text: `Raise your ${env.hand} hand over your shoulder and throw`,
      detail: 'Throw forward, with no run-up. The athlete throws from standing.',
      praise: 'Nice throw',
      enter() {
        enterStep(false, true, false, true);
        speedOn = false;
      },
      done(now) {
        begin(now);
        observe(now);
        return landed();
      },
      feedback(now) {
        const n = env.notice();
        if (n !== '') return n;
        return waited(now) ? THROW_MOTION : null;
      },
    },
    {
      text: 'Run up and throw before the line',
      detail: 'The foul line ends the runway. Throw before you reach it.',
      praise: 'Good run-up',
      enter() {
        enterStep(false, false, true, true);
        speedOn = true;
      },
      done(now) {
        begin(now);
        observe(now);
        return landedRunning();
      },
      feedback(now) {
        const e = explained(now);
        if (e !== null) return e;
        const n = env.notice();
        if (n !== '') return n;
        if (nearLine()) return THROW_NOW;
        return waited(now) && game.phase === 'run' && game.speed < cfg.tutorialMinRunSpeed
          ? JOG_FIRST
          : null;
      },
    },
    {
      text: 'One more for distance',
      detail: 'Faster feet and a strong throw go farther.',
      praise: 'Well thrown',
      enter() {
        enterStep(false, false, true, true);
        speedOn = true;
      },
      done(now) {
        begin(now);
        observe(now);
        return landed();
      },
      feedback(now) {
        const e = explained(now);
        if (e !== null) return e;
        const n = env.notice();
        if (n !== '') return n;
        return nearLine() ? THROW_NOW : null;
      },
    },
  ];

  const mouseSteps: TutorialStep[] = [
    {
      text: 'Press and hold the button to run',
      detail: 'Your athlete runs while the button is down.',
      praise: 'Off you go',
      enter() {
        enterStep(true, false, false, false);
        speedOn = true;
      },
      done(now) {
        begin(now);
        return game.speed >= cfg.tutorialMouseSpeed;
      },
      feedback(now) {
        if (!waited(now)) return null;
        return game.speed < 0.5 ? HOLD_BUTTON : KEEP_HOLDING;
      },
    },
    {
      text: 'Let go before the line to throw',
      detail: 'The foul line ends the runway. The meter shows how far it is.',
      praise: 'Good throw',
      enter() {
        enterStep(false, false, true, true);
        speedOn = true;
      },
      done(now) {
        begin(now);
        observe(now);
        return landedRunning();
      },
      feedback(now) {
        const e = explained(now);
        if (e !== null) return e;
        if (nearLine()) return LET_GO_NOW;
        return waited(now) && game.phase === 'run' && game.speed < 0.5 ? HOLD_BUTTON : null;
      },
    },
    {
      text: 'One more for distance',
      detail: 'Run until you are close, then let go.',
      praise: 'Well thrown',
      enter() {
        enterStep(false, false, true, true);
        speedOn = true;
      },
      done(now) {
        begin(now);
        observe(now);
        return landed();
      },
      feedback(now) {
        const e = explained(now);
        if (e !== null) return e;
        return nearLine() ? LET_GO_NOW : null;
      },
    },
  ];

  const steps = env.mouse ? mouseSteps : cameraSteps;
  // The first steps are about running only: no throw is taken before the throwing steps.
  game.noThrow = true;
  probe.hold = true;
  const runner = new TutorialRunner(env.coach, steps, env.onFinished);

  return {
    update(nowMs: number): void {
      lastNow = nowMs;
      observe(nowMs);
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
    get showSpeed(): boolean {
      return speedOn;
    },
    get showLine(): boolean {
      return lineOn;
    },
    get free(): boolean {
      return free;
    },
    dispose(): void {
      game.noThrow = false;
      game.standing = false;
      probe.hold = false;
      probe.standing = false;
      runner.dispose();
    },
  };
}
