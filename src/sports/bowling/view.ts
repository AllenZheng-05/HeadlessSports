import {
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry, Object3D, PerspectiveCamera, Scene } from 'three/webgpu';
import { PALETTE } from '../../render/style/palette';
import { BlobShadow } from '../../render/style/blobShadow';
import { mergePainted, paintGeometry, vertexColorToonMaterial } from '../../render/style/toon';
import { HEAD_PIN_Z, LAYOUT } from './layout';
import type { BowlingBodies } from './physics';
import { Y0 } from './world';

const N = LAYOUT.pinCount;
const BALL_COLOR = 0x5a3ea6;

/** Pin silhouette, bottom to top: radius, height, colour. Duplicated heights make hard stripe edges. */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [0, 0, PALETTE.chalk],
  [0.043, 0, PALETTE.chalk],
  [0.05, 0.02, PALETTE.chalk],
  [0.06, 0.08, PALETTE.chalk],
  [0.06, 0.12, PALETTE.chalk],
  [0.052, 0.19, PALETTE.chalk],
  [0.038, 0.24, PALETTE.chalk],
  [0.032, 0.256, PALETTE.chalk],
  [0.032, 0.256, PALETTE.whistle],
  [0.029, 0.276, PALETTE.whistle],
  [0.029, 0.276, PALETTE.chalk],
  [0.029, 0.29, PALETTE.chalk],
  [0.036, 0.322, PALETTE.chalk],
  [0.04, 0.35, PALETTE.chalk],
  [0.03, 0.375, PALETTE.chalk],
  [0, 0.382, PALETTE.chalk],
];

function buildPinGeometry(): BufferGeometry {
  const points: Vector2[] = [];
  for (const [r, y] of PROFILE) points.push(new Vector2(r, y));
  const geo = new LatheGeometry(points, 14);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const c = new Color();
  const per = PROFILE.length;
  for (let i = 0; i < count; i++) {
    c.setHex((PROFILE[i % per] as readonly [number, number, number])[2]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

function buildBallGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [
    paintGeometry(new SphereGeometry(LAYOUT.ballRadius, 20, 14), BALL_COLOR),
  ];
  // Three finger holes so the spin reads.
  const holes: readonly (readonly [number, number, number])[] = [
    [0, 0.1, 0.03],
    [-0.022, 0.1, -0.025],
    [0.022, 0.1, -0.025],
  ];
  for (const [x, y, z] of holes) {
    const h = new SphereGeometry(0.016, 8, 6);
    h.translate(x, y, z);
    parts.push(paintGeometry(h, PALETTE.ink));
  }
  return mergePainted(parts);
}

/** Camera behaviours. */
export type CameraMode = 'behind' | 'follow' | 'pins';

const M = new Matrix4();
const P = new Vector3();
const Q = new Quaternion();
const S = new Vector3();
const ONE = new Vector3(1, 1, 1);
const pose = new Float64Array(7);

/** Dynamic scene objects: the ball, the ten pins, their shadows, the aim line and the camera. */
export class BowlingView {
  readonly ball: Mesh;
  private readonly pins: InstancedMesh;
  private readonly pinShadows: InstancedMesh;
  private readonly aimDots: InstancedMesh;
  private readonly ballShadow = new BlobShadow(0.13);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private lastAimX = 1e9;
  private camReady = false;
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private lookX = 0;
  private lookY = 0;
  private lookZ = 0;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    const material = vertexColorToonMaterial();

    const ballGeo = buildBallGeometry();
    this.geometries.push(ballGeo);
    this.ball = new Mesh(ballGeo, material);
    this.ball.name = 'bowling-ball';
    this.ball.frustumCulled = false;
    scene.add(this.ball);

    const pinGeo = buildPinGeometry();
    this.geometries.push(pinGeo);
    this.pins = new InstancedMesh(pinGeo, material, N);
    this.pins.name = 'bowling-pins';
    this.pins.frustumCulled = false;
    scene.add(this.pins);

    const disc = new CircleGeometry(1, 14);
    disc.rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    const shadowMat = new MeshBasicMaterial({
      color: PALETTE.ink,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(shadowMat);
    this.pinShadows = new InstancedMesh(disc, shadowMat, N);
    this.pinShadows.name = 'bowling-pin-shadows';
    this.pinShadows.frustumCulled = false;
    this.pinShadows.renderOrder = 1;
    scene.add(this.pinShadows);

    const dotMat = new MeshBasicMaterial({
      color: PALETTE.whistle,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.materials.push(dotMat);
    this.aimDots = new InstancedMesh(disc, dotMat, 14);
    this.aimDots.name = 'bowling-aim-dots';
    this.aimDots.frustumCulled = false;
    this.aimDots.renderOrder = 2;
    this.aimDots.visible = false;
    scene.add(this.aimDots);

    scene.add(this.ballShadow.mesh);
    this.hidePins();
  }

  private hidePins(): void {
    for (let i = 0; i < N; i++) {
      this.pins.setMatrixAt(i, M.makeScale(0, 0, 0));
      this.pinShadows.setMatrixAt(i, M.makeScale(0, 0, 0));
    }
    this.pins.instanceMatrix.needsUpdate = true;
    this.pinShadows.instanceMatrix.needsUpdate = true;
  }

  attachBallTo(holder: Object3D): void {
    holder.add(this.ball);
    this.ball.position.set(0, -0.1, -0.03);
    this.ball.quaternion.identity();
  }

  /** Put the ball in the scene root at a world position (rack, or the physics reads each frame). */
  placeBall(x: number, y: number, z: number): void {
    this.scene.add(this.ball);
    this.ball.position.set(x, y, z);
    this.ball.quaternion.identity();
  }

  /** Draw the physics ball (interpolated). */
  drawBall(bodies: BowlingBodies, alpha: number): void {
    if (this.ball.parent !== this.scene) this.scene.add(this.ball);
    bodies.readBall(alpha, pose);
    this.ball.position.set(pose[0] as number, (pose[1] as number) + Y0, pose[2] as number);
    this.ball.quaternion.set(
      pose[3] as number,
      pose[4] as number,
      pose[5] as number,
      pose[6] as number,
    );
  }

  followBallShadow(): void {
    this.ballShadow.follow(this.ball, Y0);
  }

  drawPins(bodies: BowlingBodies, alpha: number): void {
    for (let i = 0; i < N; i++) {
      if (!bodies.pinPresent[i]) {
        this.pins.setMatrixAt(i, M.makeScale(0, 0, 0));
        this.pinShadows.setMatrixAt(i, M.makeScale(0, 0, 0));
        continue;
      }
      bodies.readPin(i, alpha, pose);
      P.set(pose[0] as number, (pose[1] as number) + Y0, pose[2] as number);
      Q.set(pose[3] as number, pose[4] as number, pose[5] as number, pose[6] as number);
      this.pins.setMatrixAt(i, M.compose(P, Q, ONE));
      // Shadow: stays under the pin; shrinks as the pin leaves the floor.
      const lift = (pose[1] as number) > 0.03 ? 0.5 : 1;
      S.set(0.075 * lift, 1, 0.075 * lift);
      P.y = Y0 + 0.004;
      this.pinShadows.setMatrixAt(i, M.compose(P, Q.identity(), S));
    }
    this.pins.instanceMatrix.needsUpdate = true;
    this.pinShadows.instanceMatrix.needsUpdate = true;
  }

  /** Dots on the lane showing where a straight ball launched from x would roll. */
  setAim(visible: boolean, x: number): void {
    this.aimDots.visible = visible;
    if (!visible || Math.abs(x - this.lastAimX) < 1e-4) return;
    this.lastAimX = x;
    for (let i = 0; i < 14; i++) {
      P.set(x, Y0 + 0.012, LAYOUT.foulZ - 0.9 - i * 1.25);
      S.set(0.05 + i * 0.004, 1, 0.07 + i * 0.012);
      this.aimDots.setMatrixAt(i, M.compose(P, Q.identity(), S));
    }
    this.aimDots.instanceMatrix.needsUpdate = true;
  }

  /** Smoothly move the camera for a mode. Positions are scalars: nothing allocates. */
  updateCamera(
    dt: number,
    mode: CameraMode,
    bowlerX: number,
    ballX: number,
    ballZ: number,
    height: number,
    back: number,
  ): void {
    let tx: number;
    let ty: number;
    let tz: number;
    let lx: number;
    let ly: number;
    let lz: number;
    let rate: number;
    if (mode === 'behind') {
      tx = bowlerX * 0.6;
      ty = height;
      tz = back;
      lx = bowlerX * 0.5;
      ly = 0.5;
      lz = -10;
      rate = 3;
    } else if (mode === 'follow') {
      const z = Math.max(ballZ + 4.4, HEAD_PIN_Z + 5.4);
      tx = ballX * 0.5;
      ty = 1.55;
      tz = z;
      lx = ballX * 0.4;
      ly = 0.25;
      lz = Math.max(ballZ - 8, HEAD_PIN_Z - 0.8);
      rate = 4;
    } else {
      tx = 0;
      ty = 1.35;
      tz = HEAD_PIN_Z + 4.4;
      lx = 0;
      ly = 0.18;
      lz = HEAD_PIN_Z - 0.6;
      rate = 2.5;
    }
    if (!this.camReady) {
      this.camReady = true;
      this.camX = tx;
      this.camY = ty;
      this.camZ = tz;
      this.lookX = lx;
      this.lookY = ly;
      this.lookZ = lz;
    } else {
      const k = 1 - Math.exp(-rate * dt);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.camZ += (tz - this.camZ) * k;
      this.lookX += (lx - this.lookX) * k;
      this.lookY += (ly - this.lookY) * k;
      this.lookZ += (lz - this.lookZ) * k;
    }
    this.camera.position.set(this.camX, this.camY, this.camZ);
    this.camera.lookAt(this.lookX, this.lookY, this.lookZ);
  }

  dispose(): void {
    this.ball.removeFromParent();
    this.pins.removeFromParent();
    this.pinShadows.removeFromParent();
    this.aimDots.removeFromParent();
    this.ballShadow.dispose();
    this.pins.dispose();
    this.pinShadows.dispose();
    this.aimDots.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
