import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { SlopeEstimator } from '../filters/slope';
import type { InputState } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { heightAboveShoulders, velocityLagMs, wristDistance } from './util';

const WATCHING = 0;
const SWINGING = 1;
const COOLDOWN = 2;

/**
 * Two-handed swing (batting). A grip is both wrists visible and closer than `gripDistance`. The
 * midpoint of the wrists is tracked with its own slope estimators. SwingStarted fires when the
 * midpoint speed exceeds `startSpeed` after it was seen below `readySpeed` while gripped;
 * SwingPeak fires when the speed peak is confirmed (speed < peak * dropRatio) and the peak is at
 * least `minPeak`. Losing the grip resets everything, except that during a swing it is tolerated for `gripGraceMs`.
 */
export class SwingRecognizer implements Recognizer {
  readonly name = 'swing';
  private readonly config: RecognizerConfig;
  private readonly sx = new SlopeEstimator(4);
  private readonly sy = new SlopeEstimator(4);
  private phase = WATCHING;
  private gripped = false;
  private armed = false;
  private cooldownUntil = 0;
  /** Time the grip was first lost during a swing, or -1 while it is held. */
  private lostSince = -1;

  private peakSpeed = 0;
  private peakT = 0;
  private peakHeight = 0;
  private peakVx = 0;
  private peakVy = 0;

  constructor(config: RecognizerConfig = recognizerConfig) {
    this.config = config;
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.swing;
    const t = state.t;
    const sw = state.shoulderWidth;
    if (!(wristDistance(state) < c.gripDistance)) {
      // Motion blur at bat speed often drops wrist visibility for a frame or two. Once a swing
      // has started, hold the last valid estimate (take no new samples) for `gripGraceMs`.
      if (this.phase === SWINGING) {
        if (this.lostSince < 0) this.lostSince = t;
        if (t - this.lostSince <= c.gripGraceMs) return;
      }
      this.reset();
      return;
    }
    this.lostSince = -1;
    const p = state.pose;
    const l = PoseIndex.LEFT_WRIST * POSE_STRIDE;
    const r = PoseIndex.RIGHT_WRIST * POSE_STRIDE;
    const myDown = (p[l + 1] + p[r + 1]) / 2;
    // Relative to the shoulder midpoint, so stepping or leaning does not look like a swing.
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    const shoulderX = ((p[ls] + p[rs]) / 2) * state.aspect;
    const shoulderYDown = (p[ls + 1] + p[rs + 1]) / 2;
    this.sx.push(((p[l] + p[r]) / 2) * state.aspect - shoulderX, t);
    this.sy.push(shoulderYDown - myDown, t);
    if (!this.gripped) {
      // Grip just formed: the slope windows hold nothing from before it.
      this.gripped = true;
      return;
    }
    const vx = this.sx.slope() / sw;
    const vy = this.sy.slope() / sw;
    const speed = Math.hypot(vx, vy);
    const lag = velocityLagMs(state, this.config);

    if (this.phase === COOLDOWN) {
      if (t < this.cooldownUntil) return;
      this.phase = WATCHING;
      this.armed = false;
    }

    if (this.phase === WATCHING) {
      if (speed < c.readySpeed) this.armed = true;
      else if (this.armed && speed > c.startSpeed) {
        this.phase = SWINGING;
        this.peakSpeed = 0;
        this.record(state, speed, vx, vy, myDown);
        emit({
          type: 'SwingStarted',
          t: t - lag,
          speed,
          height: heightAboveShoulders(state, myDown),
          direction: vx >= 0 ? 1 : -1,
        });
      }
      return;
    }

    // SWINGING
    if (speed > this.peakSpeed) {
      this.record(state, speed, vx, vy, myDown);
      return;
    }
    if (speed >= this.peakSpeed * c.dropRatio) return;
    if (this.peakSpeed >= c.minPeak) {
      emit({
        type: 'SwingPeak',
        t: this.peakT - lag,
        speed: this.peakSpeed,
        height: this.peakHeight,
        plane: Math.atan2(this.peakVy, Math.abs(this.peakVx)),
      });
    }
    this.phase = COOLDOWN;
    this.cooldownUntil = t + c.cooldownMs;
  }

  private record(state: InputState, speed: number, vx: number, vy: number, myDown: number): void {
    this.peakSpeed = speed;
    this.peakT = state.t;
    this.peakVx = vx;
    this.peakVy = vy;
    this.peakHeight = heightAboveShoulders(state, myDown);
  }

  reset(): void {
    this.sx.reset();
    this.sy.reset();
    this.phase = WATCHING;
    this.gripped = false;
    this.armed = false;
    this.peakSpeed = 0;
    this.lostSince = -1;
  }
}
