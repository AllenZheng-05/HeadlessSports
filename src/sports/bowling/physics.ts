import type * as RapierTypes from '@dimforge/rapier3d-compat';
import type { BowlingConfig } from './config';
import { BACK_WALL_Z, HEAD_PIN_Z, LAYOUT, PIT_Z, rackPosition } from './layout';

/** The Rapier module namespace (after `await RAPIER.init()`). Passed in so this file stays lazy. */
export type RapierModule = typeof RapierTypes;

/** What the phase logic needs from the physics. Faked in the phase tests. */
export interface BowlingPhysics {
  /** A full fresh rack replaces every pin; otherwise fallen pins are removed and standing ones stay put. */
  rack(fresh: boolean): void;
  /** Launch a ball from the foul line at lateral position x. Replaces any ball in play. */
  launch(x: number, speed: number, angle: number, hook: number): void;
  removeBall(): void;
  /** One fixed step. */
  step(dt: number): void;
  readonly ballActive: boolean;
  readonly ballX: number;
  readonly ballY: number;
  readonly ballZ: number;
  readonly ballSpeed: number;
  /** The ball dropped into a gutter channel. */
  readonly ballInGutter: boolean;
  /** The ball went through the pins, or has stopped. */
  ballDone(): boolean;
  /** Every pin is below the slow thresholds (or asleep). */
  pinsAtRest(): boolean;
  /** Pins that are present and upright. */
  standingCount(): number;
  /** Ball speed at the first pin contact since launch; returned once, then 0. */
  takeContact(): number;
  /** The ball has touched the pins since launch. */
  readonly contacted: boolean;
  dispose(): void;
}

/** Visual access: interpolated transforms as x y z qx qy qz qw. */
export interface BowlingBodies {
  readonly pinPresent: readonly boolean[];
  readBall(alpha: number, out: Float64Array): void;
  readPin(i: number, alpha: number, out: Float64Array): void;
  pinDown(i: number): boolean;
}

const GROUP_STATIC = 1;
const GROUP_BALL = 2;
const GROUP_PIN = 4;
const groups = (member: number, filter: number): number => (member << 16) | filter;

const N = LAYOUT.pinCount;

// Pin colliders, relative to the base centre: body, neck, head.
const BODY = { hh: 0.1, r: 0.058, y: 0.1, mass: 0.72 };
const NECK = { hh: 0.07, r: 0.032, y: 0.27, mass: 0.2 };
const HEAD = { r: 0.04, y: 0.345, mass: 0.1 };

export class RapierBowling implements BowlingPhysics, BowlingBodies {
  readonly pinPresent: boolean[] = new Array<boolean>(N).fill(false);

  private readonly R: RapierModule;
  private readonly cfg: BowlingConfig;
  private world: RapierTypes.World | null;
  private ball: RapierTypes.RigidBody | null = null;
  private ballCollider: RapierTypes.Collider | null = null;
  private readonly pins: (RapierTypes.RigidBody | null)[] = new Array<RapierTypes.RigidBody | null>(
    N,
  ).fill(null);

  private readonly ballPrev = new Float64Array(7);
  private readonly ballCur = new Float64Array(7);
  private readonly pinPrev = new Float64Array(N * 7);
  private readonly pinCur = new Float64Array(N * 7);
  private readonly pinHome = new Float64Array(N * 2);

  private readonly v = { x: 0, y: 0, z: 0 };
  private readonly q = { x: 0, y: 0, z: 0, w: 1 };
  private readonly spare = { x: 0, y: 0, z: 0 };

  private hook = 0;
  private startX = 0;
  private ballTime = 0;
  private ballSpeedNow = 0;
  private inGutter = false;
  private inPit = false;
  private contactSpeed = 0;
  private restNow = true;
  private lastDt = 0;

  ballActive = false;
  ballX = 0;
  ballY = 0;
  ballZ = 0;
  contacted = false;

  constructor(R: RapierModule, cfg: BowlingConfig) {
    this.R = R;
    this.cfg = cfg;
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world = world;
    world.timestep = 1 / 120;
    world.numSolverIterations = cfg.solverIterations;
    this.buildStatic(world);
    for (let i = 0; i < N; i++) {
      const p = { x: 0, z: 0 };
      rackPosition(i, p);
      this.pinHome[i * 2] = p.x;
      this.pinHome[i * 2 + 1] = p.z;
    }
  }

  get ballSpeed(): number {
    return this.ballSpeedNow;
  }

  get ballInGutter(): boolean {
    return this.inGutter;
  }

  private static box(
    R: RapierModule,
    world: RapierTypes.World,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    friction: number,
  ): void {
    const desc = R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
      .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
      .setFriction(friction)
      .setRestitution(0.1)
      .setCollisionGroups(groups(GROUP_STATIC, GROUP_BALL | GROUP_PIN));
    world.createCollider(desc);
  }

  private buildStatic(world: RapierTypes.World): void {
    const R = this.R;
    const c = this.cfg;
    const half = LAYOUT.laneHalf;
    const gw = LAYOUT.gutterWidth;
    const zFront = LAYOUT.foulZ + LAYOUT.approachLength;
    // Approach, lane and pin deck as ONE slab (a seam between boxes catches a rolling ball).
    // The pins use the Max friction rule so they still grip it.
    RapierBowling.box(R, world, -half, half, -1, 0, BACK_WALL_Z, zFront, c.laneFriction);
    // Gutters: floors, then outer walls.
    for (const s of [-1, 1]) {
      const x0 = s > 0 ? half : -half - gw;
      RapierBowling.box(R, world, x0, x0 + gw, -1, -LAYOUT.gutterDrop, BACK_WALL_Z, zFront, 0.2);
      const w0 = s > 0 ? half + gw : -half - gw - 0.2;
      RapierBowling.box(R, world, w0, w0 + 0.2, -1, 0.5, BACK_WALL_Z, zFront, 0.2);
    }
    // Back wall.
    RapierBowling.box(
      R,
      world,
      -half - gw - 0.2,
      half + gw + 0.2,
      -1,
      2,
      BACK_WALL_Z - 0.3,
      BACK_WALL_Z,
      0.3,
    );
  }

  private requireWorld(): RapierTypes.World {
    if (this.world === null) throw new Error('BowlingPhysics used after dispose');
    return this.world;
  }

  private addPin(i: number): void {
    const R = this.R;
    const world = this.requireWorld();
    const c = this.cfg;
    const x = this.pinHome[i * 2] as number;
    const z = this.pinHome[i * 2 + 1] as number;
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.0005, z)
        .setLinearDamping(c.pinLinearDamping)
        .setAngularDamping(c.pinAngularDamping)
        .setCanSleep(true),
    );
    const g = groups(GROUP_PIN, GROUP_STATIC | GROUP_BALL | GROUP_PIN);
    const scale = c.pinMass / (BODY.mass + NECK.mass + HEAD.mass);
    const shapes = [
      R.ColliderDesc.cylinder(BODY.hh, BODY.r)
        .setTranslation(0, BODY.y, 0)
        .setMass(BODY.mass * scale),
      R.ColliderDesc.cylinder(NECK.hh, NECK.r)
        .setTranslation(0, NECK.y, 0)
        .setMass(NECK.mass * scale),
      R.ColliderDesc.ball(HEAD.r)
        .setTranslation(0, HEAD.y, 0)
        .setMass(HEAD.mass * scale),
    ];
    for (const desc of shapes) {
      desc
        .setFriction(c.pinFriction)
        .setFrictionCombineRule(R.CoefficientCombineRule.Max)
        .setRestitution(c.pinRestitution)
        .setCollisionGroups(g);
      world.createCollider(desc, body);
    }
    this.pins[i] = body;
    this.pinPresent[i] = true;
    const o = i * 7;
    for (const arr of [this.pinPrev, this.pinCur]) {
      arr[o] = x;
      arr[o + 1] = 0.0005;
      arr[o + 2] = z;
      arr[o + 3] = 0;
      arr[o + 4] = 0;
      arr[o + 5] = 0;
      arr[o + 6] = 1;
    }
  }

  private removePin(i: number): void {
    const body = this.pins[i];
    if (body) this.requireWorld().removeRigidBody(body);
    this.pins[i] = null;
    this.pinPresent[i] = false;
  }

  rack(fresh: boolean): void {
    for (let i = 0; i < N; i++) {
      if (fresh) {
        this.removePin(i);
        this.addPin(i);
      } else if (this.pinPresent[i] && this.pinDown(i)) {
        this.removePin(i);
      }
    }
    this.restNow = true;
  }

  launch(x: number, speed: number, angle: number, hook: number): void {
    const R = this.R;
    const world = this.requireWorld();
    const c = this.cfg;
    this.removeBall();
    const r = LAYOUT.ballRadius;
    const vx = speed * Math.sin(angle);
    const vz = -speed * Math.cos(angle);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, r + 0.002, LAYOUT.foulZ)
        .setLinvel(vx, 0, vz)
        .setAngvel({ x: vz / r, y: 0, z: -vx / r })
        .setCcdEnabled(true)
        .setCanSleep(true),
    );
    this.ballCollider = world.createCollider(
      R.ColliderDesc.ball(r)
        .setMass(c.ballMass)
        .setFriction(c.ballFriction)
        .setRestitution(c.ballRestitution)
        .setCollisionGroups(groups(GROUP_BALL, GROUP_STATIC | GROUP_PIN)),
      body,
    );
    this.ball = body;
    this.ballActive = true;
    this.hook = hook;
    this.startX = x;
    this.ballTime = 0;
    this.ballSpeedNow = speed;
    this.inGutter = false;
    this.inPit = false;
    this.contacted = false;
    this.contactSpeed = 0;
    this.restNow = false;
    this.ballX = x;
    this.ballY = r + 0.002;
    this.ballZ = LAYOUT.foulZ;
    for (const arr of [this.ballPrev, this.ballCur]) {
      arr[0] = x;
      arr[1] = this.ballY;
      arr[2] = LAYOUT.foulZ;
      arr[3] = 0;
      arr[4] = 0;
      arr[5] = 0;
      arr[6] = 1;
    }
  }

  removeBall(): void {
    if (this.ball !== null && this.world !== null) this.world.removeRigidBody(this.ball);
    this.ball = null;
    this.ballCollider = null;
    this.ballActive = false;
    this.ballSpeedNow = 0;
  }

  step(dt: number): void {
    const world = this.requireWorld();
    if (dt !== this.lastDt) {
      world.timestep = dt;
      this.lastDt = dt;
    }
    this.ballPrev.set(this.ballCur);
    this.pinPrev.set(this.pinCur);

    const ball = this.ball;
    if (ball !== null) {
      this.ballTime += dt;
      if (this.hook !== 0 && !this.inGutter) {
        const travelled = (LAYOUT.foulZ - this.ballZ) / LAYOUT.laneLength;
        const t = (travelled - this.cfg.hookStart) / (1 - this.cfg.hookStart);
        if (t > 0) {
          const k = t > 1 ? 1 : t * t * (3 - 2 * t);
          ball.linvel(this.v);
          this.v.x += this.hook * k * dt;
          ball.setLinvel(this.v, true);
        }
      }
    }

    world.step();

    if (ball !== null) {
      ball.translation(this.v);
      ball.rotation(this.q);
      const cur = this.ballCur;
      cur[0] = this.ballX = this.v.x;
      cur[1] = this.ballY = this.v.y;
      cur[2] = this.ballZ = this.v.z;
      cur[3] = this.q.x;
      cur[4] = this.q.y;
      cur[5] = this.q.z;
      cur[6] = this.q.w;
      ball.linvel(this.v);
      this.ballSpeedNow = Math.hypot(this.v.x, this.v.y, this.v.z);
      const col = this.ballCollider;
      if (!this.inGutter && this.ballY < LAYOUT.ballRadius - LAYOUT.gutterDrop * 0.5 && col) {
        // In the channel: it can no longer touch the pins.
        this.inGutter = true;
        col.setCollisionGroups(groups(GROUP_BALL, GROUP_STATIC));
      }
      if (!this.inPit && this.ballZ < PIT_Z) {
        this.inPit = true;
        ball.setLinearDamping(this.cfg.pitDamping);
        ball.setAngularDamping(this.cfg.pitDamping);
      }
    }

    // Pins: read the awake ones, check contact and rest.
    const slowL = this.cfg.pinSlowLinear * this.cfg.pinSlowLinear;
    const slowA = this.cfg.pinSlowAngular * this.cfg.pinSlowAngular;
    let rest = true;
    for (let i = 0; i < N; i++) {
      const body = this.pins[i];
      if (body === null || body === undefined) continue;
      if (body.isSleeping()) continue;
      body.translation(this.v);
      body.rotation(this.q);
      const o = i * 7;
      const cur = this.pinCur;
      const dx = this.v.x - (cur[o] as number);
      const dy = this.v.y - (cur[o + 1] as number);
      const dz = this.v.z - (cur[o + 2] as number);
      cur[o] = this.v.x;
      cur[o + 1] = this.v.y;
      cur[o + 2] = this.v.z;
      cur[o + 3] = this.q.x;
      cur[o + 4] = this.q.y;
      cur[o + 5] = this.q.z;
      cur[o + 6] = this.q.w;
      if (
        this.ballActive &&
        !this.contacted &&
        dx * dx + dy * dy + dz * dz > 1e-8 &&
        this.ballZ < HEAD_PIN_Z + 1.2
      ) {
        this.contacted = true;
        this.contactSpeed = Math.max(this.ballSpeedNow, 0.5);
      }
      // A pin that is already down no longer changes the score, so it may roll on without
      // holding up the verdict. A standing (or wobbling) pin must be still.
      if (this.pinDown(i)) continue;
      body.linvel(this.spare);
      if (this.spare.x ** 2 + this.spare.y ** 2 + this.spare.z ** 2 > slowL) rest = false;
      body.angvel(this.spare);
      if (this.spare.x ** 2 + this.spare.y ** 2 + this.spare.z ** 2 > slowA) rest = false;
    }
    this.restNow = rest;
  }

  ballDone(): boolean {
    if (this.ball === null) return true;
    if (this.ballZ < PIT_Z) return true;
    return this.ballTime > 0.5 && this.ballSpeedNow < 0.12;
  }

  pinsAtRest(): boolean {
    return this.restNow;
  }

  pinDown(i: number): boolean {
    if (!this.pinPresent[i]) return false;
    const o = i * 7;
    const c = this.pinCur;
    const qx = c[o + 3] as number;
    const qz = c[o + 5] as number;
    const upY = 1 - 2 * (qx * qx + qz * qz);
    const limit = Math.cos((this.cfg.downTiltDeg * Math.PI) / 180);
    const x = c[o] as number;
    const y = c[o + 1] as number;
    return upY < limit || y < -0.03 || Math.abs(x) > LAYOUT.laneHalf + 0.01;
  }

  standingCount(): number {
    let n = 0;
    for (let i = 0; i < N; i++) if (this.pinPresent[i] && !this.pinDown(i)) n++;
    return n;
  }

  takeContact(): number {
    const s = this.contactSpeed;
    this.contactSpeed = 0;
    return s;
  }

  readBall(alpha: number, out: Float64Array): void {
    lerpPose(this.ballPrev, this.ballCur, 0, alpha, out);
  }

  readPin(i: number, alpha: number, out: Float64Array): void {
    lerpPose(this.pinPrev, this.pinCur, i * 7, alpha, out);
  }

  /** Where a straight ball launched at `startX` would be (debug and tests). */
  get launchX(): number {
    return this.startX;
  }

  dispose(): void {
    if (this.world !== null) {
      this.world.free();
      this.world = null;
    }
    this.ball = null;
    this.ballCollider = null;
    this.pins.fill(null);
    this.pinPresent.fill(false);
    this.ballActive = false;
  }
}

/** Linear position, normalised-lerp rotation. */
function lerpPose(
  a: Float64Array,
  b: Float64Array,
  o: number,
  alpha: number,
  out: Float64Array,
): void {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  for (let k = 0; k < 3; k++) {
    const p = a[o + k] as number;
    out[k] = p + ((b[o + k] as number) - p) * t;
  }
  let dot = 0;
  for (let k = 3; k < 7; k++) dot += (a[o + k] as number) * (b[o + k] as number);
  const sign = dot < 0 ? -1 : 1;
  let len = 0;
  for (let k = 3; k < 7; k++) {
    const p = a[o + k] as number;
    const v = p + (sign * (b[o + k] as number) - p) * t;
    out[k] = v;
    len += v * v;
  }
  const inv = len > 0 ? 1 / Math.sqrt(len) : 1;
  for (let k = 3; k < 7; k++) out[k] = (out[k] as number) * inv;
}

export async function createRapierBowling(cfg: BowlingConfig): Promise<RapierBowling> {
  const mod = await import('@dimforge/rapier3d-compat');
  const R = mod.default as RapierModule;
  await R.init();
  return new RapierBowling(R, cfg);
}
