import { PoseIndex, POSE_COUNT, POSE_STRIDE } from '../../tracking/types';
import { inputConfig } from '../config';
import { SlopeEstimator } from '../filters/slope';
import type { ArmState, Calibration, InputState } from '../types';

/** Time constant of the shoulder-width smoothing, seconds. */
const SHOULDER_TAU_S = 0.5;
/** Time constant of the torso-length smoothing, seconds. */
const TORSO_TAU_S = 0.5;
/**
 * Side-on, the body scale never falls under this fraction of (the player's own shoulder-width to
 * torso-length ratio, learned while facing the camera or taken from the calibration) times the
 * torso length. The torso does not change length when the body turns; the shoulder line does.
 */
const TORSO_FLOOR = 0.8;
/** The learned ratio is kept inside what a human body can have. */
const RATIO_MIN = 0.35;
const RATIO_MAX = 0.9;
/**
 * The ratio is the MEDIAN of the last `RATIO_WINDOW` samples, one taken at most every
 * `RATIO_SAMPLE_MS`, about 10 s of the player's recent posture. A lean toward the camera shortens
 * the torso in the image and so inflates the ratio, a turn shrinks the shoulders and deflates it;
 * a median ignores such episodes unless they take most of the window. The calibration seeds it.
 */
const RATIO_WINDOW = 96;
const RATIO_SAMPLE_MS = 100;
/**
 * A frame only teaches the ratio when the shoulders are square to the camera: the live width is at
 * least this fraction of the widest recent one (a turn of about 20 degrees or more is out).
 */
const SQUARE_ON = 0.93;
/** The calibration's ratio enters the window this many times. */
const SEED_SAMPLES = 8;
/** With no hips in view the scale never falls under this fraction of the widest recent width. */
const PEAK_SCALE_RATIO = 0.6;
/** How slowly the widest recent width relaxes toward the live one (the player stepping back), seconds. */
const PEAK_TAU_S = 30;

function clampRatio(r: number): number {
  return r < RATIO_MIN ? RATIO_MIN : r > RATIO_MAX ? RATIO_MAX : r;
}

/** Zero the visibility of every landmark whose x or y lies outside [0, 1]. In place. */
export function sanitizeVisibility(pose: Float32Array): void {
  for (let i = 0; i < POSE_COUNT; i++) {
    const o = i * POSE_STRIDE;
    const x = pose[o];
    const y = pose[o + 1];
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) pose[o + 3] = 0;
  }
}

/** Interior angle at b for points a-b-c, aspect-corrected 2D, radians. */
export function jointAngle(
  pose: Float32Array,
  a: number,
  b: number,
  c: number,
  aspect: number,
): number {
  const bo = b * POSE_STRIDE;
  const ax = (pose[a * POSE_STRIDE] - pose[bo]) * aspect;
  const ay = pose[a * POSE_STRIDE + 1] - pose[bo + 1];
  const cx = (pose[c * POSE_STRIDE] - pose[bo]) * aspect;
  const cy = pose[c * POSE_STRIDE + 1] - pose[bo + 1];
  return Math.atan2(Math.abs(ax * cy - ay * cx), ax * cx + ay * cy);
}

export class PoseKinematics {
  private readonly minVisibility: number;
  private readonly wristXLeft: SlopeEstimator;
  private readonly wristYLeft: SlopeEstimator;
  private readonly elbowLeft: SlopeEstimator;
  private readonly wristXRight: SlopeEstimator;
  private readonly wristYRight: SlopeEstimator;
  private readonly elbowRight: SlopeEstimator;
  private smoothedWidth = 0;
  private hasWidth = false;
  private smoothedTorso = 0;
  private hasTorso = false;
  private peakWidth = 0;
  /** Shoulder-width / torso-length ratio of the player (median of square-on frames), or the calibration's. */
  private ratio = 0;
  private readonly ratios = new Float32Array(RATIO_WINDOW);
  private readonly sorted = new Float32Array(RATIO_WINDOW);
  private ratioCount = 0;
  private ratioHead = 0;
  private lastSampleT = Number.NEGATIVE_INFINITY;
  private lastT = Number.NaN;

  constructor(velocityWindow = 4, minVisibility = inputConfig.minVisibility) {
    this.minVisibility = minVisibility;
    this.wristXLeft = new SlopeEstimator(velocityWindow);
    this.wristYLeft = new SlopeEstimator(velocityWindow);
    this.elbowLeft = new SlopeEstimator(velocityWindow);
    this.wristXRight = new SlopeEstimator(velocityWindow);
    this.wristYRight = new SlopeEstimator(velocityWindow);
    this.elbowRight = new SlopeEstimator(velocityWindow);
  }

  /**
   * Reads state.pose (already filtered) and fills shoulderWidth, arms, lean, lateral, rise.
   *
   * `state.shoulderWidth` is the BODY SCALE every speed and length is divided by. It is the live
   * 2D shoulder width while the player faces the camera, but it cannot collapse when the player
   * turns side-on (batting, javelin, pitching): then the shoulders overlap in the image, the live
   * width goes to nearly zero and every speed would explode. It is held up by the torso length
   * (shoulder midpoint to hip midpoint), or, with no hips in view, by the widest recent width.
   */
  update(state: InputState, calibration: Calibration | null): void {
    const p = state.pose;
    const a = state.aspect;
    const t = state.t;
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;

    if (calibration !== null && this.ratio === 0) {
      const torso = calibration.hipY - calibration.centreY;
      if (torso > 1e-6 && calibration.shoulderWidth > 0) {
        this.ratio = clampRatio(calibration.shoulderWidth / torso);
        // The calibration counts for a few samples, so one odd frame cannot replace it.
        for (let i = 0; i < SEED_SAMPLES; i++) this.addRatio(this.ratio);
      }
    }
    const dt = Number.isFinite(this.lastT) ? Math.max(0, t - this.lastT) / 1000 : 0;
    const lh = PoseIndex.LEFT_HIP * POSE_STRIDE;
    const rh = PoseIndex.RIGHT_HIP * POSE_STRIDE;
    const lsVis = p[ls + 3] >= this.minVisibility;
    const rsVis = p[rs + 3] >= this.minVisibility;
    const lhVis = p[lh + 3] >= this.minVisibility;
    const rhVis = p[rh + 3] >= this.minVisibility;
    if (lsVis && rsVis) {
      const w = Math.hypot((p[ls] - p[rs]) * a, p[ls + 1] - p[rs + 1]);
      if (!this.hasWidth) {
        this.smoothedWidth = w;
        this.peakWidth = w;
        this.hasWidth = true;
      } else {
        this.smoothedWidth += (1 - Math.exp(-dt / SHOULDER_TAU_S)) * (w - this.smoothedWidth);
        if (w > this.peakWidth) this.peakWidth = w;
        else this.peakWidth += (1 - Math.exp(-dt / PEAK_TAU_S)) * (w - this.peakWidth);
      }
    }
    // Torso length: shoulder midpoint to hip midpoint, from whichever of each pair is in view.
    if ((lsVis || rsVis) && (lhVis || rhVis)) {
      const sx = lsVis && rsVis ? (p[ls] + p[rs]) / 2 : lsVis ? p[ls] : p[rs];
      const sy = lsVis && rsVis ? (p[ls + 1] + p[rs + 1]) / 2 : lsVis ? p[ls + 1] : p[rs + 1];
      const hx = lhVis && rhVis ? (p[lh] + p[rh]) / 2 : lhVis ? p[lh] : p[rh];
      const hy = lhVis && rhVis ? (p[lh + 1] + p[rh + 1]) / 2 : lhVis ? p[lh + 1] : p[rh + 1];
      const len = Math.hypot((sx - hx) * a, sy - hy);
      if (!this.hasTorso) {
        this.smoothedTorso = len;
        this.hasTorso = true;
      } else {
        this.smoothedTorso += (1 - Math.exp(-dt / TORSO_TAU_S)) * (len - this.smoothedTorso);
      }
      // Learn the player's proportions while the shoulders are square to the camera.
      if (
        lsVis &&
        rsVis &&
        this.smoothedTorso > 1e-6 &&
        this.smoothedWidth >= SQUARE_ON * this.peakWidth &&
        t - this.lastSampleT >= RATIO_SAMPLE_MS
      ) {
        // A collapsed shoulder line (side-on) is not a proportion, nor is one no body has.
        const raw = this.smoothedWidth / this.smoothedTorso;
        if (raw >= RATIO_MIN && raw <= RATIO_MAX) this.learnRatio(raw, t);
      }
    }
    if (this.hasWidth) {
      let scale = this.smoothedWidth;
      let floor = PEAK_SCALE_RATIO * this.peakWidth;
      if (this.hasTorso && this.ratio > 0) floor = TORSO_FLOOR * this.ratio * this.smoothedTorso;
      if (floor > scale) scale = floor;
      state.shoulderWidth = scale;
    } else if (this.hasTorso && this.ratio > 0) {
      state.shoulderWidth = TORSO_FLOOR * this.ratio * this.smoothedTorso;
    }
    this.lastT = t;
    const sw = state.shoulderWidth;

    this.updateArm(
      state.arms.left,
      p,
      a,
      t,
      sw,
      PoseIndex.LEFT_SHOULDER,
      PoseIndex.LEFT_ELBOW,
      PoseIndex.LEFT_WRIST,
      this.wristXLeft,
      this.wristYLeft,
      this.elbowLeft,
    );
    this.updateArm(
      state.arms.right,
      p,
      a,
      t,
      sw,
      PoseIndex.RIGHT_SHOULDER,
      PoseIndex.RIGHT_ELBOW,
      PoseIndex.RIGHT_WRIST,
      this.wristXRight,
      this.wristYRight,
      this.elbowRight,
    );

    const midSx = (p[ls] + p[rs]) / 2;
    const midSy = (p[ls + 1] + p[rs + 1]) / 2;
    if (lhVis && rhVis) {
      const midHx = (p[lh] + p[rh]) / 2;
      const midHy = (p[lh + 1] + p[rh + 1]) / 2;
      state.lean = Math.atan2((midSx - midHx) * a, midHy - midSy);
      state.rise = calibration !== null && sw > 0 ? (calibration.hipY - midHy) / sw : 0;
    }
    const centreX = calibration !== null ? calibration.centreX : 0.5;
    state.lateral = sw > 0 ? ((midSx - centreX) * a) / sw : 0;
  }

  private learnRatio(raw: number, t: number): void {
    this.lastSampleT = t;
    this.addRatio(raw);
  }

  /** Add a sample and take the median of the window as the ratio. */
  private addRatio(raw: number): void {
    this.ratios[this.ratioHead] = raw;
    this.ratioHead = (this.ratioHead + 1) % RATIO_WINDOW;
    if (this.ratioCount < RATIO_WINDOW) this.ratioCount++;
    const n = this.ratioCount;
    const a = this.sorted;
    // Insertion sort of a copy: n is at most 96 and this runs about ten times a second.
    for (let i = 0; i < n; i++) {
      const v = this.ratios[i];
      let j = i - 1;
      while (j >= 0 && a[j] > v) {
        a[j + 1] = a[j];
        j--;
      }
      a[j + 1] = v;
    }
    this.ratio = clampRatio(n % 2 === 1 ? a[n >> 1] : (a[(n >> 1) - 1] + a[n >> 1]) / 2);
  }

  private updateArm(
    arm: ArmState,
    p: Float32Array,
    aspect: number,
    t: number,
    sw: number,
    shoulder: number,
    elbow: number,
    wrist: number,
    sx: SlopeEstimator,
    sy: SlopeEstimator,
    se: SlopeEstimator,
  ): void {
    const so = shoulder * POSE_STRIDE;
    const wo = wrist * POSE_STRIDE;
    const wx = p[wo] * aspect;
    const wyUp = -p[wo + 1];
    sx.push(wx, t);
    sy.push(wyUp, t);
    const angle = jointAngle(p, shoulder, elbow, wrist, aspect);
    se.push(angle, t);
    arm.elbowAngle = angle;
    arm.elbowRate = se.slope();
    if (sw > 0) {
      arm.wristX = (wx - p[so] * aspect) / sw;
      arm.wristY = (wyUp + p[so + 1]) / sw;
      arm.vx = sx.slope() / sw;
      arm.vy = sy.slope() / sw;
      arm.speed = Math.hypot(arm.vx, arm.vy);
    } else {
      arm.wristX = 0;
      arm.wristY = 0;
      arm.vx = 0;
      arm.vy = 0;
      arm.speed = 0;
    }
  }

  reset(): void {
    this.clearTracking();
    this.ratio = 0;
    this.ratioCount = 0;
    this.ratioHead = 0;
  }

  private clearTracking(): void {
    this.wristXLeft.reset();
    this.wristYLeft.reset();
    this.elbowLeft.reset();
    this.wristXRight.reset();
    this.wristYRight.reset();
    this.elbowRight.reset();
    this.smoothedWidth = 0;
    this.hasWidth = false;
    this.smoothedTorso = 0;
    this.hasTorso = false;
    this.peakWidth = 0;
    this.lastSampleT = Number.NEGATIVE_INFINITY;
    this.lastT = Number.NaN;
  }

  /**
   * Forget the tracking history (the player was lost and came back) but keep the learned body
   * proportions, so a player who is already side-on when found again still gets a stable scale.
   */
  restart(): void {
    this.clearTracking();
  }
}
