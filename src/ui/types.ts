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
  close(): void;
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

  /** Full-screen loading state with optional progress 0..1. */
  showLoading(text: string, progress?: number): void;

  /** Terminal screen: this device cannot run the game. Measured numbers sit behind "details". */
  showGateFail(report: GateReport): void;

  /** Title screen with the wordmark and a Start button. Resolves when Start is chosen. */
  showTitle(): Promise<void>;

  /** Says plainly that video stays on this device, before the browser prompt. Resolves on Continue. */
  showCameraIntro(): Promise<void>;

  /** Camera could not start. Per-browser instructions for 'camera-denied'. */
  showCameraError(code: TrackingErrorCode): Promise<'retry' | 'debug'>;

  /** Sport picker. Resolves with the chosen sport id. */
  showMenu(sports: readonly SportMeta[], bests: ReadonlyMap<string, number>): Promise<string>;

  /** How-to card for a sport, with the safety reminder when `meta.needsSpace`. */
  showHowTo(meta: SportMeta, debugInput: boolean): Promise<'start' | 'back'>;

  /** Calibration guide (silhouette for the sport's stance) over the mirrored camera view. */
  showCalibration(meta: SportMeta): CalibrationScreen;

  /** Hide every screen; show the HUD, the corner mirror and the camera-on indicator. */
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

  /** Camera-on indicator state. */
  setCameraActive(active: boolean): void;

  dispose(): void;
}
