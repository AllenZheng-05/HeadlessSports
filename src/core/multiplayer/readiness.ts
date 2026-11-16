import type { InputState } from '../../input/types';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';

/**
 * When is the next player ready? The handover card keeps showing until someone makes a fist on its
 * Ready button, clicks it or presses Enter, or, with a camera, until the frame says the next person
 * is in place:
 *
 *   1. the card has been up at least `minShowMs` (the previous player needs time to leave), and
 *   2. the picture has changed since the card appeared: the frame was empty for `emptyMs`, or the
 *      tracked body moved more than `changeMoveSw` shoulder widths or changed size by more than
 *      `changeScale` (a different person, or the same one stepping out and back), and
 *   3. someone is in frame and roughly still (inside `stillRadiusSw`) for `stillMs`.
 *
 * Rule 2 is what stops the previous player, still standing there, from being counted as the next.
 * Synthetic and replay sources have no real people to swap, so for them the card is ready after
 * `minShowMs` alone.
 */
export const handoverConfig = {
  minShowMs: 2000,
  stillMs: 1000,
  stillRadiusSw: 0.3,
  emptyMs: 400,
  changeMoveSw: 0.6,
  changeScale: 0.25,
  /** Hands-only stances have no shoulders: this stands in for a shoulder width. */
  handsScaleSw: 0.25,
};

export type HandoverConfig = typeof handoverConfig;

/** Where the tracked person is: shoulder midpoint (normalised image coords) and shoulder width. */
export interface PresenceSample {
  present: boolean;
  x: number;
  y: number;
  /** Shoulder width in aspect-corrected units; 0 when unknown. */
  sw: number;
  aspect: number;
}

export function createPresenceSample(): PresenceSample {
  return { present: false, x: 0, y: 0, sw: 0, aspect: 16 / 9 };
}

/** Fill `out` from the input state without allocating. */
export function samplePresence(state: InputState, out: PresenceSample): PresenceSample {
  out.aspect = state.aspect;
  if (state.hasPose && state.tracking && state.shoulderWidth > 0 && state.problem !== 'lost') {
    const p = state.pose;
    const l = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const r = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    out.present = true;
    out.x = ((p[l] as number) + (p[r] as number)) / 2;
    out.y = ((p[l + 1] as number) + (p[r + 1] as number)) / 2;
    out.sw = state.shoulderWidth;
    return out;
  }
  const hand = state.hands.left.present
    ? state.hands.left
    : state.hands.right.present
      ? state.hands.right
      : null;
  if (!state.hasPose && state.tracking && hand !== null) {
    out.present = true;
    out.x = hand.x;
    out.y = hand.y;
    out.sw = 0;
    return out;
  }
  out.present = false;
  return out;
}

export class HandoverReadiness {
  private readonly cfg: HandoverConfig;
  private readonly requireChange: boolean;
  private readonly timeOnly: boolean;
  private startMs = -1;
  private absentSince = -1;
  private changed = false;
  private hasBase = false;
  private baseX = 0;
  private baseY = 0;
  private baseSw = 0;
  private stillSince = -1;
  private anchorX = 0;
  private anchorY = 0;

  /**
   * `requireChange`: someone must have swapped in (false for the very first player, who has nobody
   * to replace). `timeOnly`: ready once the minimum time has passed (synthetic and replay).
   */
  constructor(options: { requireChange: boolean; timeOnly?: boolean; config?: HandoverConfig }) {
    this.cfg = options.config ?? handoverConfig;
    this.requireChange = options.requireChange;
    this.timeOnly = options.timeOnly === true;
  }

  /** Forget everything: the card has just appeared at `nowMs`. */
  reset(nowMs: number): void {
    this.startMs = nowMs;
    this.absentSince = -1;
    this.changed = !this.requireChange;
    this.hasBase = false;
    this.stillSince = -1;
  }

  /** True once the next player is ready. Call every frame with a fresh sample. */
  update(nowMs: number, s: PresenceSample): boolean {
    if (this.startMs < 0) this.reset(nowMs);
    const cfg = this.cfg;
    if (nowMs - this.startMs < cfg.minShowMs) {
      // Still learn what the picture looked like when the card appeared.
      this.observe(nowMs, s);
      return false;
    }
    if (this.timeOnly) return true;
    this.observe(nowMs, s);
    return (
      s.present && this.changed && this.stillSince >= 0 && nowMs - this.stillSince >= cfg.stillMs
    );
  }

  private observe(nowMs: number, s: PresenceSample): void {
    const cfg = this.cfg;
    if (!s.present) {
      if (this.absentSince < 0) this.absentSince = nowMs;
      if (nowMs - this.absentSince >= cfg.emptyMs) {
        this.changed = true;
      }
      this.stillSince = -1;
      return;
    }
    this.absentSince = -1;
    const sw = s.sw > 0 ? s.sw : cfg.handsScaleSw;
    if (!this.hasBase) {
      this.hasBase = true;
      this.baseX = s.x;
      this.baseY = s.y;
      this.baseSw = s.sw;
    } else if (!this.changed) {
      const dx = ((s.x - this.baseX) * s.aspect) / sw;
      const dy = (s.y - this.baseY) / sw;
      const moved = Math.hypot(dx, dy) > cfg.changeMoveSw;
      const scaled =
        s.sw > 0 && this.baseSw > 0 && Math.abs(s.sw / this.baseSw - 1) > cfg.changeScale;
      if (moved || scaled) this.changed = true;
    }
    const ax = ((s.x - this.anchorX) * s.aspect) / sw;
    const ay = (s.y - this.anchorY) / sw;
    if (this.stillSince < 0 || Math.hypot(ax, ay) > cfg.stillRadiusSw) {
      this.stillSince = nowMs;
      this.anchorX = s.x;
      this.anchorY = s.y;
    }
  }
}
