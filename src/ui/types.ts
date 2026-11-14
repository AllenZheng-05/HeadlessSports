/**
 * Contract between the game shell (src/core) and the DOM interface (src/ui). Types only.
 *
 * The UI is plain DOM over the canvas. Every screen is usable by mouse, by keyboard, and by
 * hand (a hand cursor with hold-to-select) once an input provider is attached. Screens that
 * wait for a choice return a Promise, so the shell's flow reads as one async function.
 */

import type { GateReport } from '../core/gate/types';
import type { AudioKit, Hud, RoundResult, SportMeta, Tunables } from '../core/sport';
import type { FrameProblem, InputProvider, Side } from '../input/types';
import type { TrackingErrorCode } from '../tracking/types';

export type CalibrationStep = 'position' | 'lighting' | 'handedness' | 'hold-still' | 'done';

/** What the calibration screen should show right now. The shell pushes this every frame. */
export interface CalibrationView {
  step: CalibrationStep;
  /** Main instruction, e.g. 'Step back until your whole body is inside the outline'. */
  message: string;
  /** Secondary hint, e.g. 'It is a bit dark. Turn on a light or face a window.' Null for none. */
  hint: string | null;
  /** Progress of the current hold, 0..1. */
  progress: number;
  /** The player currently satisfies the current step. */
  ok: boolean;
  problem: FrameProblem;
  handedness: Side | null;
}

export interface CalibrationScreen {
  set(view: CalibrationView): void;
  /** Resolves if the player presses "Skip" (mouse or keyboard only). */
  readonly skipped: Promise<void>;
  /**
   * Registers the handler for the "I'm sitting down" toggle (shown only when the sport allows
   * sitting). Called with the new state each time the player flips it.
   */
  onSeated?(handler: (seated: boolean) => void): void;
  close(): void;
}

export interface HowToOptions {
  handedness: Side;
  onHandedness(side: Side): void;
}

export interface ResultsOutcome {
  isBest: boolean;
  /** Personal best after this round, in the sport's unit. */
  best: number | null;
}

export interface Ui {
  readonly hud: Hud;
  readonly audio: AudioKit;
  readonly tunables: Tunables;

  /**
   * Call once per rendered frame. Drives the hand cursor, hold-to-select, the mirror view
   * and HUD animations. Must not allocate.
   */
  update(dt: number, nowMs: number): void;

  /**
   * Attach or detach the input provider. While attached, the hand cursor works on every
   * screen and the corner mirror view shows the camera with the skeleton overlay.
   */
  setInput(input: InputProvider | null): void;

  /**
   * Full-screen loading state with optional progress 0..1. With `onCancel` the screen shows a
   * "Back" button (and Escape) that calls it, so a stalled sport load can be abandoned.
   */
  showLoading(text: string, progress?: number, onCancel?: () => void): void;

  /**
   * Terminal screen: a capability the game cannot start without is missing (WebGL 2, workers).
   * Measured numbers sit behind "details".
   */
  showGateFail(report: GateReport): void;

  /**
   * "This device may struggle": the gate failed for a performance or comfort reason. Resolves
   * when the player chooses "Play anyway". Measured numbers sit behind "details".
   */
  showGateWarning(report: GateReport): Promise<void>;

  /** Title screen with the wordmark and a Start button. Resolves when Start is chosen. */
  showTitle(): Promise<void>;

  /** Says plainly that video stays on this device, before the browser prompt. Resolves on Continue. */
  showCameraIntro(): Promise<void>;

  /** Camera could not start. Per-browser instructions for 'camera-denied'. */
  showCameraError(code: TrackingErrorCode): Promise<'retry' | 'debug'>;

  /**
   * Sport picker. Resolves with the chosen sport id. `notice` is a short message shown for a few
   * seconds (an aria-live region), for example when the last round broke.
   */
  showMenu(
    sports: readonly SportMeta[],
    bests: ReadonlyMap<string, number>,
    notice?: string,
  ): Promise<string>;

  /**
   * How-to card for a sport, with the safety reminder when `meta.needsSpace`. With `options`
   * (non-camera input) the card shows a "Dominant hand: Right / Left" toggle.
   */
  showHowTo(
    meta: SportMeta,
    debugInput: boolean,
    options?: HowToOptions,
  ): Promise<'start' | 'back'>;

  /** Calibration guide (silhouette for the sport's stance) over the mirrored camera view. */
  showCalibration(meta: SportMeta): CalibrationScreen;

  /** Hide every screen; show the HUD and the corner mirror. The camera indicator shows on every screen while the camera is active. */
  showPlaying(meta: SportMeta): void;

  /** Pause overlay with a large arrow or message for the given problem. Null hides it. */
  showPause(problem: FrameProblem | null): void;

  showResults(
    meta: SportMeta,
    result: RoundResult,
    outcome: ResultsOutcome,
  ): Promise<'again' | 'menu'>;

  /** The one-click camera-off control was used. */
  onCameraOff(handler: () => void): void;
  /** The player asked to quit the current round (Escape or the on-screen control). */
  onQuit(handler: () => void): void;
  /**
   * The "How to play" overlay opened (true) or closed (false) during a round. The shell pauses
   * the round while it is open. Also called with false when the overlay goes away with its screen.
   */
  onHowToPlay(handler: (open: boolean) => void): void;

  /** Camera-on indicator state. */
  setCameraActive(active: boolean): void;

  dispose(): void;
}
