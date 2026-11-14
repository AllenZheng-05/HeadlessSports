import { DampedValue, drawFraction } from './aim';
import type { ArcheryConfig } from './config';

export type DrawPhase = 'ready' | 'drawing' | 'locked';

export const StepEvent = {
  None: 0,
  /** Fist closed near the raised bow hand: arrow nocked. */
  Nock: 1,
  /** The fallback nocked it because the fist can never be seen. */
  AutoNock: 2,
  /** Arrow released at or above the minimum draw; see `shot`. */
  Shot: 3,
  /** Hand opened below the minimum draw: arrow put back. */
  Unnock: 4,
  /** Hand lost for too long or bow arm lowered: arrow put back. */
  Cancel: 5,
} as const;
export type StepEventValue = (typeof StepEvent)[keyof typeof StepEvent];

export type Hint = 'raise' | 'nock' | 'pull' | 'aim' | 'lost' | 'further';

/** What the machine needs from the world each fixed step. */
export interface DrawSample {
  /** Pose and both wrists are usable this step. */
  valid: boolean;
  bowUp: boolean;
  /** 2D wrist distance, sw. */
  dist: number;
  /** Draw hand tracked right now. */
  present: boolean;
  known: boolean;
  closed: boolean;
  /** Aim after smoothing and sway: world yaw and pitch, radians. */
  yaw: number;
  pitch: number;
}

export interface Shot {
  draw: number;
  yaw: number;
  pitch: number;
}

const RING = 128;
/** Distance history used for the fallback's "moving toward the bow hand" test, ms. */
const RATE_WINDOW_MS = 100;
const FULL_DRAW = 0.9;

/**
 * The nock / draw / release state machine. Pure: it sees one `DrawSample` per fixed step plus
 * fist events, and reports what happened. Times are in the caller's simulation clock, ms.
 */
export class DrawMachine {
  phase: DrawPhase = 'ready';
  hint: Hint = 'raise';
  /** Smoothed draw, 0..1. */
  draw = 0;
  /** Seconds spent at full draw in this nock (drives the sway). */
  holdFullS = 0;
  autoNock = false;
  fistEverKnown = false;
  readonly shot: Shot = { draw: 0, yaw: 0, pitch: 0 };

  private readonly cfg: ArcheryConfig;
  private readonly filter = new DampedValue();
  private rawDraw = 0;
  private lastDist = 0;

  // Ring of recent samples for the release look-back.
  private readonly ts = new Float64Array(RING);
  private readonly draws = new Float64Array(RING);
  private readonly yaws = new Float64Array(RING);
  private readonly pitches = new Float64Array(RING);
  private readonly dists = new Float64Array(RING);
  private head = 0;
  private count = 0;

  private pendingClose = false;
  private pendingOpen = false;
  private openT = 0;
  private prevClosed = false;
  private closedEdgeAt = -1e9;
  private lostMs = 0;
  private bowDownMs = 0;
  private furtherUntil = -1e9;
  private autoMs = 0;
  private anchorDraw = 0;
  private anchorMs = 0;
  /** Distance that is 0% draw for this nock: the closest the hands have been since nocking. */
  private startDist: number;
  /** Nocked by pulling apart with no fist seen yet; the fast return can release it. */
  private pullNock = false;
  private nearLatched = false;
  private pullBase = 1e9;
  private pullNearAt = -1e9;
  private readyMs = 0;

  constructor(cfg: ArcheryConfig) {
    this.cfg = cfg;
    this.startDist = cfg.drawStart;
  }

  /** The draw hand's fist closed (event time `t`, caller's clock). */
  noteClosed(): void {
    this.pendingClose = true;
  }

  /** The draw hand's fist opened at `t` (caller's clock; the moment itself, not the detection). */
  noteOpened(t: number): void {
    this.pendingOpen = true;
    this.openT = t;
  }

  /** Stop reacting (arrow in flight). */
  lock(): void {
    this.phase = 'locked';
  }

  /** Back to ready for the next arrow. */
  unlock(): void {
    this.toReady();
    this.hint = 'raise';
    this.pendingClose = false;
    this.pendingOpen = false;
  }

  private toReady(): void {
    this.phase = 'ready';
    this.autoNock = false;
    this.holdFullS = 0;
    this.lostMs = 0;
    this.autoMs = 0;
    this.closedEdgeAt = -1e9;
    this.pullNock = false;
    this.startDist = this.cfg.drawStart;
    this.resetPull();
  }

  private resetPull(): void {
    this.pullBase = 1e9;
    this.pullNearAt = -1e9;
    this.nearLatched = false;
  }

  step(dt: number, now: number, s: DrawSample): StepEventValue {
    const cfg = this.cfg;
    if (s.known) this.fistEverKnown = true;
    if (s.valid) {
      if (this.phase === 'drawing') {
        // 0% follows the hands coming closer (never below the floor), so a wide nock still draws.
        if (s.dist < this.startDist) this.startDist = Math.max(cfg.drawStart, s.dist);
        this.rawDraw = drawFraction(s.dist, cfg, this.startDist);
      } else {
        this.rawDraw = drawFraction(s.dist, cfg);
      }
      this.lastDist = s.dist;
    }
    this.draw = this.filter.update(this.rawDraw, dt, cfg.drawSmoothS);

    // Ring buffer.
    const i = this.head;
    this.ts[i] = now;
    this.draws[i] = this.draw;
    this.yaws[i] = s.yaw;
    this.pitches[i] = s.pitch;
    this.dists[i] = this.lastDist;
    this.head = (i + 1) % RING;
    if (this.count < RING) this.count++;

    if (s.bowUp && s.valid) this.bowDownMs = 0;
    else this.bowDownMs += dt * 1000;

    const closeEdge = this.pendingClose || (s.known && s.closed && !this.prevClosed);
    const openEdge = this.pendingOpen || (s.known && !s.closed && this.prevClosed);
    const openAt = this.pendingOpen ? this.openT : now;
    this.pendingClose = false;
    this.pendingOpen = false;
    if (s.known) this.prevClosed = s.closed;
    if (closeEdge) this.closedEdgeAt = now;

    if (this.phase === 'locked') return StepEvent.None;
    if (this.phase === 'ready') return this.stepReady(now, s, dt * 1000);
    return this.stepDrawing(dt, now, s, openEdge, openAt);
  }

  private stepReady(now: number, s: DrawSample, ms: number): StepEventValue {
    const cfg = this.cfg;
    const ready = s.valid && s.bowUp;
    // Hysteresis: enter at nockDistance, stay "together" until nockKeepDistance.
    if (!ready) this.nearLatched = false;
    else if (s.dist < cfg.nockDistance) this.nearLatched = true;
    else if (s.dist >= cfg.nockKeepDistance) this.nearLatched = false;
    const near = ready && this.nearLatched;
    this.readyMs = ready ? this.readyMs + ms : 0;
    if (now >= this.furtherUntil) this.hint = ready ? 'nock' : 'raise';
    else this.hint = 'further';

    if (near && s.known && s.closed && s.present && now - this.closedEdgeAt <= cfg.nockGraceMs) {
      this.beginDraw(false, s.dist);
      this.pullNock = false;
      return StepEvent.Nock;
    }

    // No-fist nock: hands came together, then the draw hand pulls away. Works with an open hand.
    if (ready && s.present && this.readyMs >= cfg.nockPullBowStableMs) {
      if (s.dist < cfg.nockPullNear) {
        if (s.dist < this.pullBase || now - this.pullNearAt > cfg.nockPullWindowMs) {
          this.pullBase = s.dist;
        }
        this.pullNearAt = now;
      } else if (now - this.pullNearAt > cfg.nockPullWindowMs) {
        this.pullBase = 1e9;
      }
      if (
        this.pullBase < 1e8 &&
        s.dist - this.pullBase >= cfg.nockPullDelta &&
        this.distRate(now) >= cfg.nockPullSpeed
      ) {
        this.beginDraw(false, this.pullBase);
        this.pullNock = !(s.known && s.closed);
        return StepEvent.Nock;
      }
    } else {
      this.pullBase = 1e9;
    }

    // Fallback: a fist the tracker never sees. Hands held together long enough nock.
    if (!this.fistEverKnown && near) {
      this.autoMs += ms;
      if (this.autoMs >= cfg.fistFallbackMs) {
        this.beginDraw(true, s.dist);
        return StepEvent.AutoNock;
      }
    } else {
      this.autoMs = 0;
    }
    return StepEvent.None;
  }

  private beginDraw(auto: boolean, nockDist: number): void {
    this.phase = 'drawing';
    this.pullNock = false;
    this.resetPull();
    this.startDist = Math.max(this.cfg.drawStart, nockDist);
    this.rawDraw = drawFraction(this.lastDist, this.cfg, this.startDist);
    this.autoNock = auto;
    this.holdFullS = 0;
    this.lostMs = 0;
    this.autoMs = 0;
    this.closedEdgeAt = -1e9;
    this.anchorDraw = this.draw;
    this.anchorMs = 0;
    this.hint = 'pull';
  }

  private stepDrawing(
    dt: number,
    now: number,
    s: DrawSample,
    openEdge: boolean,
    openAt: number,
  ): StepEventValue {
    const cfg = this.cfg;
    const ms = dt * 1000;

    // Never guess: a lost hand holds the state, then cancels.
    if (!this.autoNock) {
      if (!s.present) {
        this.lostMs += ms;
        this.hint = 'lost';
        if (this.lostMs >= cfg.lostHandCancelMs) {
          this.toReady();
          return StepEvent.Cancel;
        }
        return StepEvent.None;
      }
      this.lostMs = 0;
    }

    if (this.bowDownMs >= cfg.bowDropMs) {
      this.toReady();
      return StepEvent.Cancel;
    }

    if (this.draw >= FULL_DRAW) this.holdFullS += dt;
    this.hint = this.draw < cfg.minDraw ? 'pull' : 'aim';

    if (!this.autoNock) {
      if (openEdge) return this.release(now, openAt - cfg.releaseLookbackMs);
      // Nocked without a fist: a quick return toward the bow hand from full draw also releases,
      // until the fist is seen closing.
      if (
        this.pullNock &&
        this.closedEdgeAt < -1e8 &&
        this.rawDraw >= cfg.fallbackFullDraw &&
        this.distRate(now) < -cfg.fallbackReleaseSpeed
      ) {
        return this.release(now, now - cfg.releaseLookbackMs);
      }
      return StepEvent.None;
    }

    // Fallback release: a quick pull toward the bow hand from full draw, or a steady hold.
    if (this.rawDraw >= cfg.fallbackFullDraw && this.distRate(now) < -cfg.fallbackReleaseSpeed) {
      return this.release(now, now - cfg.releaseLookbackMs);
    }
    if (Math.abs(this.draw - this.anchorDraw) <= cfg.fallbackHoldBand) {
      if (this.draw >= cfg.minDraw) this.anchorMs += ms;
      else this.anchorMs = 0;
      if (this.anchorMs >= cfg.fallbackHoldMs) {
        return this.release(now, now - cfg.releaseLookbackMs);
      }
    } else {
      this.anchorDraw = this.draw;
      this.anchorMs = 0;
    }
    return StepEvent.None;
  }

  /** Wrist distance rate over the last ~100 ms, sw/s. Negative when the hands close in. */
  private distRate(now: number): number {
    let j = (this.head - 1 + RING) % RING;
    const newest = this.dists[j]!;
    for (let k = 0; k < this.count; k++) {
      if (now - this.ts[j]! >= RATE_WINDOW_MS) {
        return ((newest - this.dists[j]!) / (now - this.ts[j]!)) * 1000;
      }
      j = (j - 1 + RING) % RING;
    }
    return 0;
  }

  private release(now: number, lookT: number): StepEventValue {
    this.sampleAt(lookT);
    const ok = this.shot.draw >= this.cfg.minDraw;
    if (ok) {
      this.phase = 'locked';
      this.holdFullS = 0;
      return StepEvent.Shot;
    }
    this.toReady();
    this.furtherUntil = now + this.cfg.furtherHintMs;
    this.hint = 'further';
    return StepEvent.Unnock;
  }

  /** Fill `shot` from the newest sample at or before `t` (the oldest when `t` is older than all). */
  private sampleAt(t: number): void {
    let j = (this.head - 1 + RING) % RING;
    let pick = j;
    for (let k = 0; k < this.count; k++) {
      pick = j;
      if (this.ts[j]! <= t) break;
      j = (j - 1 + RING) % RING;
    }
    this.shot.draw = this.draws[pick]!;
    this.shot.yaw = this.yaws[pick]!;
    this.shot.pitch = this.pitches[pick]!;
  }
}
