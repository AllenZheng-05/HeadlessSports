import {
  CapsuleGeometry,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry, Material } from 'three/webgpu';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { PALETTE } from '../style/palette';
import { toonMaterial } from '../style/toon';
import { solveTwoBone } from './ik';

export type Side = 'left' | 'right';
export interface AvatarOptions {
  /** Colour of mitts and feet. Default PALETTE.whistle. */
  playerColor?: number;
  /** Colour of the body. Default PALETTE.putty. */
  bodyColor?: number;
}

const DIM = {
  shoulderWidth: 0.4,
  upperArm: 0.27,
  forearm: 0.25,
  shoulderHeight: 1.3,
  hipHeight: 0.78,
  thigh: 0.38,
  shin: 0.36,
};

const TORSO_RADIUS = 0.19;
const SHOULDER_UP = DIM.shoulderHeight - DIM.hipHeight; // shoulder joint above the pelvis
const HIP_HALF = 0.105; // hips 0.21 m apart so the legs read as two legs from behind
const MITT_OPEN = { x: 1.15, y: 0.55, z: 1.25 };
const MITT_FIST = 0.95;
const SMOOTH_TIME = 0.06; // seconds, critically damped
const VIS_MIN = 0.5;
const MAX_DT = 0.1;
const MAX_LEAN = 0.6;

const UP = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

// Module-level scratch, shared by all rigs (update is synchronous).
const sA = new Vector3();
const sB = new Vector3();
const sC = new Vector3();
const sMid = new Vector3();
const sEnd = new Vector3();
const qTwist = new Quaternion();
const qLean = new Quaternion();
const qInv = new Quaternion();
const qTorso = new Quaternion();

/** Critically damped smoothing of one scalar. Returns the new value; velocity stored in vel[i]. */
function damp(
  cur: number,
  target: number,
  vel: Float64Array,
  i: number,
  omega: number,
  dt: number,
): number {
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel[i] + omega * change) * dt;
  vel[i] = (vel[i] - omega * temp) * e;
  return target + (change + temp) * e;
}

type ArmMode = 'rest' | 'pose' | 'proc';

interface Arm {
  side: Side;
  sign: number;
  shoulder: Vector3; // torso-local
  restW: Vector3; // offsets from the shoulder, rig orientation
  restP: Vector3;
  desW: Vector3;
  desP: Vector3;
  sW: Vector3;
  sP: Vector3;
  vel: Float64Array; // 6: sW xyz, sP xyz
  procT: Vector3; // rig-local absolute
  procP: Vector3;
  hasProcPole: boolean;
  mode: ArmMode;
  upper: Object3D;
  fore: Object3D;
  mitt: Object3D;
  mittMesh: Mesh;
  curl: number;
  curlTarget: number;
  curlVel: Float64Array;
  // landmark indices
  iS: number;
  iE: number;
  iW: number;
}

interface Leg {
  thigh: Object3D;
  shin: Object3D;
  hip: number;
  knee: number;
}

export class AvatarRig {
  readonly root = new Group();
  readonly mitts: { left: Object3D; right: Object3D };
  readonly dimensions = { ...DIM };

  private readonly pelvis = new Object3D();
  private readonly torso = new Object3D();
  private readonly arms: { left: Arm; right: Arm };
  private readonly legs: { left: Leg; right: Leg };
  private readonly geometries: BufferGeometry[] = [];
  private pelvisOffset = 0;
  private lean = 0;
  private twist = 0;
  private leanTarget = 0;
  private twistTarget = 0;
  private readonly torsoVel = new Float64Array(2);
  private squashS = 1;
  private squashVel = new Float64Array(1);
  // Landmark scratch: x, y per slot (0 shoulderL, 1 shoulderR, 2 elbow, 3 wrist, 4 hipL, 5 hipR)
  private readonly lx = new Float64Array(6);
  private readonly ly = new Float64Array(6);

  constructor(options: AvatarOptions = {}) {
    const bodyMat = toonMaterial(options.bodyColor ?? PALETTE.putty);
    const playerMat = toonMaterial(options.playerColor ?? PALETTE.whistle);

    this.root.name = 'avatar';
    this.pelvis.name = 'pelvis';
    this.pelvis.position.y = DIM.hipHeight;
    this.torso.name = 'torso';
    this.root.add(this.pelvis);
    this.pelvis.add(this.torso);

    // Pelvis blob.
    const pelvisGeo = this.track(new SphereGeometry(0.17, 16, 12));
    const pelvisMesh = new Mesh(pelvisGeo, bodyMat);
    pelvisMesh.name = 'pelvis-mesh';
    pelvisMesh.scale.set(1.05, 0.7, 0.85);
    pelvisMesh.position.y = -0.02;
    this.pelvis.add(pelvisMesh);

    // Torso: rounded capsule, top is a smooth dome at the shoulders (no head, no neck).
    const torsoTotal = 0.65;
    const torsoGeo = this.track(
      new CapsuleGeometry(TORSO_RADIUS, torsoTotal - 2 * TORSO_RADIUS, 8, 16),
    );
    const torsoMesh = new Mesh(torsoGeo, bodyMat);
    torsoMesh.name = 'torso-mesh';
    torsoMesh.scale.z = 0.85;
    torsoMesh.position.y = -0.05 + torsoTotal / 2;
    this.torso.add(torsoMesh);

    const left = this.makeArm('left', bodyMat, playerMat);
    const right = this.makeArm('right', bodyMat, playerMat);
    this.arms = { left, right };
    this.mitts = { left: left.mitt, right: right.mitt };

    this.legs = {
      left: this.makeLeg('left', bodyMat, playerMat),
      right: this.makeLeg('right', bodyMat, playerMat),
    };

    this.update(0);
  }

  private track<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  /** Capsule from the joint along +dir*y (dir=1 up, -1 down) covering `len` plus half a radius at each end. */
  private limbGeometry(radius: number, len: number, dir: 1 | -1): BufferGeometry {
    const g = this.track(new CapsuleGeometry(radius, len - radius, 6, 12));
    g.translate(0, (dir * len) / 2, 0);
    return g;
  }

  private makeArm(side: Side, bodyMat: Material, playerMat: Material): Arm {
    const sign = side === 'left' ? -1 : 1;
    const shoulder = new Vector3((sign * DIM.shoulderWidth) / 2, SHOULDER_UP, 0);

    const upper = new Object3D();
    upper.name = `upper-arm-${side}`;
    const upperMesh = new Mesh(this.limbGeometry(0.068, DIM.upperArm, 1), bodyMat);
    upperMesh.name = `upper-arm-${side}-mesh`;
    upper.add(upperMesh);

    const fore = new Object3D();
    fore.name = `forearm-${side}`;
    const foreMesh = new Mesh(this.limbGeometry(0.062, DIM.forearm, 1), bodyMat);
    foreMesh.name = `forearm-${side}-mesh`;
    fore.add(foreMesh);

    const mitt = new Object3D();
    mitt.name = `mitt-${side}`;
    const mittMesh = new Mesh(this.track(new SphereGeometry(0.095, 16, 12)), playerMat);
    mittMesh.name = `mitt-${side}-mesh`;
    mitt.add(mittMesh);

    this.torso.add(upper, fore, mitt);

    return {
      side,
      sign,
      shoulder,
      restW: new Vector3(sign * 0.08, -0.5, -0.02),
      restP: new Vector3(sign * 0.1, -0.27, 0.3),
      desW: new Vector3(sign * 0.08, -0.5, -0.02),
      desP: new Vector3(sign * 0.1, -0.27, 0.3),
      sW: new Vector3(sign * 0.08, -0.5, -0.02),
      sP: new Vector3(sign * 0.1, -0.27, 0.3),
      vel: new Float64Array(6),
      procT: new Vector3(),
      procP: new Vector3(),
      hasProcPole: false,
      mode: 'rest',
      upper,
      fore,
      mitt,
      mittMesh,
      curl: 0,
      curlTarget: 0,
      curlVel: new Float64Array(1),
      iS: side === 'left' ? PoseIndex.LEFT_SHOULDER : PoseIndex.RIGHT_SHOULDER,
      iE: side === 'left' ? PoseIndex.LEFT_ELBOW : PoseIndex.RIGHT_ELBOW,
      iW: side === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST,
    };
  }

  private makeLeg(side: Side, bodyMat: Material, playerMat: Material): Leg {
    const sign = side === 'left' ? -1 : 1;
    const thigh = new Object3D();
    thigh.name = `thigh-${side}`;
    thigh.position.set(sign * HIP_HALF, 0, 0);
    const thighMesh = new Mesh(this.limbGeometry(0.075, DIM.thigh, -1), bodyMat);
    thighMesh.name = `thigh-${side}-mesh`;
    thigh.add(thighMesh);

    const shin = new Object3D();
    shin.name = `shin-${side}`;
    shin.position.y = -DIM.thigh;
    const shinMesh = new Mesh(this.limbGeometry(0.065, DIM.shin, -1), bodyMat);
    shinMesh.name = `shin-${side}-mesh`;
    shin.add(shinMesh);

    // Rounded shoe blob (0.16 wide, 0.096 tall, 0.23 long): wider than the shin so it shows from
    // behind, with the heel reaching back (+z) past the ankle. Sits flat on the ground (ankle is 0.04 up).
    const footGeo = this.track(new SphereGeometry(1, 16, 12));
    footGeo.scale(0.08, 0.048, 0.115);
    const foot = new Mesh(footGeo, playerMat);
    foot.name = `foot-${side}`;
    // Ankle is at the shin pivot's local y = -shin; the foot centre sits 0.008 above that (ground + half height).
    foot.position.set(0, -DIM.shin + 0.008, 0.0);
    shin.add(foot);
    thigh.add(shin);
    this.pelvis.add(thigh);

    return { thigh, shin, hip: 0, knee: 0 };
  }

  private armOf(side: Side): Arm {
    return side === 'left' ? this.arms.left : this.arms.right;
  }

  setUpperBodyFromPose(
    posePrev: Float32Array,
    pose: Float32Array,
    alpha: number,
    aspect: number,
  ): void {
    const iL = PoseIndex.LEFT_SHOULDER;
    const iR = PoseIndex.RIGHT_SHOULDER;
    this.sample(posePrev, pose, iL, alpha, 0);
    this.sample(posePrev, pose, iR, alpha, 1);
    const shoulderVisible =
      pose[iL * POSE_STRIDE + 3]! >= VIS_MIN && pose[iR * POSE_STRIDE + 3]! >= VIS_MIN;
    const swx = (this.lx[1]! - this.lx[0]!) * aspect;
    const swy = this.ly[1]! - this.ly[0]!;
    const sw2 = Math.sqrt(swx * swx + swy * swy);

    // Torso lean from hips.
    if (shoulderVisible && sw2 > 1e-4) {
      const hl = PoseIndex.LEFT_HIP;
      const hr = PoseIndex.RIGHT_HIP;
      if (pose[hl * POSE_STRIDE + 3]! >= VIS_MIN && pose[hr * POSE_STRIDE + 3]! >= VIS_MIN) {
        this.sample(posePrev, pose, hl, alpha, 4);
        this.sample(posePrev, pose, hr, alpha, 5);
        const dx = ((this.lx[0]! + this.lx[1]!) / 2 - (this.lx[4]! + this.lx[5]!) / 2) * aspect;
        const dy = (this.ly[4]! + this.ly[5]!) / 2 - (this.ly[0]! + this.ly[1]!) / 2;
        if (dy > 1e-4) {
          const a = Math.atan2(dx, dy);
          this.leanTarget = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, a));
        }
      }
    }

    this.driveArm(this.arms.left, posePrev, pose, alpha, aspect, shoulderVisible ? sw2 : 0);
    this.driveArm(this.arms.right, posePrev, pose, alpha, aspect, shoulderVisible ? sw2 : 0);
  }

  private sample(
    prev: Float32Array,
    cur: Float32Array,
    idx: number,
    alpha: number,
    slot: number,
  ): void {
    const o = idx * POSE_STRIDE;
    const px = prev[o]!;
    const py = prev[o + 1]!;
    this.lx[slot] = px + (cur[o]! - px) * alpha;
    this.ly[slot] = py + (cur[o + 1]! - py) * alpha;
  }

  private driveArm(
    arm: Arm,
    prev: Float32Array,
    cur: Float32Array,
    alpha: number,
    aspect: number,
    sw2: number,
  ): void {
    if (arm.mode === 'proc') return;
    const vis = Math.min(
      cur[arm.iS * POSE_STRIDE + 3]!,
      cur[arm.iE * POSE_STRIDE + 3]!,
      cur[arm.iW * POSE_STRIDE + 3]!,
    );
    if (sw2 < 1e-4 || !(vis >= VIS_MIN)) {
      arm.mode = 'rest';
      return;
    }
    this.sample(prev, cur, arm.iS, alpha, 0);
    this.sample(prev, cur, arm.iE, alpha, 2);
    this.sample(prev, cur, arm.iW, alpha, 3);
    const k = DIM.shoulderWidth / sw2;

    // Upper arm: shoulder -> elbow.
    let ex = (this.lx[2]! - this.lx[0]!) * aspect * k;
    let ey = -(this.ly[2]! - this.ly[0]!) * k;
    let d = Math.sqrt(ex * ex + ey * ey);
    if (d > DIM.upperArm) {
      const s = DIM.upperArm / d;
      ex *= s;
      ey *= s;
      d = DIM.upperArm;
    }
    const ez = -Math.sqrt(Math.max(0, DIM.upperArm * DIM.upperArm - d * d));

    // Forearm: elbow -> wrist.
    let fx = (this.lx[3]! - this.lx[2]!) * aspect * k;
    let fy = -(this.ly[3]! - this.ly[2]!) * k;
    d = Math.sqrt(fx * fx + fy * fy);
    if (d > DIM.forearm) {
      const s = DIM.forearm / d;
      fx *= s;
      fy *= s;
      d = DIM.forearm;
    }
    const fz = -Math.sqrt(Math.max(0, DIM.forearm * DIM.forearm - d * d));

    arm.desP.set(ex, ey, ez);
    arm.desW.set(ex + fx, ey + fy, ez + fz);
    arm.mode = 'pose';
  }

  setArmTarget(
    side: Side,
    x: number,
    y: number,
    z: number,
    poleX?: number,
    poleY?: number,
    poleZ?: number,
  ): void {
    const arm = this.armOf(side);
    arm.procT.set(x, y, z);
    if (poleX !== undefined && poleY !== undefined && poleZ !== undefined) {
      arm.procP.set(poleX, poleY, poleZ);
      arm.hasProcPole = true;
    } else {
      arm.hasProcPole = false;
    }
    arm.mode = 'proc';
  }

  releaseArm(side: Side): void {
    this.armOf(side).mode = 'rest';
  }

  setMittCurl(side: Side, curl: number): void {
    this.armOf(side).curlTarget = Math.max(0, Math.min(1, curl));
  }

  setTorso(lean: number, twist = 0): void {
    this.leanTarget = lean;
    this.twistTarget = twist;
  }

  setLeg(side: Side, hipFlexion: number, kneeBend: number): void {
    const leg = this.legs[side];
    leg.hip = hipFlexion;
    leg.knee = kneeBend;
  }

  setPelvisOffset(y: number): void {
    this.pelvisOffset = y;
  }

  squash(amount: number): void {
    this.squashS = amount;
    this.squashVel[0] = 0;
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(MAX_DT, dt));
    const omega = 2 / SMOOTH_TIME;

    // Pelvis, torso.
    this.pelvis.position.y = DIM.hipHeight + this.pelvisOffset;
    this.lean = damp(this.lean, this.leanTarget, this.torsoVel, 0, omega, step);
    this.twist = damp(this.twist, this.twistTarget, this.torsoVel, 1, omega, step);
    qTwist.setFromAxisAngle(UP, this.twist);
    qLean.setFromAxisAngle(AXIS_Z, -this.lean);
    qTorso.multiplyQuaternions(qTwist, qLean);
    this.torso.quaternion.copy(qTorso);
    qInv.copy(qTorso).invert();

    this.updateArm(this.arms.left, step, omega);
    this.updateArm(this.arms.right, step, omega);

    this.legs.left.thigh.rotation.x = this.legs.left.hip;
    this.legs.left.shin.rotation.x = -this.legs.left.knee;
    this.legs.right.thigh.rotation.x = this.legs.right.hip;
    this.legs.right.shin.rotation.x = -this.legs.right.knee;

    // Squash and stretch, volume preserving.
    this.squashS = damp(this.squashS, 1, this.squashVel, 0, 2 / 0.12, step);
    const s = Math.max(0.2, this.squashS);
    const xz = 1 / Math.sqrt(s);
    this.root.scale.set(xz, s, xz);
  }

  private updateArm(arm: Arm, dt: number, omega: number): void {
    // Shoulder in rig space (needed to turn procedural absolute targets into offsets).
    sA.copy(arm.shoulder).applyQuaternion(qTorso);
    sA.y += this.pelvis.position.y;

    let snap = false;
    if (arm.mode === 'proc') {
      arm.desW.copy(arm.procT).sub(sA);
      if (arm.hasProcPole) {
        arm.desP.copy(arm.procP).sub(sA);
      } else {
        arm.desP.set(arm.sign * 0.2, -0.5, 0.1);
      }
      snap = true;
    } else if (arm.mode === 'rest') {
      arm.desW.copy(arm.restW);
      arm.desP.copy(arm.restP);
    }

    if (snap) {
      arm.sW.copy(arm.desW);
      arm.sP.copy(arm.desP);
      arm.vel.fill(0);
    } else {
      const v = arm.vel;
      arm.sW.x = damp(arm.sW.x, arm.desW.x, v, 0, omega, dt);
      arm.sW.y = damp(arm.sW.y, arm.desW.y, v, 1, omega, dt);
      arm.sW.z = damp(arm.sW.z, arm.desW.z, v, 2, omega, dt);
      arm.sP.x = damp(arm.sP.x, arm.desP.x, v, 3, omega, dt);
      arm.sP.y = damp(arm.sP.y, arm.desP.y, v, 4, omega, dt);
      arm.sP.z = damp(arm.sP.z, arm.desP.z, v, 5, omega, dt);
    }

    // Into torso-local space, solve, pose the bones.
    sB.copy(arm.sW).applyQuaternion(qInv).add(arm.shoulder);
    sC.copy(arm.sP).applyQuaternion(qInv).add(arm.shoulder);
    solveTwoBone(arm.shoulder, sB, sC, DIM.upperArm, DIM.forearm, sMid, sEnd);

    arm.upper.position.copy(arm.shoulder);
    sA.copy(sMid).sub(arm.shoulder).normalize();
    arm.upper.quaternion.setFromUnitVectors(UP, sA);

    arm.fore.position.copy(sMid);
    sA.copy(sEnd).sub(sMid).normalize();
    arm.fore.quaternion.setFromUnitVectors(UP, sA);

    arm.mitt.position.copy(sEnd);

    // Mitt curl: flat ellipsoid .. ball.
    arm.curl = damp(arm.curl, arm.curlTarget, arm.curlVel, 0, 2 / 0.05, dt);
    const c = arm.curl;
    arm.mittMesh.scale.set(
      MITT_OPEN.x + (MITT_FIST - MITT_OPEN.x) * c,
      MITT_OPEN.y + (MITT_FIST - MITT_OPEN.y) * c,
      MITT_OPEN.z + (MITT_FIST - MITT_OPEN.z) * c,
    );
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.root.removeFromParent();
  }
}
