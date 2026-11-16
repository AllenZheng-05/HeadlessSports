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
  /** Tracking lost for too long, or the bow arm lowered: arrow put back, never shot. */
  Cancel: 5,
} as const;
export type StepEventValue = (typeof StepEvent)[keyof typeof StepEvent];

export type Hint = 'raise' | 'nock' | 'pull' | 'aim' | 'lost' | 'further';

/** What the machine needs from the world each fixed step. */
export interface DrawSample {
  /** Pose and both wrists are usable this step (tracked, visible enough). `dist` is only meaningful then. */
  valid: boolean;
  bowUp: boolean;
  /** 2D wrist distance, sw. */
  dist: number;
  /** Lower of the two wrists' pose visibility this step, 0..1. */
  minVis: number;
  /** Draw hand model tracked right now (needed to see the fist open). */
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
  /** When the last release happened (open event time, or the speed peak of a kinematic release), ms. */
  releaseT = 0;

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
  private nowMs = 0;
  private nockAt = 0;
  private count = 0;

  private pendingClose = false;
  /** A fist that was already shut when the turn began counts as the nock (see `adoptHeldFist`). */
  private heldFist = false;
  private pendingOpen = false;
  private openT = 0;
  private prevClosed = false;
  private closedEdgeAt = -1e9;
  /** Draw hand model absent while the wrists are fine, ms. */
  private lostMs = 0;
  /** Wrists not usable, ms. 0 when tracked. */
  private poseLostMs = 0;
  /** No release is accepted until this has run out (counts down only while tracked), ms. */
  private reacquireLeft = 0;
  /** Draw frozen after a wrist glitch, ms. */
  private holdLeft = 0;
  private prevDist = -1;
  /** Draw hand model absent or only just back: its open/closed reading is not trusted, ms. */
  private handBackLeft = 0;
  private pendingOpenAt = -1;
  private pendingOpenMs = 0;
  private collapseSince = -1;
  /** Last time a wrist read below `collapseMinVisibility`, ms. */
  private lowVisAt = -1e9;
  /** The draw hand was last seen (trusted) closed: it can be the one that opened out of sight. */
  private closedSeen = false;
  private reopenMs = 0;
  private peakRate = 0;
  private peakAt = 0;
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

  /**
   * The draw hand may already be a fist that nobody saw close: after a pass-and-play handover the
   * fist that pressed Ready is still shut, and its close edge went by while the round was paused.
   * Until the hand is seen open (or a nock happens) a closed hand near the bow hand nocks, with no
   * fresh close edge needed. Call after `unlock`.
   */
  adoptHeldFist(): void {
    this.heldFist = true;
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
    this.clearGuard();
    this.autoMs = 0;
    this.closedEdgeAt = -1e9;
    this.pullNock = false;
    this.startDist = this.cfg.drawStart;
    this.resetPull();
  }

  private clearGuard(): void {
    this.poseLostMs = 0;
    this.reacquireLeft = 0;
    this.holdLeft = 0;
    this.handBackLeft = 0;
    this.prevDist = -1;
    this.pendingOpenAt = -1;
    this.pendingOpenMs = 0;
    this.collapseSince = -1;
    this.reopenMs = 0;
    this.peakRate = 0;
  }

  /** True when the wrists and the draw hand are both tracked (false while the draw is held or easing down). */
  get tracking(): boolean {
    return this.poseLostMs === 0 && this.lostMs === 0;
  }

  /** Forget the distance history: the next samples may be nowhere near the last ones. */
  private reseed(dist: number): void {
    this.dists.fill(dist);
    this.lastDist = dist;
  }

  /**
   * Tracking guard while drawing: counts lost time, spots the first frames after a return and
   * wrist jumps, and blocks releases for a moment around both. Returns true when the draw may
   * follow `s.dist` this step.
   */
  private guard(ms: number, s: DrawSample): boolean {
    const cfg = this.cfg;
    if (!s.valid) {
      this.poseLostMs += ms;
      this.prevDist = -1;
      this.reacquireLeft = cfg.reacquireMs;
      this.holdLeft = 0;
      this.pendingOpenAt = -1;
      this.collapseSince = -1;
      return false;
    }
    if (this.poseLostMs > 0) {
      // Back after a loss: the wrist may be anywhere, so the history starts over.
      this.poseLostMs = 0;
      this.reseed(s.dist);
    } else if (this.prevDist >= 0 && Math.abs(s.dist - this.prevDist) > cfg.jumpSw) {
      // A jump between two steps is a glitch, not a move: freeze, and re-seed once it settles.
      // The hand model is independent of the pose, so a fist that opens still releases.
      this.holdLeft = cfg.reacquireMs;
      this.collapseSince = -1;
    }
    this.prevDist = s.dist;
    if (this.reacquireLeft > 0) this.reacquireLeft -= ms;
    if (this.holdLeft > 0) {
      this.holdLeft -= ms;
      if (this.holdLeft <= 0) {
        this.holdLeft = 0;
        this.reseed(s.dist);
      }
      return false;
    }
    return true;
  }

  private resetPull(): void {
    this.pullBase = 1e9;
    this.pullNearAt = -1e9;
    this.nearLatched = false;
  }

  step(dt: number, now: number, s: DrawSample): StepEventValue {
    const cfg = this.cfg;
    if (s.known) this.fistEverKnown = true;
    this.nowMs = now;
    const drawing = this.phase === 'drawing';
    let follow = s.valid;
    if (drawing) follow = this.guard(dt * 1000, s);
    else this.clearGuard();
    if (follow) {
      if (drawing) {
        // 0% follows the hands coming closer (never below the floor), so a wide nock still draws.
        if (s.dist < this.startDist) this.startDist = Math.max(cfg.drawStart, s.dist);
        this.rawDraw = drawFraction(s.dist, cfg, this.startDist);
      } else {
        this.rawDraw = drawFraction(s.dist, cfg);
      }
      this.lastDist = s.dist;
    }
    if (drawing && this.poseLostMs > cfg.lostGraceMs) {
      // Past the grace: ease the bow down, quietly.
      this.draw = this.filter.update(0, dt, cfg.letDownS);
    } else {
      this.draw = this.filter.update(this.rawDraw, dt, cfg.drawSmoothS);
    }

    // Ring buffer.
    const i = this.head;
    this.ts[i] = now;
    this.draws[i] = this.draw;
    this.yaws[i] = s.yaw;
    this.pitches[i] = s.pitch;
    this.dists[i] = this.lastDist;
    this.head = (i + 1) % RING;
    if (this.count < RING) this.count++;

    // A lost wrist says nothing about the bow arm; only count a bow arm that is seen and low.
    if (s.valid) {
      if (s.bowUp) this.bowDownMs = 0;
      else this.bowDownMs += dt * 1000;
    }

    const closeEdge = this.pendingClose || (s.known && s.closed && !this.prevClosed);
    const openEdge = this.pendingOpen || (s.known && !s.closed && this.prevClosed);
    const openAt = this.pendingOpen ? this.openT : now;
    this.pendingClose = false;
    this.pendingOpen = false;
    if (openEdge || (s.known && !s.closed)) this.heldFist = false;
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

    if (
      near &&
      s.known &&
      s.closed &&
      s.present &&
      (this.heldFist || now - this.closedEdgeAt <= cfg.nockGraceMs)
    ) {
      this.heldFist = false;
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
    this.clearGuard();
    // Distances and draws from before the nock say nothing about a release.
    this.reseed(this.lastDist);
    this.nockAt = this.nowMs;
    this.bowDownMs = 0;
    this.autoMs = 0;
    this.closedEdgeAt = -1e9;
    this.closedSeen = this.prevClosed;
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

    // Never guess: lost wrists hold the draw, then let it down; neither ever shoots.
    if (this.poseLostMs > 0) {
      this.hint = 'lost';
      if (this.poseLostMs >= cfg.lostGraceMs + cfg.letDownMs) {
        this.toReady();
        return StepEvent.Cancel;
      }
      return StepEvent.None;
    }

    // The draw hand model is gone while the wrists are fine: the draw still follows the wrists,
    // but a fist that opens cannot be seen, so only the kinematic release works. Cancel eventually.
    let handOk = true;
    if (!this.autoNock) {
      if (!s.present) {
        handOk = false;
        this.lostMs += ms;
        this.hint = 'lost';
        this.pendingOpenAt = -1;
        this.reopenMs = 0;
        // Its first frames back are not trusted: a half-seen hand reads as open.
        this.handBackLeft = cfg.reacquireMs;
        if (this.lostMs >= cfg.lostHandCancelMs) {
          this.toReady();
          return StepEvent.Cancel;
        }
      } else {
        this.lostMs = 0;
        if (this.handBackLeft > 0) this.handBackLeft -= ms;
      }
    }

    if (this.bowDownMs >= cfg.bowDropMs) {
      this.toReady();
      return StepEvent.Cancel;
    }

    if (this.draw >= FULL_DRAW) this.holdFullS += dt;
    if (handOk) this.hint = this.draw < cfg.minDraw ? 'pull' : 'aim';

    const steady = this.reacquireLeft <= 0;
    const kinSteady = steady && this.holdLeft <= 0;

    // A fast collapse of the wrist distance (the draw hand flying forward) is a release in itself.
    if (s.minVis < cfg.collapseMinVisibility) this.lowVisAt = now;
    if (!this.autoNock && kinSteady && this.checkCollapse(now, s)) {
      return this.release(
        now,
        this.collapseSince - RATE_WINDOW_MS - cfg.releaseLookbackMs,
        this.peakAt,
      );
    }
    if (this.autoNock || !kinSteady) this.collapseSince = -1;

    if (!this.autoNock) {
      if (!handOk) return StepEvent.None;
      // The fist opened: a release only if the hand stays open and tracked for a moment.
      const handSteady = steady && this.handBackLeft <= 0;
      if (openEdge && handSteady) {
        this.pendingOpenAt = openAt;
        this.pendingOpenMs = 0;
      }
      // A hand last seen closed that comes back already open (its open edge fell in the gap or the
      // guard) never makes an edge again, so a steady, tracked, open reading releases it instead.
      if (handSteady && s.known) {
        if (s.closed) {
          this.closedSeen = true;
          this.reopenMs = 0;
        } else if (this.closedSeen && this.pendingOpenAt < 0) {
          this.reopenMs += ms;
          if (this.reopenMs >= cfg.reopenConfirmMs) {
            this.reopenMs = 0;
            return this.release(now, now - cfg.releaseLookbackMs, now);
          }
        }
      } else {
        this.reopenMs = 0;
      }
      if (this.pendingOpenAt >= 0) {
        if (!handSteady || (s.known && s.closed)) {
          this.pendingOpenAt = -1;
        } else {
          this.pendingOpenMs += ms;
          if (this.pendingOpenMs >= cfg.releaseConfirmMs) {
            const at = this.pendingOpenAt;
            this.pendingOpenAt = -1;
            return this.release(now, at - cfg.releaseLookbackMs, at);
          }
        }
      }
      // Nocked without a fist: a quick return toward the bow hand from full draw also releases,
      // until the fist is seen closing.
      if (
        kinSteady &&
        this.pullNock &&
        this.closedEdgeAt < -1e8 &&
        this.rawDraw >= cfg.fallbackFullDraw &&
        this.distRate(now) < -cfg.fallbackReleaseSpeed
      ) {
        return this.release(now, now - cfg.releaseLookbackMs, now);
      }
      return StepEvent.None;
    }

    // Fallback release: a quick pull toward the bow hand from full draw, or a steady hold.
    if (
      kinSteady &&
      this.rawDraw >= cfg.fallbackFullDraw &&
      this.distRate(now) < -cfg.fallbackReleaseSpeed
    ) {
      return this.release(now, now - cfg.releaseLookbackMs, now);
    }
    if (Math.abs(this.draw - this.anchorDraw) <= cfg.fallbackHoldBand) {
      if (this.draw >= cfg.minDraw) this.anchorMs += ms;
      else this.anchorMs = 0;
      if (this.anchorMs >= cfg.fallbackHoldMs && kinSteady) {
        return this.release(now, now - cfg.releaseLookbackMs, now);
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

  /**
   * True once the wrists have been closing in faster than `collapseSpeed` for `collapseConfirmMs`
   * from at least `collapseMinDraw`. Leaves the onset in `collapseSince` and the speed peak
   * (the moment, not the detection) in `peakAt`.
   */
  private checkCollapse(now: number, s: DrawSample): boolean {
    const cfg = this.cfg;
    const rate = -this.distRate(now);
    if (
      rate < cfg.collapseSpeed ||
      this.recentDraw() < cfg.collapseMinDraw ||
      // A wrist that was poorly visible anywhere in the rate window may just be sliding.
      now - this.lowVisAt < RATE_WINDOW_MS ||
      // A closed fist moving is not a release.
      (s.present && s.known && s.closed)
    ) {
      this.collapseSince = -1;
      return false;
    }
    if (rate > cfg.collapseMaxSpeed) {
      // Faster than a hand can move: a tracking glitch. Freeze and re-seed like a jump.
      this.holdLeft = cfg.reacquireMs;
      this.collapseSince = -1;
      return false;
    }
    if (this.collapseSince < 0) {
      this.collapseSince = now;
      this.peakRate = 0;
    }
    if (rate > this.peakRate) {
      this.peakRate = rate;
      // The rate is measured over the last RATE_WINDOW_MS, so it describes the middle of it.
      this.peakAt = now - RATE_WINDOW_MS / 2;
    }
    return now - this.collapseSince >= cfg.collapseConfirmMs;
  }

  /** Largest smoothed draw over the last `collapseRecentMs` (a release collapses the draw as it is detected). */
  private recentDraw(): number {
    let best = 0;
    let j = (this.head - 1 + RING) % RING;
    const newest = this.ts[j]!;
    for (let k = 0; k < this.count; k++) {
      if (newest - this.ts[j]! > this.cfg.collapseRecentMs || this.ts[j]! < this.nockAt) break;
      if (this.draws[j]! > best) best = this.draws[j]!;
      j = (j - 1 + RING) % RING;
    }
    return best;
  }

  /** `at` is the moment of release for the caller (the open event, or the speed peak). */
  private release(now: number, lookT: number, at: number): StepEventValue {
    this.releaseT = at;
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
