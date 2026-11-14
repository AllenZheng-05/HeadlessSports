import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { InputState, Side } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { BodyMotion, RelativeWrist, signedCurvature, velocityLagMs } from './util';

const RING = 32;
/** Wrist-path samples closer than this (sw) to the rest anchor do not count as a back-swing. */
const REVERSAL_SLACK = 0.04;
/** Hold this many arm-ready periods at very low speed to re-anchor the rest position. */
const REANCHOR_SPEED_FRACTION = 0.4;
const REANCHOR_MS_FACTOR = 2;
const MIN_REVERSAL_SPEED = 0.5;
/** Wind-up tracking stays suspended this long after the body last moved fast. */
const BODY_SETTLE_MS = 400;

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
 * throw return to idle silently.
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
  private lastSlowT = 0;
  private cooldownUntil = 0;
  private accelStartT = 0;

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
  private ringCount = 0;
  private ringHead = 0;
  private readonly sample = new Float64Array(3);
  private readonly motion: RelativeWrist;
  private readonly body = new BodyMotion();
  /** After a failed acceleration the speed must fall below startSpeed before another can begin. */
  private needBelowStart = false;
  private bodyFastT = Number.NEGATIVE_INFINITY;

  constructor(hand: Side, config: RecognizerConfig = recognizerConfig) {
    this.hand = hand;
    this.config = config;
    this.name = `throw-${hand}`;
    this.motion = new RelativeWrist(hand);
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
    if (this.body.speed > c.maxBodySpeed) this.bodyFastT = t;
    if (t - this.bodyFastT < BODY_SETTLE_MS) {
      // The body is (or just was) moving fast: the wrist-relative-to-shoulder signal is unreliable.
      if (this.phase === Phase.Ready || this.phase === Phase.Accelerating) this.toIdle();
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
    } else if (this.phase === Phase.Ready) {
      this.updateReady(state, emit, speed);
    } else if (this.phase === Phase.Accelerating) {
      this.updateAccelerating(state, emit, speed);
    }
  }

  private enterReady(x: number, y: number, t: number): void {
    this.phase = Phase.Ready;
    this.lastSlowT = t;
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
    if (speed < c.armSpeed) this.lastSlowT = t;

    if (speed < c.startSpeed) this.needBelowStart = false;
    if (speed > c.startSpeed && !this.needBelowStart) {
      this.phase = Phase.Accelerating;
      this.accelStartT = this.lastSlowT;
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
      if (t - this.accelStartT > c.maxAccelMs) this.failAcceleration();
      return;
    }

    // Peak confirmed. Move the peak back by the velocity estimator's lag.
    const peakT = this.peakT - velocityLagMs(state, this.config);
    const accelMs = this.peakT - this.accelStartT; // both ends lag the motion equally
    if (this.peakSpeed >= c.minPeak && accelMs >= c.minAccelMs && accelMs <= c.maxAccelMs) {
      this.release(emit, peakT);
      this.phase = Phase.Cooldown;
      this.cooldownUntil = t + c.cooldownMs;
      this.slowSince = -1;
    } else {
      this.failAcceleration();
    }
  }

  /**
   * Too weak, too slow or too abrupt to be a throw. The arm stays armed: a pendulum swing's
   * back-swing is itself a (weak) acceleration and the real throw follows without a pause.
   */
  private failAcceleration(): void {
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
    });
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
    this.bodyFastT = Number.NEGATIVE_INFINITY;
  }
}
