import type {
  FrameListener,
  LandmarkFrame,
  LandmarkSource,
  LandmarkSourceKind,
  TrackerNeeds,
  TrackingStats,
} from '../types';

/** A background tab must not be able to emit an unbounded burst of frames. */
export const MAX_FRAMES_PER_PUMP = 10;

/**
 * Shared machinery of the stepped sources (synthetic player and clip replayer). `pump(nowMs)` is the
 * only clock: the first pump after `start` anchors time zero, then every frame whose due time has
 * passed is delivered synchronously. No timers anywhere.
 */
export abstract class SteppedSource implements LandmarkSource {
  abstract readonly kind: LandmarkSourceKind;
  readonly video = null;
  readonly stats: TrackingStats = {
    inferenceMs: 0,
    trackingHz: 0,
    latencyMs: 0,
    droppedFrames: 0,
    delegate: 'none',
    inWorker: false,
  };

  protected readonly frame: LandmarkFrame;
  protected needs: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: false };
  protected anchor: number | null = null;
  /** Index of the next frame to emit, counted from the anchor. */
  protected next = 0;
  protected startDelayMs = 0;
  private running = false;
  private seq = 0;
  private listeners: readonly FrameListener[] = [];
  private hzStart = -1;
  private hzCount = 0;

  protected constructor(frame: LandmarkFrame) {
    this.frame = frame;
  }

  /** Due time of frame k relative to the anchor, ms. Infinity when there is no frame k. */
  protected abstract dueOffset(k: number): number;
  /** Index of the first frame due strictly after `rel` ms from the anchor. */
  protected abstract firstIndexAfter(rel: number): number;
  /** Fill the pose and hands of `frame` for frame k (due `rel` ms after the anchor). */
  protected abstract fill(k: number, rel: number, frame: LandmarkFrame): void;

  /** Forget the anchor so time zero is re-established at the next pump. */
  protected restart(): void {
    this.anchor = null;
    this.next = 0;
  }

  start(needs: TrackerNeeds): Promise<void> {
    this.needs = { ...needs };
    this.restart();
    this.hzStart = -1;
    this.running = true;
    return Promise.resolve();
  }

  setNeeds(needs: TrackerNeeds): Promise<void> {
    this.needs = { ...needs };
    return Promise.resolve();
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  stop(): void {
    this.running = false;
  }

  pump(nowMs: number): void {
    if (!this.running) return;
    if (this.anchor === null) this.anchor = nowMs + this.startDelayMs;
    const anchor = this.anchor;
    let emitted = 0;
    for (;;) {
      const off = this.dueOffset(this.next);
      if (off === Infinity) return;
      const due = anchor + off;
      if (due > nowMs) return;
      if (emitted >= MAX_FRAMES_PER_PUMP) {
        // Drop the rest of the backlog by advancing the schedule.
        const skipTo = this.firstIndexAfter(nowMs - anchor);
        if (skipTo > this.next) {
          this.stats.droppedFrames += skipTo - this.next;
          this.next = skipTo;
        }
        return;
      }
      this.emit(this.next, off, due);
      this.next++;
      emitted++;
    }
  }

  private emit(k: number, rel: number, due: number): void {
    const frame = this.frame;
    frame.t = due;
    frame.seq = ++this.seq;
    frame.inferenceMs = 0;
    this.fill(k, rel, frame);
    const needs = this.needs;
    if (!needs.pose) frame.hasPose = false;
    if (!needs.handCrops && !needs.fullFrameHands) {
      frame.hands[0].present = false;
      frame.hands[0].score = 0;
      frame.hands[1].present = false;
      frame.hands[1].score = 0;
    }
    const ls = this.listeners;
    for (const listener of ls) listener(frame);

    // Measured rate over roughly one second of emitted frames.
    if (this.hzStart < 0) {
      this.hzStart = due;
      this.hzCount = 0;
      return;
    }
    this.hzCount++;
    const span = due - this.hzStart;
    if (span >= 1000) {
      this.stats.trackingHz = (this.hzCount * 1000) / span;
      this.hzStart = due;
      this.hzCount = 0;
    }
  }
}
