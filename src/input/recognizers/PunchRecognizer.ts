import type { InputState, Side } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { RelativeWrist, velocityLagMs, wristDistance } from './util';

/** A punch starts counting once the wrist is this fraction of `minPeak` fast. */
const START_FRACTION = 0.5;
/** The elbow must still be extending at this fraction of `minElbowRate` at the speed peak. */
const PEAK_ELBOW_FRACTION = 0.5;

/**
 * One hand's punch: a wrist-speed peak of at least `minPeak`, with the elbow extending at
 * `minElbowRate` or faster at some point during the acceleration (and still extending at half
 * that rate at the peak), the wrist between `minWristY`
 * and `maxWristY` (sw above the shoulder) at the peak, and the wrists not in a two-handed swing
 * grip. The event is stamped at the peak. A throw may fire for the same motion; sports choose.
 */
export class PunchRecognizer implements Recognizer {
  readonly name: string;
  private readonly hand: Side;
  private readonly config: RecognizerConfig;
  private readonly motion: RelativeWrist;
  private accelerating = false;
  private peakSpeed = 0;
  private peakT = 0;
  private peakWristY = 0;
  private maxElbowRate = 0;
  private peakElbowRate = 0;
  private cooldownUntil = Number.NEGATIVE_INFINITY;

  constructor(hand: Side, config: RecognizerConfig = recognizerConfig) {
    this.hand = hand;
    this.config = config;
    this.name = `punch-${hand}`;
    this.motion = new RelativeWrist(hand);
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.punch;
    const arm = state.arms[this.hand];
    this.motion.push(state);
    const speed = this.motion.speed;
    const t = state.t;
    if (t < this.cooldownUntil) return;

    if (!this.accelerating) {
      if (speed > c.minPeak * START_FRACTION) {
        this.accelerating = true;
        this.peakSpeed = 0;
        this.maxElbowRate = arm.elbowRate;
        this.record(state, speed);
      }
      return;
    }

    if (arm.elbowRate > this.maxElbowRate) this.maxElbowRate = arm.elbowRate;
    if (speed > this.peakSpeed) {
      this.record(state, speed);
      return;
    }
    if (speed >= this.peakSpeed * this.config.throw.dropRatio) return;

    this.accelerating = false;
    if (
      this.peakSpeed >= c.minPeak &&
      this.maxElbowRate >= c.minElbowRate &&
      this.peakElbowRate >= c.minElbowRate * PEAK_ELBOW_FRACTION &&
      this.peakWristY >= c.minWristY &&
      this.peakWristY <= c.maxWristY &&
      !(wristDistance(state) < this.config.swing.gripDistance)
    ) {
      emit({
        type: 'Punch',
        t: this.peakT - velocityLagMs(state, this.config),
        hand: this.hand,
        speed: this.peakSpeed,
      });
      this.cooldownUntil = t + c.cooldownMs;
    }
  }

  private record(state: InputState, speed: number): void {
    this.peakSpeed = speed;
    this.peakT = state.t;
    this.peakWristY = state.arms[this.hand].wristY;
    this.peakElbowRate = state.arms[this.hand].elbowRate;
  }

  reset(): void {
    this.motion.reset();
    this.accelerating = false;
    this.peakSpeed = 0;
    this.maxElbowRate = 0;
    this.cooldownUntil = Number.NEGATIVE_INFINITY;
  }
}
