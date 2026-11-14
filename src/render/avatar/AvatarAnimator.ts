import { Vector3 } from 'three/webgpu';
import type { AvatarRig, Side } from './AvatarRig';

/**
 * Procedural animation for the headless athlete: run cycle, sway, breathing and one-shot clips.
 * The upper body normally mirrors the player (`rig.setUpperBodyFromPose`); a clip takes an arm over
 * with `rig.setArmTarget` for its duration and releases it afterwards. Call `update(dt)` once per
 * frame BEFORE `rig.update(dt)`. No allocation per frame.
 *
 * Rig-local metres, the athlete faces -z. Clip key poses are written as offsets from the acting
 * shoulder: `out` away from the body, `up`, `fwd` toward -z.
 */

export type OneShot =
  'throw-over' | 'throw-under' | 'swing' | 'celebrate' | 'slump' | 'hop' | 'bow-release';

export interface AnimatorConfig {
  /** Radians at amplitude 1. */
  runLegSwing: number;
  runKneeBend: number;
  /** Metres. */
  runBob: number;
  breathe: number;
  /** Radians. */
  swayMax: number;
}

export const animatorConfig: AnimatorConfig = {
  runLegSwing: 0.9,
  runKneeBend: 1.2,
  runBob: 0.035,
  breathe: 0.006,
  swayMax: 0.12,
};

const DURATION: Record<OneShot, number> = {
  'throw-over': 0.55,
  'throw-under': 0.6,
  swing: 0.5,
  celebrate: 1.4,
  slump: 1.0,
  hop: 0.35,
  'bow-release': 0.4,
};

// Key-pose tables. Row: u, out, up, fwd, twist, lean, pelvis. Twist and lean are for a right-hand
// actor and are mirrored for the left. For `swing`, `out` is the hands' centre line instead,
// positive toward the acting side.
const STRIDE = 7;
// prettier-ignore
const THROW_OVER = new Float64Array([
  0.0, 0.12, 0.26, -0.30, -0.30, 0.05, 0.0,
  0.25, 0.12, 0.34, -0.34, -0.38, 0.05, -0.02,
  0.55, 0.10, 0.46, 0.06, 0.05, 0.0, 0.0,
  0.75, 0.06, 0.18, 0.46, 0.35, -0.06, -0.02,
  0.88, 0.05, -0.10, 0.44, 0.40, -0.08, -0.03,
  1.0, 0.07, -0.30, 0.30, 0.30, -0.04, 0.0,
]);
// prettier-ignore
const THROW_UNDER = new Float64Array([
  0.0, 0.10, -0.48, -0.12, 0.10, 0.0, 0.0,
  0.2, 0.10, -0.46, -0.20, 0.0, 0.0, -0.02,
  0.45, 0.10, -0.48, 0.20, 0.20, 0.0, -0.05,
  0.7, 0.09, -0.12, 0.40, 0.25, 0.0, -0.04,
  0.85, 0.08, 0.18, 0.38, 0.20, 0.0, -0.02,
  1.0, 0.07, 0.10, 0.30, 0.10, 0.0, 0.0,
]);
// prettier-ignore
const BOW_DRAW = new Float64Array([
  0.0, 0.08, 0.02, 0.16, -0.15, 0.0, 0.0,
  0.25, 0.34, 0.02, -0.08, -0.28, 0.0, 0.0,
  0.6, 0.42, -0.04, -0.16, -0.25, 0.0, 0.0,
  1.0, 0.25, -0.28, -0.02, -0.12, 0.0, 0.0,
]);
// prettier-ignore
const SWING = new Float64Array([
  0.0, 0.26, -0.10, 0.14, -0.35, 0.0, 0.0,
  0.3, 0.26, -0.08, 0.18, -0.45, 0.0, -0.01,
  0.65, -0.02, -0.12, 0.24, 0.0, 0.0, 0.0,
  0.85, -0.26, -0.08, 0.22, 0.35, 0.0, 0.0,
  1.0, -0.26, -0.20, 0.12, 0.30, 0.0, 0.0,
]);

// Rest offset of a hanging mitt from its shoulder (matches the rig's rest pose).
const REST_OUT = 0.08;
const REST_UP = -0.5;
const REST_FWD = 0.02;
// Default elbow hint offset (matches the rig's default pole).
const POLE_DEF_OUT = 0.2;
const POLE_DEF_UP = -0.5;
const POLE_DEF_FWD = -0.1;
/** Fraction of a clip spent blending from the pose it started in. */
const BLEND_FRACTION = 0.18;
const MAX_DT = 0.1;
const BREATH_HZ = 0.28;
const SWING_HAND_GAP = 0.035;

const scratch = new Float64Array(STRIDE);
const tmp = new Vector3();

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};
/** Half-sine bump on [a, b], 0 outside. */
const arc = (u: number, a: number, b: number): number =>
  u <= a || u >= b ? 0 : Math.sin((Math.PI * (u - a)) / (b - a));

/** Cubic Hermite through the key rows (non-uniform times), result in `scratch`. No allocation. */
function sampleTable(table: Float64Array, u: number): void {
  const rows = table.length / STRIDE;
  if (u <= table[0]) {
    for (let c = 1; c < STRIDE; c++) scratch[c] = table[c];
    return;
  }
  const last = (rows - 1) * STRIDE;
  if (u >= table[last]) {
    for (let c = 1; c < STRIDE; c++) scratch[c] = table[last + c];
    return;
  }
  let i = 0;
  while (table[(i + 1) * STRIDE] <= u) i++;
  const o1 = i * STRIDE;
  const o2 = o1 + STRIDE;
  const u1 = table[o1];
  const u2 = table[o2];
  const dt = u2 - u1;
  const h = (u - u1) / dt;
  const h2 = h * h;
  const h3 = h2 * h;
  const h00 = 2 * h3 - 3 * h2 + 1;
  const h10 = h3 - 2 * h2 + h;
  const h01 = -2 * h3 + 3 * h2;
  const h11 = h3 - h2;
  for (let c = 1; c < STRIDE; c++) {
    const p1 = table[o1 + c];
    const p2 = table[o2 + c];
    const m1 = i > 0 ? (p2 - table[o1 - STRIDE + c]) / (u2 - table[o1 - STRIDE]) : (p2 - p1) / dt;
    const m2 =
      i + 2 < rows ? (table[o2 + STRIDE + c] - p1) / (table[o2 + STRIDE] - u1) : (p2 - p1) / dt;
    scratch[c] = h00 * p1 + h10 * dt * m1 + h01 * p2 + h11 * dt * m2;
  }
}

export class AvatarAnimator {
  private readonly rig: AvatarRig;
  private readonly config: AnimatorConfig;

  // Run cycle.
  private runTarget = 0;
  private runAmpTarget = 0;
  private runCadence = 0;
  private runAmp = 0;
  private runPhase = 0;
  private legsDirty = false;

  // Sway, breathing.
  private sway = 0;
  private breathing = true;
  private breathPhase = 0;
  private torsoDirty = false;
  private pelvisDirty = false;

  // One-shot.
  private clip: OneShot | null = null;
  private clipSide: Side = 'right';
  private clipStrength = 1;
  private clipT = 0;
  private clipDur = 0;
  private land1 = false;
  private land2 = false;
  private usesLeft = false;
  private usesRight = false;
  /** Root-local mitt positions when the clip began (x, y, z per arm). */
  private readonly startL = new Float64Array(3);
  private readonly startR = new Float64Array(3);

  // Per-frame clip outputs.
  private cTwist = 0;
  private cLean = 0;
  private cPelvis = 0;
  private cLegHipL = 0;
  private cLegKneeL = 0;
  private cLegHipR = 0;
  private cLegKneeR = 0;
  // Offsets from the shoulder for the arms a clip drives (left, right), and elbow pole offsets.
  private readonly off = new Float64Array(6);
  private poleOut = POLE_DEF_OUT;
  private poleUp = POLE_DEF_UP;
  private poleFwd = POLE_DEF_FWD;
  private poleOutB = POLE_DEF_OUT;
  private poleUpB = POLE_DEF_UP;
  private poleFwdB = POLE_DEF_FWD;

  constructor(rig: AvatarRig, config: AnimatorConfig = animatorConfig) {
    this.rig = rig;
    this.config = config;
  }

  get busy(): boolean {
    return this.clip !== null;
  }

  get current(): OneShot | null {
    return this.clip;
  }

  setRun(stepsPerSecond: number, amplitude = 1): void {
    const sps = stepsPerSecond > 0 ? stepsPerSecond : 0;
    this.runTarget = sps;
    this.runAmpTarget = sps > 0 ? clamp01(amplitude) : 0;
  }

  setSway(amount: number): void {
    this.sway = amount < -1 ? -1 : amount > 1 ? 1 : amount;
  }

  setBreathing(on: boolean): void {
    this.breathing = on;
  }

  play(clip: OneShot, options: { side?: Side; strength?: number } = {}): void {
    const prevL = this.usesLeft;
    const prevR = this.usesRight;
    this.clip = clip;
    this.clipSide = options.side ?? 'right';
    this.clipStrength = clamp01(options.strength ?? 1);
    this.clipT = 0;
    this.clipDur = DURATION[clip];
    this.land1 = false;
    this.land2 = false;
    const bilateral = clip === 'swing' || clip === 'celebrate' || clip === 'slump';
    const acting = this.clipSide;
    this.usesLeft = bilateral || clip === 'bow-release' || (clip !== 'hop' && acting === 'left');
    this.usesRight = bilateral || clip === 'bow-release' || (clip !== 'hop' && acting === 'right');
    // Arms the previous clip had and this one does not need go back to the player.
    if (prevL && !this.usesLeft) this.rig.releaseArm('left');
    if (prevR && !this.usesRight) this.rig.releaseArm('right');
    if (this.usesLeft) this.captureStart('left', this.startL);
    if (this.usesRight) this.captureStart('right', this.startR);
  }

  stop(): void {
    if (this.clip === null) return;
    this.endClip();
  }

  reset(): void {
    this.stop();
    this.runTarget = 0;
    this.runAmpTarget = 0;
    this.runCadence = 0;
    this.runAmp = 0;
    this.runPhase = 0;
    this.sway = 0;
    this.breathing = true;
    this.breathPhase = 0;
    this.rig.setLeg('left', 0, 0);
    this.rig.setLeg('right', 0, 0);
    this.rig.setPelvisOffset(0);
    this.rig.setTorso(0, 0);
    this.legsDirty = false;
    this.pelvisDirty = false;
    this.torsoDirty = false;
  }

  update(dt: number): void {
    const step = dt < 0 ? 0 : dt > MAX_DT ? MAX_DT : dt;
    const cfg = this.config;
    const rig = this.rig;

    // Run cycle state.
    this.runCadence += (this.runTarget - this.runCadence) * (1 - Math.exp(-step / 0.08));
    this.runAmp += (this.runAmpTarget - this.runAmp) * (1 - Math.exp(-step / 0.07));
    if (this.runTarget === 0 && this.runAmp < 1e-3) this.runAmp = 0;
    this.runPhase += this.runCadence * Math.PI * step;
    if (this.runPhase > 1e5) this.runPhase -= 1e5 * Math.PI * 2;

    this.cTwist = 0;
    this.cLean = 0;
    this.cPelvis = 0;
    this.cLegHipL = 0;
    this.cLegKneeL = 0;
    this.cLegHipR = 0;
    this.cLegKneeR = 0;
    let clipActive = false;
    let ended = false;
    if (this.clip !== null) {
      this.clipT += step;
      if (this.clipT >= this.clipDur) {
        if (this.clip === 'hop') rig.squash(0.82);
        ended = true;
      } else {
        clipActive = true;
        this.evalClip(this.clipT / this.clipDur);
      }
    }

    // Pelvis: breathing + run bob + clip, one call.
    this.breathPhase += step * BREATH_HZ * Math.PI * 2;
    if (this.breathPhase > 1e5) this.breathPhase -= 1e5 * Math.PI * 2;
    let pelvis = this.cPelvis;
    if (this.breathing) pelvis += cfg.breathe * (0.5 + 0.5 * Math.sin(this.breathPhase));
    if (this.runAmp > 0) {
      const s = Math.sin(this.runPhase);
      pelvis += cfg.runBob * this.runAmp * s * s;
    }
    if (pelvis !== 0 || this.pelvisDirty) {
      rig.setPelvisOffset(pelvis);
      this.pelvisDirty = pelvis !== 0;
    }

    // Legs.
    const amp = this.runAmp;
    if (amp > 0 || this.legsDirty || clipActive) {
      const sL = Math.sin(this.runPhase);
      const sR = -sL;
      const hipL = cfg.runLegSwing * amp * (sL > 0 ? sL : 0.35 * sL) + this.cLegHipL;
      const hipR = cfg.runLegSwing * amp * (sR > 0 ? sR : 0.35 * sR) + this.cLegHipR;
      const kneeL = cfg.runKneeBend * amp * (sL > 0 ? sL : 0) + this.cLegKneeL;
      const kneeR = cfg.runKneeBend * amp * (sR > 0 ? sR : 0) + this.cLegKneeR;
      rig.setLeg('left', hipL, kneeL);
      rig.setLeg('right', hipR, kneeR);
      this.legsDirty = amp > 0 || clipActive;
    }

    // Torso: sway and clip twist. Only touched when needed, so pose-driven lean is left alone.
    const swayLean = cfg.swayMax * this.sway;
    if (this.sway !== 0 || clipActive) {
      rig.setTorso(swayLean + this.cLean, this.cTwist + swayLean * 0.4);
      this.torsoDirty = true;
    } else if (this.torsoDirty) {
      rig.setTorso(0, 0);
      this.torsoDirty = false;
    }

    // Arms.
    if (clipActive) this.driveArms(pelvis);
    if (ended) this.endClip();
  }

  // ---- internals ----

  private captureStart(side: Side, out: Float64Array): void {
    const m = this.rig.mitts[side];
    m.getWorldPosition(tmp);
    this.rig.root.worldToLocal(tmp);
    out[0] = tmp.x;
    out[1] = tmp.y;
    out[2] = tmp.z;
  }

  private endClip(): void {
    if (this.usesLeft) this.rig.releaseArm('left');
    if (this.usesRight) this.rig.releaseArm('right');
    this.usesLeft = false;
    this.usesRight = false;
    this.clip = null;
    this.clipT = 0;
  }

  /** Fill the per-frame clip outputs for progress u in [0, 1). */
  private evalClip(u: number): void {
    const s = this.clipStrength;
    const sign = this.clipSide === 'right' ? 1 : -1;
    const off = this.off;
    switch (this.clip) {
      case 'throw-over':
      case 'throw-under': {
        sampleTable(this.clip === 'throw-over' ? THROW_OVER : THROW_UNDER, u);
        this.setActing(sign, scratch[1], scratch[2], scratch[3]);
        this.cTwist = sign * scratch[4] * s;
        this.cLean = sign * scratch[5] * s;
        this.cPelvis = scratch[6] * s;
        if (this.clip === 'throw-over') this.setPole(0.35, 0.05, -0.1);
        else {
          this.setPole(0.15, -0.5, -0.2);
          // Opposite leg bends slightly while the arm swings through.
          const env = smooth(u / 0.25) * smooth((1 - u) / 0.2);
          if (sign === 1) {
            this.cLegHipL = 0.35 * s * env;
            this.cLegKneeL = 0.5 * s * env;
          } else {
            this.cLegHipR = 0.35 * s * env;
            this.cLegKneeR = 0.5 * s * env;
          }
        }
        break;
      }
      case 'bow-release': {
        sampleTable(BOW_DRAW, u);
        this.setActing(sign, scratch[1], scratch[2], scratch[3]);
        this.cTwist = sign * scratch[4] * s;
        // The bow arm (opposite side) stays extended forward with a small recoil.
        const recoil = 0.05 * s * arc(u, 0.2, 0.6);
        this.setOther(sign, 0.1, 0.02, REST_FWD + (0.5 - REST_FWD) * s - recoil);
        this.setPole(0.4, 0, -0.2);
        this.setPoleB(0.2, -0.4, 0.2);
        break;
      }
      case 'swing': {
        sampleTable(SWING, u);
        const cx = sign * scratch[1] * s;
        // Both hands together: absolute x here, converted to shoulder offsets in driveArms.
        off[0] = cx - SWING_HAND_GAP; // left hand x (rig-local)
        off[3] = cx + SWING_HAND_GAP; // right hand x
        off[1] = off[4] = scratch[2];
        off[2] = off[5] = scratch[3];
        this.cTwist = sign * scratch[4] * s;
        this.cPelvis = scratch[6] * s;
        this.setPole(0.35, -0.2, 0);
        this.setPoleB(0.35, -0.2, 0);
        break;
      }
      case 'celebrate': {
        const a1 = arc(u, 0.12, 0.42);
        const a2 = arc(u, 0.46, 0.76);
        if (!this.land1 && u >= 0.42) {
          this.land1 = true;
          this.rig.squash(0.82);
        }
        if (!this.land2 && u >= 0.76) {
          this.land2 = true;
          this.rig.squash(0.82);
        }
        const e = smooth(u / 0.14) * smooth((1 - u) / 0.16);
        const pump = 0.36 + 0.14 * (a1 + a2);
        const k = e * s;
        const out = REST_OUT + (0.2 - REST_OUT) * k;
        const up = REST_UP + (pump - REST_UP) * k;
        const fwd = REST_FWD + (0.06 - REST_FWD) * k;
        this.setMirrored(out, up, fwd);
        this.setPole(0.35, -0.1, 0);
        this.setPoleB(0.35, -0.1, 0);
        this.cPelvis = 0.11 * s * (a1 + a2);
        const tuck = a1 + a2;
        this.cLegHipL = this.cLegHipR = 0.3 * s * tuck;
        this.cLegKneeL = this.cLegKneeR = 0.5 * s * tuck;
        this.cLean = 0.04 * s * Math.sin(u * Math.PI * 4);
        break;
      }
      case 'slump': {
        const e = smooth(u / 0.35) * smooth((1 - u) / 0.35);
        const k = e * s;
        this.setMirrored(
          REST_OUT + (0.06 - REST_OUT) * k,
          REST_UP + (-0.48 - REST_UP) * k,
          REST_FWD + (0.14 - REST_FWD) * k,
        );
        this.setPole(POLE_DEF_OUT, POLE_DEF_UP, POLE_DEF_FWD);
        this.setPoleB(POLE_DEF_OUT, POLE_DEF_UP, POLE_DEF_FWD);
        this.cLean = 0.1 * k;
        this.cPelvis = -0.05 * k;
        break;
      }
      default: {
        // hop
        const a = arc(u, 0, 1);
        this.cPelvis = 0.14 * s * a;
        this.cLegHipL = this.cLegHipR = 0.3 * s * a;
        this.cLegKneeL = this.cLegKneeR = 0.5 * s * a;
        break;
      }
    }
  }

  /** Strength-scaled offset for the acting arm (about the rest pose). */
  private setActing(sign: number, out: number, up: number, fwd: number): void {
    const s = this.clipStrength;
    const o = REST_OUT + (out - REST_OUT) * s;
    const u = REST_UP + (up - REST_UP) * s;
    const f = REST_FWD + (fwd - REST_FWD) * s;
    if (sign === 1) this.setRight(o, u, f);
    else this.setLeft(o, u, f);
  }

  private setOther(sign: number, out: number, up: number, fwd: number): void {
    if (sign === 1) this.setLeft(out, up, fwd);
    else this.setRight(out, up, fwd);
  }

  private setMirrored(out: number, up: number, fwd: number): void {
    this.setLeft(out, up, fwd);
    this.setRight(out, up, fwd);
  }

  private setLeft(out: number, up: number, fwd: number): void {
    this.off[0] = out;
    this.off[1] = up;
    this.off[2] = fwd;
  }

  private setRight(out: number, up: number, fwd: number): void {
    this.off[3] = out;
    this.off[4] = up;
    this.off[5] = fwd;
  }

  private setPole(out: number, up: number, fwd: number): void {
    this.poleOut = out;
    this.poleUp = up;
    this.poleFwd = fwd;
  }

  private setPoleB(out: number, up: number, fwd: number): void {
    this.poleOutB = out;
    this.poleUpB = up;
    this.poleFwdB = fwd;
  }

  /**
   * Send the arm targets to the rig. `off` holds shoulder offsets (out, up, fwd) per arm, except
   * for `swing` where it holds rig-local x, shoulder-relative up and fwd.
   */
  private driveArms(pelvisOffset: number): void {
    const rig = this.rig;
    const dims = rig.dimensions;
    const halfSw = dims.shoulderWidth / 2;
    const sy = dims.shoulderHeight + pelvisOffset;
    const t = this.clipT;
    const w = smooth(t / (this.clipDur * BLEND_FRACTION));
    const swing = this.clip === 'swing';
    const twist = this.cTwist;
    const cosT = Math.cos(twist);
    const sinT = Math.sin(twist);
    // Which arm gets the primary pole: the acting side. The other arm uses the secondary.
    const rightIsActing = this.clipSide === 'right';
    for (let a = 0; a < 2; a++) {
      const left = a === 0;
      if (left ? !this.usesLeft : !this.usesRight) continue;
      const sign = left ? -1 : 1;
      const o = left ? 0 : 3;
      const start = left ? this.startL : this.startR;
      const sx = sign * halfSw * cosT;
      const sz = -sign * halfSw * sinT;
      let tx: number;
      if (swing) tx = this.off[o];
      else tx = sx + sign * this.off[o];
      const ty = sy + this.off[o + 1];
      const tz = sz - this.off[o + 2];
      const x = start[0] + (tx - start[0]) * w;
      const y = start[1] + (ty - start[1]) * w;
      const z = start[2] + (tz - start[2]) * w;
      const primary = (sign === 1) === rightIsActing;
      const po = primary ? this.poleOut : this.poleOutB;
      const pu = primary ? this.poleUp : this.poleUpB;
      const pf = primary ? this.poleFwd : this.poleFwdB;
      const pOut = POLE_DEF_OUT + (po - POLE_DEF_OUT) * w;
      const pUp = POLE_DEF_UP + (pu - POLE_DEF_UP) * w;
      const pFwd = POLE_DEF_FWD + (pf - POLE_DEF_FWD) * w;
      rig.setArmTarget(left ? 'left' : 'right', x, y, z, sx + sign * pOut, sy + pUp, sz - pFwd);
    }
  }
}
