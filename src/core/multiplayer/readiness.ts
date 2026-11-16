import type { InputState } from '../../input/types';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';

/**
 * When is the next player ready? The handover card keeps showing until someone makes a fist on its
 * Ready button, clicks it or presses Enter, or, with a camera, until the frame says the next person
 * is in place:
 *
 *   1. the card has been up at least `minShowMs` (the previous player needs time to leave),
 *   2. the frame has been EMPTY (no tracked body) for at least `emptyMs` at some point since the
 *      card appeared, and
 *   3. someone has then come into frame and stayed roughly still (inside `stillRadiusSw`) for
 *      `stillMs`.
 *
 * Rule 2 is what stops the previous player, still standing there, from being counted as the next:
 * moving about or changing size never counts, only the frame emptying. When it never empties the
 * card waits for Ready, and after `hintAfterMs` it says so (see `hintDue`). The very first
 * step-in of a game has nobody to replace, so it skips rule 2. Synthetic and replay sources have
 * no real people to swap, so for them the card is ready after `minShowMs` alone.
 */
export const handoverConfig = {
  minShowMs: 2000,
  stillMs: 1000,
  stillRadiusSw: 0.3,
  emptyMs: 700,
  /** How long on the card before "Swap places, or make a fist on Ready" appears. */
  hintAfterMs: 6000,
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
  private readonly requireEmpty: boolean;
  private readonly timeOnly: boolean;
  private startMs = -1;
  private absentSince = -1;
  /** The frame has been empty for `emptyMs` since the card appeared (or nobody has to leave). */
  private emptied: boolean;
  private stillSince = -1;
  private anchorX = 0;
  private anchorY = 0;

  /**
   * `requireChange`: someone must have swapped in, i.e. the frame must empty first (false for the
   * very first player, who has nobody to replace). `timeOnly`: ready once the minimum time has
   * passed (synthetic and replay).
   */
  constructor(options: { requireChange: boolean; timeOnly?: boolean; config?: HandoverConfig }) {
    this.cfg = options.config ?? handoverConfig;
    this.requireEmpty = options.requireChange;
    this.timeOnly = options.timeOnly === true;
    this.emptied = !this.requireEmpty;
  }

  /** Forget everything: the card has just appeared at `nowMs`. */
  reset(nowMs: number): void {
    this.startMs = nowMs;
    this.absentSince = -1;
    this.emptied = !this.requireEmpty;
    this.stillSince = -1;
  }

  /** True once the next player is ready. Call every frame with a fresh sample. */
  update(nowMs: number, s: PresenceSample): boolean {
    if (this.startMs < 0) this.reset(nowMs);
    const cfg = this.cfg;
    if (nowMs - this.startMs < cfg.minShowMs) {
      // Still learn whether the frame emptied while the card was fresh.
      this.observe(nowMs, s);
      return false;
    }
    if (this.timeOnly) return true;
    this.observe(nowMs, s);
    return (
      s.present && this.emptied && this.stillSince >= 0 && nowMs - this.stillSince >= cfg.stillMs
    );
  }

  /**
   * True when the card has waited long enough that the player should be told how to move on: the
   * frame never emptied, so the camera cannot tell a swap from the same person standing there.
   */
  hintDue(nowMs: number): boolean {
    return (
      !this.timeOnly &&
      !this.emptied &&
      this.startMs >= 0 &&
      nowMs - this.startMs >= this.cfg.hintAfterMs
    );
  }

  private observe(nowMs: number, s: PresenceSample): void {
    const cfg = this.cfg;
    if (!s.present) {
      if (this.absentSince < 0) this.absentSince = nowMs;
      if (nowMs - this.absentSince >= cfg.emptyMs) this.emptied = true;
      this.stillSince = -1;
      return;
    }
    this.absentSince = -1;
    const sw = s.sw > 0 ? s.sw : cfg.handsScaleSw;
    const ax = ((s.x - this.anchorX) * s.aspect) / sw;
    const ay = (s.y - this.anchorY) / sw;
    if (this.stillSince < 0 || Math.hypot(ax, ay) > cfg.stillRadiusSw) {
      this.stillSince = nowMs;
      this.anchorX = s.x;
      this.anchorY = s.y;
    }
  }
}
