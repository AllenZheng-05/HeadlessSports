/** Fixed simulation step, seconds (120 Hz). */
export const FIXED_DT = 1 / 120;

/** Real frame gaps longer than this are clamped (tab switches, debugger pauses). */
const MAX_REAL_DT_MS = 100;
const EPSILON = 1e-9;

export interface LoopCallbacks {
  /** Start of every rendered frame, before fixed steps. `nowMs` is game time. */
  begin(nowMs: number, dt: number): void;
  fixed(dt: number, nowMs: number): void; // 120 Hz
  frame(dt: number, nowMs: number, alpha: number): void; // once per rendered frame, after fixed steps
}

/**
 * requestAnimationFrame loop with a fixed-step accumulator. Per frame: `begin`, `fixed` x N,
 * `frame`. Allocation-free after construction.
 */
export class GameLoop {
  /**
   * Game time in ms. With timeScale 1 this IS the requestAnimationFrame timestamp (the
   * performance.now timeline), so camera-clock frame times are directly comparable. With another
   * timeScale it is an accumulated scaled clock starting from the first frame's timestamp.
   */
  nowMs = 0;
  /** While true: begin() and frame() still run (dt 0), fixed() does not. */
  paused = false;

  private readonly callbacks: LoopCallbacks;
  private readonly timeScale: number;
  private readonly maxSteps: number;
  private accumulator = 0;
  private lastTs = 0;
  private started = false;
  private rafId = 0;
  private running = false;
  private readonly onRaf = (ts: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.onRaf);
    this.step(ts);
  };

  constructor(
    callbacks: LoopCallbacks,
    options: { timeScale?: number; maxStepsPerFrame?: number } = {},
  ) {
    this.callbacks = callbacks;
    this.timeScale = options.timeScale ?? 1;
    this.maxSteps = options.maxStepsPerFrame ?? Math.ceil(12 * this.timeScale);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame(this.onRaf);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Advance manually (tests): exactly as one animation frame of `realDtMs`. */
  tick(realDtMs: number): void {
    if (!this.started) {
      this.started = true;
      this.lastTs = 0;
      this.nowMs = 0;
    }
    this.step(this.lastTs + realDtMs);
  }

  private step(ts: number): void {
    let realMs = 0;
    if (!this.started) {
      this.started = true;
      this.nowMs = ts;
    } else {
      realMs = ts - this.lastTs;
      if (realMs < 0) realMs = 0;
      if (realMs > MAX_REAL_DT_MS) realMs = MAX_REAL_DT_MS;
    }
    this.lastTs = ts;
    const gameMs = realMs * this.timeScale;
    this.nowMs = this.timeScale === 1 ? ts : this.nowMs + gameMs;
    const cb = this.callbacks;

    if (this.paused) {
      this.accumulator = 0;
      cb.begin(this.nowMs, 0);
      cb.frame(0, this.nowMs, 0);
      return;
    }

    const dt = gameMs / 1000;
    cb.begin(this.nowMs, dt);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT - EPSILON) {
      if (steps === this.maxSteps) {
        this.accumulator = 0; // drop the remainder: a slow frame must not spiral
        break;
      }
      cb.fixed(FIXED_DT, this.nowMs);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    cb.frame(dt, this.nowMs, this.accumulator / FIXED_DT);
  }
}
