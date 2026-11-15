import { StepEvent } from './draw';
import type { DrawPhase, Hint, Shot, StepEventValue } from './draw';

/** The slice of draw state the sport reads, shared by the camera machine and the mouse draw. */
export interface DrawState {
  readonly phase: DrawPhase;
  readonly hint: Hint;
  readonly draw: number;
  readonly holdFullS: number;
  readonly shot: Shot;
  unlock(): void;
}

export interface MouseDrawConfig {
  /** Seconds of holding the button from nock to full draw. */
  mouseDrawS: number;
  /** Below this draw the release puts the arrow back instead of shooting it. */
  minDraw: number;
  furtherHintMs: number;
}

/**
 * Camera-off draw: pressing the button nocks and starts the draw at once, the draw fills linearly
 * to full over `mouseDrawS` and stays there while held, releasing shoots with that draw. A tap
 * shorter than `minDraw` of the draw time puts the arrow back with a hint. Pure and deterministic;
 * it sees the pointer counters, never the DOM.
 */
export class MouseDraw implements DrawState {
  phase: DrawPhase = 'ready';
  hint: Hint = 'nock';
  draw = 0;
  holdFullS = 0;
  readonly shot: Shot = { draw: 0, yaw: 0, pitch: 0 };

  private readonly cfg: MouseDrawConfig;
  private elapsedS = 0;
  private seenPresses = 0;
  private seenReleases = 0;
  private queued = false;
  private furtherMs = 0;

  constructor(cfg: MouseDrawConfig, presses = 0, releases = 0) {
    this.cfg = cfg;
    this.seenPresses = presses;
    this.seenReleases = releases;
  }

  /** Back to ready for the next arrow; a press made while the arrow flew is kept if still held. */
  unlock(): void {
    this.toReady();
    this.hint = 'nock';
  }

  /** Drop a draw in progress and forget unseen presses (after a pause). */
  cancel(presses: number, releases: number): void {
    this.toReady();
    this.queued = false;
    this.furtherMs = 0;
    this.hint = 'nock';
    this.seenPresses = presses;
    this.seenReleases = releases;
  }

  private toReady(): void {
    this.phase = 'ready';
    this.draw = 0;
    this.holdFullS = 0;
    this.elapsedS = 0;
  }

  step(
    dt: number,
    down: boolean,
    presses: number,
    releases: number,
    yaw: number,
    pitch: number,
  ): StepEventValue {
    const pressed = presses > this.seenPresses;
    const released = releases > this.seenReleases;
    this.seenPresses = presses;
    this.seenReleases = releases;

    if (this.phase === 'locked') {
      if (pressed) this.queued = true;
      return StepEvent.None;
    }

    let nocked = false;
    if (this.phase === 'ready') {
      if (this.furtherMs > 0) {
        this.furtherMs -= dt * 1000;
        this.hint = this.furtherMs > 0 ? 'further' : 'nock';
      }
      if (pressed) this.queued = true;
      if (!this.queued) return StepEvent.None;
      this.queued = false;
      // A press that was let go again before it could start (kept from a past arrow) is dropped.
      if (!down && !pressed) return StepEvent.None;
      this.phase = 'drawing';
      this.elapsedS = 0;
      this.draw = 0;
      this.holdFullS = 0;
      this.hint = 'pull';
      nocked = true;
    }

    // Drawing.
    this.elapsedS += dt;
    const full = Math.max(1e-3, this.cfg.mouseDrawS);
    this.draw = this.elapsedS >= full ? 1 : this.elapsedS / full;
    if (this.draw >= 1) this.holdFullS += dt;
    this.hint = this.draw < this.cfg.minDraw ? 'pull' : 'aim';

    if (released || !down) {
      this.shot.draw = this.draw;
      this.shot.yaw = yaw;
      this.shot.pitch = pitch;
      if (this.draw >= this.cfg.minDraw) {
        this.phase = 'locked';
        this.holdFullS = 0;
        return StepEvent.Shot;
      }
      this.toReady();
      this.furtherMs = this.cfg.furtherHintMs;
      this.hint = 'further';
      return StepEvent.Unnock;
    }
    return nocked ? StepEvent.Nock : StepEvent.None;
  }
}
