import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { InputState } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { RelativeWrist, heightAboveShoulders, noteRejected, velocityLagMs, visible } from './util';

const WATCHING = 0;
/** A blurred-out wrist starts a swing when the last speed seen was this fraction of startSpeed... */
const ONSET_FRACTION = 0.75;
/** ...and had grown by this factor over the frame before. */
const ONSET_RISE = 1.2;
/** An onset is still "holding" when the speed has not fallen below this fraction of the frame before. */
const HOLDING = 0.97;
const SWINGING = 1;
const COOLDOWN = 2;

/**
 * Batting swing, from the wrists only. Each wrist's velocity is taken relative to the shoulder
 * midpoint and scaled by the stable body scale (so a batter standing side-on, whose shoulders
 * overlap in the image, is judged like one facing the camera). The swing signal is the midpoint of
 * the two wrists when both are seen (a two-handed swing), else the one wrist that is seen (a swing
 * with one arm, or side-on with the far arm hidden).
 *
 *  - A swing can start once the signal has been below `readySpeed` for `readyMs` (the waiting
 *    waggle is slower than that).
 *  - SwingStarted: the signal exceeds `startSpeed`, mostly sideways rather than straight up or
 *    down (raising the arms is not a swing). It is stamped at that frame, moved back by the
 *    velocity estimator's lag, but only announced once the onset is confirmed (see `confirmSpeed`):
 *    one to three frames later, never more than `confirmMs` plus a frame after the onset frame. A
 *    sport that sets `forward` is not started by the hands moving the other way (the load).
 *  - SwingPeak: the speed has fallen below `peak * dropRatio`, the peak reached `minPeak`, it came
 *    within `maxAccelMs` of the onset and the hands travelled at least `minTravel` sw. Stamped at
 *    the peak.
 *  - A motion that started or peaked but failed leaves a note in `state.rejected`.
 *  - When both wrists are clearly seen and further apart than `gripDistance` it is not a bat grip
 *    and nothing is tracked. A wrist that is only faintly seen (the far arm side-on) is left out of
 *    the signal while the other is clear. When both were clearly seen at the onset, losing either
 *    for longer than `gripGraceMs` ends the swing; otherwise the swing goes on with the wrist that
 *    is left (the jump of the tracked point is carried as an offset) and only ends 'lost' when
 *    every wrist has been gone longer than `gripGraceMs`.
 */
export class SwingRecognizer implements Recognizer {
  readonly name = 'swing';
  private readonly config: RecognizerConfig;
  private readonly left: RelativeWrist;
  private readonly right: RelativeWrist;
  private phase = WATCHING;
  private armed = false;
  private slowSince = -1;
  private cooldownUntil = 0;
  /** Time a needed wrist was first lost during a swing, or -1 while all are seen. */
  private lostSince = -1;
  /** Both wrists were clearly seen when the swing started, so both are needed to the end. */
  private bothAtStart = false;
  /** The wrists that make the signal of the swing under way (it only ever shrinks). */
  private basisL = false;
  private basisR = false;
  /** SwingStarted has been announced (the onset was confirmed). */
  private announced = false;
  private onsetFrameT = 0;
  private reacquiredUntil = Number.NEGATIVE_INFINITY;
  /** Height of the hands (sw above the shoulder line) at the onset frame, reported with the start. */
  private onsetHeight = 0;

  // The onset (first frame over startSpeed).
  private startT = 0;
  private startX = 0;
  private startY = 0;

  private peakSpeed = 0;
  private peakT = 0;
  private peakHeight = 0;
  private peakVx = 0;
  private peakVy = 0;
  private peakX = 0;
  private peakY = 0;

  // Signal speed of the last two frames, for a swing that blurs out of sight on its way up.
  private prevSpeed1 = 0;
  private prevSpeed2 = 0;

  // Scratch for the signal of the current frame.
  private sigSpeed = 0;
  private sigVx = 0;
  private sigVy = 0;
  private sigX = 0;
  private sigY = 0;
  private sigDown = 0;

  // Continuity when the wrists that make the signal change mid-swing: the position is offset for
  // good, the velocity for `switchBlendMs`.
  private offX = 0;
  private offY = 0;
  private offVx = 0;
  private offVy = 0;
  private switchT = Number.NEGATIVE_INFINITY;
  private usedL = false;
  private usedR = false;
  private lastSigVx = 0;
  private lastSigVy = 0;
  private readonly pt = new Float64Array(2);
  private readonly ptPrev = new Float64Array(2);

  constructor(config: RecognizerConfig = recognizerConfig) {
    this.config = config;
    this.left = new RelativeWrist('left', config.swing);
    this.right = new RelativeWrist('right', config.swing);
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.swing;
    const t = state.t;
    this.left.push(state);
    this.right.push(state);
    const p = state.pose;
    const lw = PoseIndex.LEFT_WRIST;
    const rw = PoseIndex.RIGHT_WRIST;
    const seenL = this.left.visible;
    const seenR = this.right.visible;
    const clearL = seenL && visible(p, lw, c.gripVisibility);
    const clearR = seenR && visible(p, rw, c.gripVisibility);
    const sw = state.shoulderWidth;

    // Not a bat grip: both wrists clearly seen and far apart.
    let apart = false;
    if (clearL && clearR) {
      const a = state.aspect;
      const gap = Math.hypot(
        (p[lw * POSE_STRIDE] - p[rw * POSE_STRIDE]) * a,
        p[lw * POSE_STRIDE + 1] - p[rw * POSE_STRIDE + 1],
      );
      apart = !(sw > 0) || gap / sw >= c.gripDistance;
    }
    // The wrists that make the signal. Next to a clearly seen wrist a faint one (the far arm
    // side-on, flickering around the visibility threshold) is only noise, so it is left out. A swing
    // under way keeps the wrists it began with and can only lose them.
    let useL = seenL;
    let useR = seenR;
    if (this.phase === SWINGING) {
      useL = useL && this.basisL;
      useR = useR && this.basisR;
    } else if (clearL || clearR) {
      useL = clearL;
      useR = clearR;
    }
    // A swing that began with two clearly seen wrists needs both; otherwise one is enough.
    const missing = this.phase === SWINGING && this.bothAtStart && !(seenL && seenR);
    if (apart || !(useL || useR) || missing || !(sw > 0)) {
      if (!apart && sw > 0 && this.phase === WATCHING && this.blurredOnset(state, emit)) return;
      // Motion blur at bat speed often drops a wrist for a frame or two: hold the last estimate
      // (take no new samples) for `gripGraceMs`, swinging or not.
      if (this.lostSince < 0) this.lostSince = t;
      if (this.phase === SWINGING && !this.announced) {
        if (!this.holdConfirm(emit) && t - this.onsetFrameT > c.confirmMs) {
          this.dropOnset(state);
          return;
        }
      }
      if (t - this.lostSince <= c.gripGraceMs) return;
      if (this.phase === SWINGING && this.announced) this.noteFailure(state, 'lost');
      this.reset();
      return;
    }
    // Just after the wrists were out of sight the speed estimate starts afresh.
    if (this.lostSince >= 0) this.reacquiredUntil = t + c.confirmMs;
    const reacquired = t <= this.reacquiredUntil;
    this.lostSince = -1;

    this.signal(state, useL, useR);
    const speed = this.sigSpeed;
    const lag = velocityLagMs(state, this.config);
    this.prevSpeed2 = this.prevSpeed1;
    this.prevSpeed1 = speed;

    if (this.phase === COOLDOWN) {
      if (t < this.cooldownUntil) return;
      this.phase = WATCHING;
      this.armed = false;
      this.slowSince = -1;
    }

    if (this.phase === WATCHING) {
      if (speed < c.readySpeed) {
        if (this.slowSince < 0) this.slowSince = t;
        if (t - this.slowSince >= c.readyMs) this.armed = true;
      } else {
        this.slowSince = -1;
      }
      if (this.armed && speed > c.startSpeed && this.flatEnough() && this.forwardEnough(speed)) {
        this.phase = SWINGING;
        this.announced = false;
        this.onsetFrameT = t;
        this.onsetHeight = heightAboveShoulders(state, this.sigDown);
        this.bothAtStart = useL && useR && clearL && clearR;
        this.basisL = useL;
        this.basisR = useR;
        this.startT = t - lag;
        // Where the hands were when the motion really began: the estimate lags by `lag`.
        this.startX = this.sigX - (this.sigVx * lag) / 1000;
        this.startY = this.sigY - (this.sigVy * lag) / 1000;
        this.peakSpeed = 0;
        this.record(state, speed);
        // Coming out of a blur there is no second frame to wait for: the motion was hidden.
        if (reacquired && this.confirmed(speed, 0)) this.announce(emit, speed);
      }
      return;
    }

    // SWINGING
    if (!this.announced) {
      if (t > this.onsetFrameT && this.confirmed(speed, this.prevSpeed2)) {
        this.announce(emit, speed);
      } else if (t - this.onsetFrameT > c.confirmMs) {
        this.dropOnset(state);
        return;
      }
    }
    if (speed > this.peakSpeed) {
      this.record(state, speed);
      return;
    }
    if (speed >= this.peakSpeed * c.dropRatio) return;
    if (!this.announced) {
      // The speed peaked and fell without the onset ever being confirmed: a flick, not a swing.
      this.dropOnset(state);
      return;
    }
    const accelMs = this.peakT - lag - this.startT;
    const travel = Math.hypot(this.peakX - this.startX, this.peakY - this.startY);
    const plane = Math.atan2(this.peakVy, Math.abs(this.peakVx));
    if (
      this.peakSpeed >= c.minPeak &&
      accelMs <= c.maxAccelMs &&
      travel >= c.minTravel &&
      Math.abs(plane) <= c.maxPlane
    ) {
      emit({
        type: 'SwingPeak',
        t: this.peakT - lag,
        speed: this.peakSpeed,
        height: this.peakHeight,
        plane,
      });
    } else {
      this.noteFailure(
        state,
        this.peakSpeed < c.minPeak
          ? 'slow'
          : Math.abs(plane) > c.maxPlane
            ? 'steep'
            : travel < c.minTravel
              ? 'short'
              : 'slow',
      );
    }
    this.phase = COOLDOWN;
    this.cooldownUntil = t + c.cooldownMs;
  }

  /**
   * Is the onset confirmed on this frame? The speed has reached `confirmSpeed` and is not falling
   * (compared with the frame before), the hands still move flat, and, with a single wrist, the
   * hand has covered `minStartTravel` since the onset.
   */
  private confirmed(speed: number, previous: number): boolean {
    const c = this.config.swing;
    if (speed < c.confirmSpeed || speed < previous * HOLDING) return false;
    if (!this.flatEnough()) return false;
    if (!(this.basisL && this.basisR)) {
      const travel = Math.hypot(this.sigX - this.startX, this.sigY - this.startY);
      if (travel < c.minStartTravel) return false;
    }
    return true;
  }

  /** The onset is confirmed: announce it, stamped at the true onset. */
  private announce(emit: Emit, speed: number): void {
    this.announced = true;
    emit({
      type: 'SwingStarted',
      t: this.startT,
      speed,
      height: this.onsetHeight,
      direction: this.sigVx >= 0 ? 1 : -1,
    });
  }

  /** A pending onset that came to nothing: back to watching, still armed (a flick is not a swing). */
  private dropOnset(state: InputState): void {
    // Peaked at a real effort (a weak swing, not a twitch): the sport may say "swing faster".
    this.noteFailure(state, 'slow');
    this.phase = WATCHING;
    this.announced = false;
    this.slowSince = -1;
    this.lostSince = -1;
    this.peakSpeed = 0;
  }

  /**
   * While the wrists are out of sight: confirm a pending onset from the held estimate. The wrists
   * going out of sight right as the speed shoots up is the motion blur of a real swing, so the
   * speed need only be over `startSpeed` and still climbing fast, as for `blurredOnset`.
   */
  private holdConfirm(emit: Emit): boolean {
    const c = this.config.swing;
    const v = this.prevSpeed1;
    if (v < c.startSpeed || v < ONSET_RISE * this.prevSpeed2 || !this.flatEnough()) return false;
    this.announce(emit, v);
    return true;
  }

  /** Is the hand moving the way the swing goes (or is a sport not saying which way that is)? */
  private forwardEnough(speed: number): boolean {
    const c = this.config.swing;
    if (c.forward === 0 || this.sigVx * c.forward >= 0) return true;
    return speed >= c.confirmSpeed * c.backwardFactor;
  }

  /**
   * The wrists blurred out of sight in the middle of the acceleration (they do, exactly where the
   * swing is fastest), before the speed ever crossed `startSpeed` in view. If the last speeds seen
   * were rising fast and nearly there, the swing has started: announce it from the held estimate.
   */
  private blurredOnset(state: InputState, emit: Emit): boolean {
    const c = this.config.swing;
    const v = this.prevSpeed1;
    if (!this.armed || v < ONSET_FRACTION * c.startSpeed || v < ONSET_RISE * this.prevSpeed2) {
      return false;
    }
    if (!this.flatEnough() || !this.forwardEnough(v * (c.confirmSpeed / c.startSpeed))) {
      return false;
    }
    const lag = velocityLagMs(state, this.config);
    this.phase = SWINGING;
    this.bothAtStart = false;
    this.basisL = this.usedL;
    this.basisR = this.usedR;
    this.lostSince = state.t;
    this.onsetFrameT = state.t;
    this.onsetHeight = heightAboveShoulders(state, this.sigDown);
    this.startT = state.t - lag;
    this.startX = this.sigX - (this.sigVx * lag) / 1000;
    this.startY = this.sigY - (this.sigVy * lag) / 1000;
    this.peakSpeed = 0;
    this.record(state, v);
    this.announce(emit, v);
    return true;
  }

  /** Is the current velocity mostly sideways (not raising or dropping the arms)? */
  private flatEnough(): boolean {
    return Math.atan2(Math.abs(this.sigVy), Math.abs(this.sigVx)) <= this.config.swing.maxPlane;
  }

  /**
   * The signal of this frame from the wrists in use, with where it is (relative to the shoulder
   * midpoint). One wrist: that wrist. Two: the grip's midpoint (two hands closing on each other
   * cancel out). When the wrists in use change during a swing the tracked point would jump (the
   * midpoint of a loose grip is not the wrist); the signal is kept continuous instead: the
   * position by an offset that stays, the velocity by one that fades over `switchBlendMs`.
   */
  private signal(state: InputState, useL: boolean, useR: boolean): void {
    const c = this.config.swing;
    const t = state.t;
    const swinging = this.phase === SWINGING;
    const changed = swinging && (useL !== this.usedL || useR !== this.usedR);
    if (changed) {
      // One frame back, where the old and the new reading of the hands were: they must agree.
      this.point(state.posePrev, state, this.usedL, this.usedR, this.ptPrev);
      this.point(state.posePrev, state, useL, useR, this.pt);
      this.offX += this.ptPrev[0] - this.pt[0];
      this.offY += this.ptPrev[1] - this.pt[1];
      this.switchT = t;
    }
    this.read(state, useL, useR);
    if (changed) {
      this.offVx = this.lastSigVx - this.sigVx;
      this.offVy = this.lastSigVy - this.sigVy;
    }
    if (swinging) {
      const f = 1 - (t - this.switchT) / c.switchBlendMs;
      if (f > 0) {
        this.sigVx += this.offVx * f;
        this.sigVy += this.offVy * f;
      }
      this.sigX += this.offX;
      this.sigY += this.offY;
    } else {
      this.offX = 0;
      this.offY = 0;
      this.switchT = Number.NEGATIVE_INFINITY;
    }
    this.sigSpeed = Math.hypot(this.sigVx, this.sigVy);
    this.lastSigVx = this.sigVx;
    this.lastSigVy = this.sigVy;
    this.usedL = useL;
    this.usedR = useR;
  }

  /** Where the used wrists are in `pose`, sw from the shoulder midpoint (x right, y up). */
  private point(
    pose: Float32Array,
    state: InputState,
    useL: boolean,
    useR: boolean,
    out: Float64Array,
  ): void {
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    const lwi = PoseIndex.LEFT_WRIST * POSE_STRIDE;
    const rwi = PoseIndex.RIGHT_WRIST * POSE_STRIDE;
    const sw = state.shoulderWidth;
    const midX = ((pose[ls] + pose[rs]) / 2) * state.aspect;
    const midY = (pose[ls + 1] + pose[rs + 1]) / 2;
    let x: number;
    let y: number;
    if (useL && useR) {
      x = ((pose[lwi] + pose[rwi]) / 2) * state.aspect;
      y = (pose[lwi + 1] + pose[rwi + 1]) / 2;
    } else {
      const wi = useL ? lwi : rwi;
      x = pose[wi] * state.aspect;
      y = pose[wi + 1];
    }
    out[0] = (x - midX) / sw;
    out[1] = (midY - y) / sw;
  }

  /** The raw signal of this frame (no continuity offsets). */
  private read(state: InputState, useL: boolean, useR: boolean): void {
    const l = this.left;
    const r = this.right;
    const p = state.pose;
    this.point(p, state, useL, useR, this.pt);
    this.sigX = this.pt[0];
    this.sigY = this.pt[1];
    if (useL && useR) {
      this.sigVx = (l.vx + r.vx) / 2;
      this.sigVy = (l.vy + r.vy) / 2;
    } else {
      const w = useL ? l : r;
      this.sigVx = w.vx;
      this.sigVy = w.vy;
    }
    // Height of the hands: the mean of the wrists in use.
    const lwy = PoseIndex.LEFT_WRIST * POSE_STRIDE + 1;
    const rwy = PoseIndex.RIGHT_WRIST * POSE_STRIDE + 1;
    this.sigDown = useL && useR ? (p[lwy] + p[rwy]) / 2 : useL ? p[lwy] : p[rwy];
  }

  private record(state: InputState, speed: number): void {
    this.peakSpeed = speed;
    this.peakT = state.t;
    this.peakVx = this.sigVx;
    this.peakVy = this.sigVy;
    this.peakX = this.sigX;
    this.peakY = this.sigY;
    this.peakHeight = heightAboveShoulders(state, this.sigDown);
  }

  private noteFailure(state: InputState, reason: 'slow' | 'short' | 'steep' | 'lost'): void {
    const c = this.config.swing;
    if (this.peakSpeed >= c.minPeak * c.noticeFraction) {
      noteRejected(state, 'swing', reason, this.peakT, this.peakSpeed);
    }
  }

  reset(): void {
    this.left.reset();
    this.right.reset();
    this.phase = WATCHING;
    this.armed = false;
    this.slowSince = -1;
    this.peakSpeed = 0;
    this.prevSpeed1 = 0;
    this.prevSpeed2 = 0;
    this.lostSince = -1;
    this.bothAtStart = false;
    this.announced = false;
    this.reacquiredUntil = Number.NEGATIVE_INFINITY;
    this.basisL = false;
    this.basisR = false;
    this.usedL = false;
    this.usedR = false;
    this.offX = 0;
    this.offY = 0;
    this.offVx = 0;
    this.offVy = 0;
    this.lastSigVx = 0;
    this.lastSigVy = 0;
    this.switchT = Number.NEGATIVE_INFINITY;
  }
}
