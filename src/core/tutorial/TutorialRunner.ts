import type { Coach } from '../sport';

export interface TutorialStep {
  /** Instruction text. */
  text: string;
  detail?: string;
  /**
   * Text and detail that depend on the state when the step begins: read once, right after
   * `enter`, and shown instead of `text` and `detail`. Return undefined to keep the static one.
   */
  textNow?(): string | undefined;
  detailNow?(): string | undefined;
  /** Called once when the step becomes current (set up the scene for it). */
  enter?(): void;
  /** Polled every frame: true once the player has done it. */
  done(nowMs: number): boolean;
  /** Polled every frame while waiting: why it has not counted yet, or null. */
  feedback?(nowMs: number): string | null;
  /** Confirmation text for this step. */
  praise?: string;
}

export interface TutorialRunnerOptions {
  /** How long the confirmation shows before the next step, game ms. */
  confirmMs?: number;
  /** A step cannot complete sooner than this after it appeared, game ms. */
  minShowMs?: number;
}

export const DEFAULT_CONFIRM_MS = 900;
export const DEFAULT_MIN_SHOW_MS = 800;

/**
 * Walks a list of steps through the coach panel. Call `update(nowMs)` once per frame (not while
 * the round is paused). A step shows its text, waits for `done` (at least `minShowMs`), shows
 * the praise for `confirmMs`, then enters the next step. "Skip step" jumps ahead at once. After
 * the last step `onFinished` runs exactly once. No allocation per update; deterministic on the
 * game ms it is given.
 */
export class TutorialRunner {
  private readonly coach: Coach;
  private readonly steps: readonly TutorialStep[];
  private readonly onFinished: () => void;
  private readonly confirmMs: number;
  private readonly minShowMs: number;
  private readonly unregisterSkip: () => void;
  private entered = false;
  private satisfied = false;
  private praising = false;
  private startMs = 0;
  private praiseUntilMs = 0;
  private skipRequested = false;
  private lastFeedback: string | null = null;
  private disposed = false;
  private current = 0;
  private done = false;

  constructor(
    coach: Coach,
    steps: readonly TutorialStep[],
    onFinished: () => void,
    opts: TutorialRunnerOptions = {},
  ) {
    this.coach = coach;
    this.steps = steps;
    this.onFinished = onFinished;
    this.confirmMs = opts.confirmMs ?? DEFAULT_CONFIRM_MS;
    this.minShowMs = opts.minShowMs ?? DEFAULT_MIN_SHOW_MS;
    this.unregisterSkip = coach.onSkip(() => {
      this.skipRequested = true;
    });
    if (steps.length === 0) this.finish();
  }

  /** Index of the current step, or the number of steps when finished. */
  get index(): number {
    return this.current;
  }

  get finished(): boolean {
    return this.done;
  }

  update(nowMs: number): void {
    if (this.done || this.disposed) return;
    const step = this.steps[this.current] as TutorialStep;
    if (!this.entered) this.enter(step, nowMs);

    if (this.skipRequested) {
      this.skipRequested = false;
      this.advance(nowMs);
      return;
    }
    if (this.praising) {
      if (nowMs >= this.praiseUntilMs) this.advance(nowMs);
      return;
    }
    // Poll every frame, so a condition that is only true for a moment is not missed while the
    // step's text is still on its minimum reading time.
    if (!this.satisfied && step.done(nowMs)) this.satisfied = true;
    if (this.satisfied && nowMs - this.startMs >= this.minShowMs) {
      this.praising = true;
      this.praiseUntilMs = nowMs + this.confirmMs;
      this.lastFeedback = null;
      this.coach.setFeedback(null);
      this.coach.confirm(step.praise);
      return;
    }
    if (step.feedback !== undefined) {
      const text = step.feedback(nowMs);
      if (text !== this.lastFeedback) {
        this.lastFeedback = text;
        this.coach.setFeedback(text);
      }
    }
  }

  /** Stop listening for Skip and hide the panel. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterSkip();
    this.coach.hide();
  }

  private enter(step: TutorialStep, nowMs: number): void {
    this.entered = true;
    this.satisfied = false;
    this.praising = false;
    this.startMs = nowMs;
    this.lastFeedback = null;
    step.enter?.();
    const text = step.textNow?.() ?? step.text;
    const detail = step.detailNow?.() ?? step.detail ?? null;
    this.coach.show(this.current, this.steps.length, text, detail);
    this.coach.setFeedback(null);
  }

  private advance(_nowMs: number): void {
    this.current++;
    this.entered = false;
    if (this.current >= this.steps.length) this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.current = this.steps.length;
    this.onFinished();
  }
}
