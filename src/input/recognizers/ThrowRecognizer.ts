import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { InputState, RejectReason, Side } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { BodyMotion, RelativeWrist, noteRejected, signedCurvature, velocityLagMs } from './util';

const RING = 32;
/** Wrist-path samples closer than this (sw) to the rest anchor do not count as a back-swing. */
const REVERSAL_SLACK = 0.04;
/** Hold this many arm-ready periods at very low speed to re-anchor the rest position. */
const REANCHOR_SPEED_FRACTION = 0.4;
const REANCHOR_MS_FACTOR = 2;
const MIN_REVERSAL_SPEED = 0.5;
/** The acceleration of a throw is counted from when the wrist was last slower than this fraction of its peak. */
const RISE_FRACTION = 0.25;
/** The wrist height reported as `topY` looks this far back from the peak, ms. */
const TOP_LOOKBACK_MS = 400;

const Phase = { Idle: 0, Ready: 1, Accelerating: 2, Cooldown: 3 } as const;
const PHASE_NAMES = ['idle', 'ready', 'accelerating', 'cooldown'] as const;

/**
 * One hand's throw (bowling underarm swing, overarm javelin): idle -> ready -> accelerating ->
 * release found at the wrist-speed peak -> cooldown.
 *
 * Ready: the wrist speed stayed below `armSpeed` for `armMs` (the fist state is not consulted).
 * Accelerating: speed exceeded `startSpeed`. The release is confirmed on the first frame where
 * speed has dropped below `peak * dropRatio`; the event is stamped at the peak sample, moved
 * back by the velocity estimator's lag. Releases that are too weak or too slow or fast to be a
 * throw return to idle (and leave a note in `state.rejected`).
 *
 * The wrist is measured against the shoulder midpoint and scaled by the stable body scale, so a
 * player turned side-on, or jogging, is judged like one facing the camera. A wrist that drops out
 * of sight at the speed peak (motion blur) is coasted; if it stays lost the throw is released at
 * the peak it had reached, since the blur itself says it was fast.
 *
 * `curvature` is the signed Menger curvature of the filtered wrist path (sw, relative to the
 * same-side shoulder, y up) at three points: the start, middle and end of the `curvatureWindowMs`
 * before the peak. Positive when the path turns clockwise on screen, i.e. curves toward screen
 * right as it advances (moving up and bending toward +x is positive).
 */
export class ThrowRecognizer implements Recognizer {
  readonly name: string;
  private readonly hand: Side;
  private readonly config: RecognizerConfig;

  private phase: number = Phase.Idle;
  private slowSince = -1;
  private veryStillSince = -1;
  private cooldownUntil = 0;

  // Rest anchor and wind-up tracking.
  private anchorX = 0;
  private anchorY = 0;
  private maxDist = 0;
  private maxDistT = 0;
  private windupEmitted = false;

  // Peak of the current acceleration.
  private peakSpeed = 0;
  private peakT = 0;
  private peakVx = 0;
  private peakVy = 0;

  // Recent wrist path (sw, relative to shoulder, y up).
  private readonly ringT = new Float64Array(RING);
  private readonly ringX = new Float64Array(RING);
  private readonly ringY = new Float64Array(RING);
  /** Wrist x relative to the shoulder midpoint, sw. */
  private readonly ringLat = new Float64Array(RING);
  /** Wrist speed at each stored sample, sw/s. */
  private readonly ringS = new Float64Array(RING);
  private ringCount = 0;
  private ringHead = 0;
  private readonly sample = new Float64Array(3);
  private readonly motion: RelativeWrist;
  private readonly body = new BodyMotion();
  /** After a failed acceleration the speed must fall below startSpeed before another can begin. */
  private needBelowStart = false;
  /** Peak speed of the last release, and whether the acceleration under way began inside its cooldown. */
  private lastReleasePeak = 0;
  private supersede = false;
  private bodyFastT = Number.NEGATIVE_INFINITY;

  constructor(hand: Side, config: RecognizerConfig = recognizerConfig) {
    this.hand = hand;
    this.config = config;
    this.name = `throw-${hand}`;
    this.motion = new RelativeWrist(hand, config.throw);
  }

  /** Current phase name, for debug displays. */
  get phaseName(): string {
    return PHASE_NAMES[this.phase];
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.throw;
    const arm = state.arms[this.hand];
    const t = state.t;
    this.motion.push(state);
    this.body.push(state);
    this.pushPath(state);
    const speed = this.motion.speed;

    if (this.phase === Phase.Cooldown && t >= this.cooldownUntil) this.toIdle();
    if (this.phase === Phase.Accelerating && this.motion.lost) {
      this.endLost(state, emit);
      return;
    }
    if (this.body.speed > c.maxBodySpeed) this.bodyFastT = t;
    // A throw already under way is not cancelled by the body moving (the thrower's own lunge).
    if (t - this.bodyFastT < c.bodySettleMs && this.phase !== Phase.Accelerating) {
      // The body is (or just was) moving fast: the wrist-relative-to-shoulder signal is unreliable.
      if (this.phase === Phase.Ready) this.toIdle();
      if (this.phase === Phase.Idle) this.slowSince = -1;
      return;
    }
    if (this.phase === Phase.Idle) {
      if (speed < c.armSpeed) {
        if (this.slowSince < 0) this.slowSince = t;
        if (t - this.slowSince >= c.armMs) this.enterReady(arm.wristX, arm.wristY, t);
      } else {
        this.slowSince = -1;
      }
    } else if (this.phase === Phase.Cooldown) {
      this.updateCooldown(state, speed);
    } else if (this.phase === Phase.Ready) {
      this.updateReady(state, emit, speed);
    } else if (this.phase === Phase.Accelerating) {
      this.updateAccelerating(state, emit, speed);
    }
  }

  /**
   * The cooldown stops the follow-through and the recovery from being a second throw, but it must
   * not hide the real throw behind a weak movement that came just before it (cocking the arm
   * back). So a much stronger acceleration (1.6 times the last release's peak) is still accepted.
   */
  private updateCooldown(state: InputState, speed: number): void {
    const c = this.config.throw;
    if (speed < c.startSpeed) this.needBelowStart = false;
    // Only a weak release can be superseded; a strong throw's cooldown is never cut short.
    if (
      speed > c.startSpeed &&
      !this.needBelowStart &&
      this.lastReleasePeak < c.supersedeMaxPeak * c.minPeak
    ) {
      this.phase = Phase.Accelerating;
      this.supersede = true;
      this.peakSpeed = 0;
      this.recordPeak(state, speed);
    }
  }

  private enterReady(x: number, y: number, t: number): void {
    this.phase = Phase.Ready;
    this.veryStillSince = t;
    this.anchor(x, y, t);
  }

  private anchor(x: number, y: number, t: number): void {
    this.anchorX = x;
    this.anchorY = y;
    this.maxDist = 0;
    this.maxDistT = t;
    this.windupEmitted = false;
  }

  private updateReady(state: InputState, emit: Emit, speed: number): void {
    const c = this.config.throw;
    const arm = state.arms[this.hand];
    const t = state.t;
    const m = this.motion;

    if (speed < c.startSpeed) this.needBelowStart = false;
    if (speed > c.startSpeed && !this.needBelowStart) {
      this.phase = Phase.Accelerating;
      this.peakSpeed = 0;
      this.recordPeak(state, speed);
      // No back-swing seen before the arm took off: the wind-up is the start of acceleration.
      if (!this.windupEmitted) this.emitWindup(emit, t - velocityLagMs(state, this.config));
      return;
    }

    // Re-anchor when the hand has come properly to rest (not just slowed at a back-swing's end).
    if (speed < c.armSpeed * REANCHOR_SPEED_FRACTION) {
      if (this.veryStillSince < 0) this.veryStillSince = t;
      if (t - this.veryStillSince >= c.armMs * REANCHOR_MS_FACTOR) {
        this.anchor(arm.wristX, arm.wristY, t);
        return;
      }
    } else {
      this.veryStillSince = -1;
    }

    if (this.windupEmitted) return;
    const dx = arm.wristX - this.anchorX;
    const dy = arm.wristY - this.anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxDist) {
      this.maxDist = dist;
      this.maxDistT = t;
    }
    if (this.maxDist < c.windupBack) return;
    const reversedByDot = speed > MIN_REVERSAL_SPEED && m.vx * dx + m.vy * dy < 0;
    if (dist < this.maxDist - REVERSAL_SLACK || reversedByDot) {
      this.emitWindup(emit, this.maxDistT);
    }
  }

  private emitWindup(emit: Emit, t: number): void {
    this.windupEmitted = true;
    emit({ type: 'ThrowWindup', t, hand: this.hand });
  }

  private recordPeak(state: InputState, speed: number): void {
    this.peakSpeed = speed;
    this.peakT = state.t;
    this.peakVx = this.motion.vx;
    this.peakVy = this.motion.vy;
  }

  private updateAccelerating(state: InputState, emit: Emit, speed: number): void {
    const c = this.config.throw;
    const t = state.t;
    if (speed > this.peakSpeed) {
      this.recordPeak(state, speed);
      return;
    }
    if (speed >= this.peakSpeed * c.dropRatio) {
      if (t - this.ringT[this.riseIndex()] > c.maxAccelMs) this.failAcceleration(state, 'slow');
      return;
    }

    // Peak confirmed. Move the peak back by the velocity estimator's lag.
    const peakT = this.peakT - velocityLagMs(state, this.config);
    const accelMs = this.peakT - this.ringT[this.riseIndex()]; // both ends lag the motion equally
    if (this.peakSpeed >= this.neededPeak() && accelMs >= c.minAccelMs && accelMs <= c.maxAccelMs) {
      this.finish(emit, peakT, t);
    } else {
      this.failAcceleration(state, accelMs < c.minAccelMs ? 'short' : 'slow');
    }
  }

  /** The peak a release needs: `minPeak`, or 1.6 times the last release's inside its cooldown. */
  private neededPeak(): number {
    const c = this.config.throw;
    return this.supersede
      ? Math.max(c.minPeak, c.supersedeFactor * this.lastReleasePeak)
      : c.minPeak;
  }

  private finish(emit: Emit, peakT: number, t: number): void {
    const c = this.config.throw;
    this.release(emit, peakT);
    this.lastReleasePeak = this.peakSpeed;
    this.supersede = false;
    this.phase = Phase.Cooldown;
    this.cooldownUntil = t + c.cooldownMs;
    this.needBelowStart = true;
    this.slowSince = -1;
  }

  /**
   * The wrist has been out of sight for longer than the coast during an acceleration. A wrist
   * that had already reached a throw's speed is released at its peak (the blur is the throw);
   * anything else is reported as a lost arm.
   */
  private endLost(state: InputState, emit: Emit): void {
    const c = this.config.throw;
    // The speed was still rising when the wrist went: the peak is at that moment, not before it.
    // The lag correction of the other releases is deliberately NOT applied there: the blur that
    // takes the wrist away happens AT the true peak, so the last frame it was seen is already the
    // peak (moving it back by the estimator's lag puts it about 70 ms early; see the test).
    const seen = this.motion.lastSeen;
    const rising = this.peakT >= seen - 1;
    const peakT = rising ? seen : this.peakT - velocityLagMs(state, this.config);
    const accelMs = this.peakT - this.ringT[this.riseIndex()];
    if (this.peakSpeed >= this.neededPeak() && accelMs >= c.minAccelMs && accelMs <= c.maxAccelMs) {
      this.finish(emit, peakT, state.t);
    } else {
      this.failAcceleration(state, 'lost');
    }
  }

  /**
   * Too weak, too slow or too abrupt to be a throw. The arm stays armed: a pendulum swing's
   * back-swing is itself a (weak) acceleration and the real throw follows without a pause.
   */
  private failAcceleration(state: InputState, reason: RejectReason): void {
    const c = this.config.throw;
    if (this.supersede) {
      // Only a stronger movement inside the cooldown was being tried: back to the cooldown.
      this.supersede = false;
      this.phase = Phase.Cooldown;
      this.needBelowStart = true;
      return;
    }
    if (this.peakSpeed >= c.minPeak * c.noticeFraction) {
      noteRejected(state, 'throw', reason, this.peakT, this.peakSpeed, this.hand);
    }
    this.phase = Phase.Ready;
    this.needBelowStart = true;
    this.veryStillSince = -1;
  }

  private release(emit: Emit, peakT: number): void {
    const c = this.config.throw;
    const vx = this.peakVx;
    const vy = this.peakVy;
    // Position-like fields describe the moment of the peak, not the frame that confirmed it.
    this.pathAt(peakT);
    const wristY = this.sample[1];
    const lateral = this.sample[2];
    const topY = this.topBefore(this.peakT);
    // How far the wrist had come by the frame where the speed peaked (not the lag-corrected time).
    const rise = this.riseIndex();
    const startX = this.ringX[rise];
    const startY = this.ringY[rise];
    this.pathAt(this.peakT);
    const travel = Math.hypot(this.sample[0] - startX, this.sample[1] - startY);
    emit({
      type: 'ThrowReleased',
      t: peakT,
      hand: this.hand,
      speed: this.peakSpeed,
      vx,
      vy,
      lateral,
      loft: Math.atan2(vy, Math.abs(vx)),
      curvature: this.curvatureAt(peakT, c.curvatureWindowMs),
      style: wristY > 0 ? 'overarm' : 'underarm',
      travel,
      topY,
    });
  }

  /**
   * Ring index of the sample where the current acceleration began: the latest one before the peak
   * that was still slower than `RISE_FRACTION` of the peak. A throw is timed from there, not from
   * the last time the arm was still, so a cocking movement just before it does not count as part
   * of its acceleration.
   */
  private riseIndex(): number {
    const n = this.ringCount;
    const limit = this.peakSpeed * RISE_FRACTION;
    for (let k = n - 1; k >= 0; k--) {
      const i = (this.ringHead - n + k + RING) % RING;
      if (this.ringT[i] <= this.peakT && this.ringS[i] < limit) return i;
    }
    return (this.ringHead - n + RING) % RING;
  }

  /** Highest wrist (sw above its shoulder) in the `TOP_LOOKBACK_MS` up to time t. */
  private topBefore(t: number): number {
    let top = Number.NEGATIVE_INFINITY;
    const n = this.ringCount;
    for (let k = 0; k < n; k++) {
      const i = (this.ringHead - n + k + RING) % RING;
      const ti = this.ringT[i];
      if (ti >= t - TOP_LOOKBACK_MS && ti <= t + 1 && this.ringY[i] > top) top = this.ringY[i];
    }
    return top === Number.NEGATIVE_INFINITY ? this.sample[1] : top;
  }

  private toIdle(): void {
    this.phase = Phase.Idle;
    this.slowSince = -1;
    this.veryStillSince = -1;
  }

  private pushPath(state: InputState): void {
    const arm = state.arms[this.hand];
    const p = state.pose;
    const sw = state.shoulderWidth;
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    const wi = (this.hand === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST) * POSE_STRIDE;
    const h = this.ringHead;
    this.ringT[h] = state.t;
    this.ringX[h] = arm.wristX;
    this.ringY[h] = arm.wristY;
    this.ringS[h] = this.motion.speed;
    this.ringLat[h] = sw > 0 ? ((p[wi] - (p[ls] + p[rs]) / 2) * state.aspect) / sw : 0;
    this.ringHead = (h + 1) % RING;
    if (this.ringCount < RING) this.ringCount++;
  }

  /** Linear interpolation of the stored path at time t into this.sample. Clamps to the ends. */
  private pathAt(t: number): void {
    const n = this.ringCount;
    let prev = (this.ringHead - n + RING) % RING;
    if (t <= this.ringT[prev]) {
      this.copySample(prev);
      return;
    }
    for (let k = 1; k < n; k++) {
      const cur = (this.ringHead - n + k + RING) % RING;
      if (this.ringT[cur] >= t) {
        const span = this.ringT[cur] - this.ringT[prev];
        const f = span > 0 ? (t - this.ringT[prev]) / span : 1;
        this.sample[0] = this.ringX[prev] + (this.ringX[cur] - this.ringX[prev]) * f;
        this.sample[1] = this.ringY[prev] + (this.ringY[cur] - this.ringY[prev]) * f;
        this.sample[2] = this.ringLat[prev] + (this.ringLat[cur] - this.ringLat[prev]) * f;
        return;
      }
      prev = cur;
    }
    this.copySample(prev);
  }

  private copySample(i: number): void {
    this.sample[0] = this.ringX[i];
    this.sample[1] = this.ringY[i];
    this.sample[2] = this.ringLat[i];
  }

  private curvatureAt(peakT: number, windowMs: number): number {
    if (this.ringCount < 3) return 0;
    this.pathAt(peakT - windowMs);
    const ax = this.sample[0];
    const ay = this.sample[1];
    this.pathAt(peakT - windowMs / 2);
    const bx = this.sample[0];
    const by = this.sample[1];
    this.pathAt(peakT);
    return signedCurvature(ax, ay, bx, by, this.sample[0], this.sample[1]);
  }

  reset(): void {
    this.phase = Phase.Idle;
    this.slowSince = -1;
    this.veryStillSince = -1;
    this.windupEmitted = false;
    this.peakSpeed = 0;
    this.ringCount = 0;
    this.ringHead = 0;
    this.motion.reset();
    this.body.reset();
    this.needBelowStart = false;
    this.supersede = false;
    this.lastReleasePeak = 0;
    this.bodyFastT = Number.NEGATIVE_INFINITY;
  }
}
