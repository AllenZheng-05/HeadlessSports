import { HandIndex } from '../../tracking/types';

const STRIDE = 3;

/**
 * Mean over index, middle, ring, pinky of |tip - wrist| / |middleMCP - wrist|, aspect-corrected
 * 2D. Thumb ignored. Returns NaN when the palm is degenerate (no usable observation).
 */
export function handCurl(landmarks: Float32Array, aspect: number): number {
  const w = HandIndex.WRIST * STRIDE;
  const wx = landmarks[w] * aspect;
  const wy = landmarks[w + 1];
  const m = HandIndex.MIDDLE_MCP * STRIDE;
  const palm = Math.hypot(landmarks[m] * aspect - wx, landmarks[m + 1] - wy);
  if (!(palm > 1e-6)) return NaN;
  let sum = 0;
  let t = HandIndex.INDEX_TIP * STRIDE;
  sum += Math.hypot(landmarks[t] * aspect - wx, landmarks[t + 1] - wy);
  t = HandIndex.MIDDLE_TIP * STRIDE;
  sum += Math.hypot(landmarks[t] * aspect - wx, landmarks[t + 1] - wy);
  t = HandIndex.RING_TIP * STRIDE;
  sum += Math.hypot(landmarks[t] * aspect - wx, landmarks[t + 1] - wy);
  t = HandIndex.PINKY_TIP * STRIDE;
  sum += Math.hypot(landmarks[t] * aspect - wx, landmarks[t + 1] - wy);
  return sum / 4 / palm;
}

/** Palm centre = mean of wrist and the four finger MCPs. Writes out[0], out[1]. */
export function palmCentre(landmarks: Float32Array, out: Float32Array): void {
  const a = HandIndex.WRIST * STRIDE;
  const b = HandIndex.INDEX_MCP * STRIDE;
  const c = HandIndex.MIDDLE_MCP * STRIDE;
  const d = HandIndex.RING_MCP * STRIDE;
  const e = HandIndex.PINKY_MCP * STRIDE;
  out[0] = (landmarks[a] + landmarks[b] + landmarks[c] + landmarks[d] + landmarks[e]) / 5;
  out[1] =
    (landmarks[a + 1] + landmarks[b + 1] + landmarks[c + 1] + landmarks[d + 1] + landmarks[e + 1]) /
    5;
}

/** Aspect-corrected wrist to middle-MCP length. */
export function palmSize(landmarks: Float32Array, aspect: number): number {
  const w = HandIndex.WRIST * STRIDE;
  const m = HandIndex.MIDDLE_MCP * STRIDE;
  return Math.hypot((landmarks[m] - landmarks[w]) * aspect, landmarks[m + 1] - landmarks[w + 1]);
}

export interface FistConfig {
  closeBelow: number;
  openAbove: number;
  holdFrames: number;
}

/**
 * Hysteresis + N-frame hold. Keeps the last state when fed no observation. Never guesses.
 * A change is reported when the debounced `closed` value changes: the first established state
 * reports 'closed' if closed, but nothing if open (open is the default value).
 */
export class FistDebouncer {
  private readonly config: FistConfig;
  private isClosed = false;
  private isKnown = false;
  /** 0 none, 1 pending closed, 2 pending open. */
  private pending = 0;
  private pendingCount = 0;

  constructor(config: FistConfig) {
    this.config = config;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get known(): boolean {
    return this.isKnown;
  }

  update(curl: number): 'closed' | 'opened' | null {
    if (!Number.isFinite(curl)) return null;
    let obs = 0;
    if (curl < this.config.closeBelow) obs = 1;
    else if (curl > this.config.openAbove) obs = 2;
    if (obs === 0 || (this.isKnown && obs === (this.isClosed ? 1 : 2))) {
      this.pending = 0;
      this.pendingCount = 0;
      return null;
    }
    if (obs === this.pending) this.pendingCount++;
    else {
      this.pending = obs;
      this.pendingCount = 1;
    }
    if (this.pendingCount < this.config.holdFrames) return null;
    const wasClosed = this.isClosed;
    this.isClosed = obs === 1;
    this.isKnown = true;
    this.pending = 0;
    this.pendingCount = 0;
    if (this.isClosed === wasClosed) return null;
    return this.isClosed ? 'closed' : 'opened';
  }

  /** The hand went missing: consecutive-frame counting restarts, state is kept. */
  interrupt(): void {
    this.pending = 0;
    this.pendingCount = 0;
  }

  reset(): void {
    this.isClosed = false;
    this.isKnown = false;
    this.interrupt();
  }
}
