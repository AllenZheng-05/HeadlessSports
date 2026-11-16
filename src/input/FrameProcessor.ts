import { HAND_STRIDE, POSE_COUNT, POSE_STRIDE, PoseIndex } from '../tracking/types';
import type { LandmarkFrame } from '../tracking/types';
import { inputConfig } from './config';
import type { InputConfig } from './config';
import { OneEuroBank } from './filters/oneEuro';
import { SlopeEstimator } from './filters/slope';
import { FistDebouncer, handCurl, palmCentre, palmSize } from './hands/fist';
import { PoseKinematics, sanitizeVisibility } from './kinematics/poseKinematics';
import { SIDE_NONE, armsSwapped, createSideGuardState, guardSides } from './sideGuard';
import { resetInputState } from './state';
import type { Calibration, HandState, InputState, Side } from './types';

export interface FistChange {
  hand: Side;
  closed: boolean;
  t: number;
}

const POSE_COMPONENTS = 3;
const MAX_CHANGES = 4;

export class FrameProcessor {
  private readonly state: InputState;
  private readonly config: InputConfig;
  private calibration: Calibration | null = null;

  private readonly poseBank: OneEuroBank;
  private readonly kinematics: PoseKinematics;
  private readonly handBankLeft: OneEuroBank;
  private readonly handBankRight: OneEuroBank;
  private readonly slopeXLeft: SlopeEstimator;
  private readonly slopeYLeft: SlopeEstimator;
  private readonly slopeXRight: SlopeEstimator;
  private readonly slopeYRight: SlopeEstimator;
  private readonly debouncerLeft: FistDebouncer;
  private readonly debouncerRight: FistDebouncer;
  /** Per hand: was present on the previous frame. */
  private readonly handActive = new Uint8Array(2);
  private readonly handEverSeen = new Uint8Array(2);
  private readonly handLastSeen = new Float64Array(2);
  private readonly palmRaw = new Float32Array(2);
  private readonly palmFiltered = new Float32Array(2);

  private readonly changes: FistChange[] = [];
  private changeCount = 0;

  private started = false;
  private poseActive = false;
  /** What the side guard exchanged on the last frame (SIDE_* bits). */
  lastSideFix = SIDE_NONE;
  private readonly sideState = createSideGuardState();
  /** Crop hands follow their wrist: true when this frame's arms changed sides. */
  private handsExchanged = false;
  /**
   * True when hand observations come from crops around the pose wrists (so they change sides with
   * the arms). False for full-frame hands, which are assigned to slots by position alone.
   */
  handsFollowPose = true;
  private lastUsableT = Number.NEGATIVE_INFINITY;

  constructor(state: InputState, config: InputConfig = inputConfig) {
    this.state = state;
    this.config = config;
    this.poseBank = new OneEuroBank(POSE_COUNT * POSE_COMPONENTS, 1, 0);
    this.kinematics = new PoseKinematics(config.velocityWindow, config.minVisibility);
    this.handBankLeft = new OneEuroBank(2, 1, 0);
    this.handBankRight = new OneEuroBank(2, 1, 0);
    const w = config.velocityWindow;
    this.slopeXLeft = new SlopeEstimator(w);
    this.slopeYLeft = new SlopeEstimator(w);
    this.slopeXRight = new SlopeEstimator(w);
    this.slopeYRight = new SlopeEstimator(w);
    this.debouncerLeft = new FistDebouncer(config.fist);
    this.debouncerRight = new FistDebouncer(config.fist);
    for (let i = 0; i < MAX_CHANGES; i++) this.changes.push({ hand: 'left', closed: false, t: 0 });
    this.applyConfig();
  }

  /** Re-read filter parameters from the config (call after tuning them). */
  applyConfig(): void {
    const f = this.config.filter;
    for (let lm = 0; lm < POSE_COUNT; lm++) {
      let p = f.body;
      if (lm >= PoseIndex.LEFT_SHOULDER && lm <= PoseIndex.RIGHT_ELBOW) p = f.arm;
      else if (lm >= PoseIndex.LEFT_WRIST && lm <= PoseIndex.RIGHT_THUMB) p = f.wrist;
      for (let c = 0; c < POSE_COMPONENTS; c++) {
        this.poseBank.setChannelParams(lm * POSE_COMPONENTS + c, p.minCutoff, p.beta);
      }
    }
    for (let c = 0; c < 2; c++) {
      this.handBankLeft.setChannelParams(c, f.hand.minCutoff, f.hand.beta);
      this.handBankRight.setChannelParams(c, f.hand.minCutoff, f.hand.beta);
    }
  }

  setCalibration(calibration: Calibration | null): void {
    this.calibration = calibration;
  }

  /**
   * Fold one tracking frame into `state`, in place. Returns the number of fist changes this
   * frame; read them with fistChange(i). A frame older than the last one means the clock
   * restarted (clip loop): everything is reset first. A frame with the same timestamp as the
   * last is ignored.
   */
  process(frame: LandmarkFrame): number {
    const state = this.state;
    const cfg = this.config;
    this.changeCount = 0;
    if (this.started) {
      if (frame.t < state.t) this.reset();
      else if (frame.t === state.t) return 0;
    }
    state.tPrev = this.started ? state.t : frame.t;
    state.t = frame.t;
    this.started = true;
    if (frame.aspect > 0) state.aspect = frame.aspect;
    let shouldersVisible = false;
    if (frame.hasPose) {
      const pose = state.pose;
      const first = !this.poseActive;
      if (first) {
        this.poseBank.reset();
        this.kinematics.restart();
      }
      state.posePrev.set(pose);
      pose.set(frame.pose);
      sanitizeVisibility(pose);
      // Pose sometimes swaps left and right; put them back before anything is filtered. A hand
      // cropped around a wrist belongs to that wrist, so it changes sides with the arm.
      this.lastSideFix = guardSides(
        pose,
        state.posePrev,
        !first,
        state.aspect,
        cfg.minVisibility,
        cfg.sideGuard,
        this.sideState,
      );
      this.handsExchanged = this.handsFollowPose && armsSwapped(this.lastSideFix);
      this.poseBank.filterInto(pose, frame.t, pose, POSE_STRIDE, POSE_COMPONENTS);
      if (first) state.posePrev.set(pose);
      this.kinematics.update(state, this.calibration);
      this.poseActive = true;
      state.hasPose = true;
      // Side-on (batting, javelin) the far shoulder is hidden behind the torso and MediaPipe rates
      // it low, but the player is still there and still throwing: it only has to be faintly seen.
      const lv = pose[PoseIndex.LEFT_SHOULDER * POSE_STRIDE + 3];
      const rv = pose[PoseIndex.RIGHT_SHOULDER * POSE_STRIDE + 3];
      shouldersVisible =
        Math.max(lv, rv) >= cfg.minVisibility && Math.min(lv, rv) >= cfg.farShoulderVisibility;
    } else {
      this.poseActive = false;
      state.hasPose = false;
      this.lastSideFix = SIDE_NONE;
      this.handsExchanged = false;
    }

    this.updateHand(0, frame, state.hands.left);
    this.updateHand(1, frame, state.hands.right);

    const anyHand = state.hands.left.present || state.hands.right.present;
    state.tracking = frame.hasPose ? shouldersVisible : anyHand;
    if (state.tracking) this.lastUsableT = frame.t;
    this.updateProblem(frame.hasPose);
    return this.changeCount;
  }

  fistChange(index: number): Readonly<FistChange> {
    return this.changes[index];
  }

  /** Call every rendered frame; flips state.tracking to false after lostAfterMs without a usable frame. */
  tick(nowMs: number): void {
    const state = this.state;
    if (state.tracking && nowMs - this.lastUsableT > this.config.lostAfterMs) {
      state.tracking = false;
      state.problem = 'lost';
    }
  }

  reset(): void {
    resetInputState(this.state);
    this.poseBank.reset();
    this.kinematics.reset();
    this.handBankLeft.reset();
    this.handBankRight.reset();
    this.slopeXLeft.reset();
    this.slopeYLeft.reset();
    this.slopeXRight.reset();
    this.slopeYRight.reset();
    this.debouncerLeft.reset();
    this.debouncerRight.reset();
    this.handActive.fill(0);
    this.handEverSeen.fill(0);
    this.handLastSeen.fill(0);
    this.changeCount = 0;
    this.started = false;
    this.poseActive = false;
    this.lastSideFix = SIDE_NONE;
    this.handsExchanged = false;
    this.lastUsableT = Number.NEGATIVE_INFINITY;
  }

  private updateHand(index: 0 | 1, frame: LandmarkFrame, hand: HandState): void {
    const obs = frame.hands[this.handsExchanged ? 1 - index : index];
    const debouncer = index === 0 ? this.debouncerLeft : this.debouncerRight;
    const bank = index === 0 ? this.handBankLeft : this.handBankRight;
    const slopeX = index === 0 ? this.slopeXLeft : this.slopeXRight;
    const slopeY = index === 0 ? this.slopeYLeft : this.slopeYRight;
    const state = this.state;

    if (!obs.present || obs.landmarks.length < 21 * HAND_STRIDE) {
      hand.present = false;
      hand.vx = 0;
      hand.vy = 0;
      this.handActive[index] = 0;
      debouncer.interrupt();
      return;
    }

    const lm = obs.landmarks;
    const aspect = state.aspect;
    if (this.handActive[index] === 0) {
      bank.reset();
      slopeX.reset();
      slopeY.reset();
    }
    this.handActive[index] = 1;
    this.handEverSeen[index] = 1;
    this.handLastSeen[index] = frame.t;
    hand.present = true;

    const curl = handCurl(lm, aspect);
    if (Number.isFinite(curl)) {
      hand.curl = curl;
      const change = debouncer.update(curl);
      if (change !== null && this.changeCount < MAX_CHANGES) {
        const c = this.changes[this.changeCount++];
        c.hand = index === 0 ? 'left' : 'right';
        c.closed = change === 'closed';
        c.t = frame.t;
      }
    }
    hand.closed = debouncer.closed;
    hand.known = debouncer.known;

    palmCentre(lm, this.palmRaw);
    bank.filterInto(this.palmRaw, frame.t, this.palmFiltered, 2, 2);
    hand.x = this.palmFiltered[0];
    hand.y = this.palmFiltered[1];
    slopeX.push(hand.x * aspect, frame.t);
    slopeY.push(-hand.y, frame.t);
    // With a pose this frame the scale is the shoulder width; hands-only it is 4x the palm size.
    // (shoulderWidth is not cleared when the pose goes, so it must not be consulted without a pose.)
    const scale =
      state.hasPose && state.shoulderWidth > 0 ? state.shoulderWidth : 4 * palmSize(lm, aspect);
    if (scale > 1e-6) {
      hand.vx = slopeX.slope() / scale;
      hand.vy = slopeY.slope() / scale;
    } else {
      hand.vx = 0;
      hand.vy = 0;
    }
  }

  private updateProblem(hasPose: boolean): void {
    const state = this.state;
    if (!state.tracking) {
      state.problem = 'lost';
      return;
    }
    if (hasPose) {
      const p = state.pose;
      const midX =
        (p[PoseIndex.LEFT_SHOULDER * POSE_STRIDE] + p[PoseIndex.RIGHT_SHOULDER * POSE_STRIDE]) / 2;
      if (midX > 0.85) state.problem = 'move-left';
      else if (midX < 0.15) state.problem = 'move-right';
      else if (state.shoulderWidth > 0.45) state.problem = 'step-back';
      else if (state.shoulderWidth > 0 && state.shoulderWidth < 0.06) state.problem = 'step-closer';
      else state.problem = 'none';
      return;
    }
    const t = state.t;
    const lost = this.config.lostAfterMs;
    const leftGone =
      this.handEverSeen[0] === 1 && !state.hands.left.present && t - this.handLastSeen[0] > lost;
    const rightGone =
      this.handEverSeen[1] === 1 && !state.hands.right.present && t - this.handLastSeen[1] > lost;
    state.problem = leftGone || rightGone ? 'hands-out-of-view' : 'none';
  }
}
