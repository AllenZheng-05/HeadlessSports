import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry, Scene } from 'three/webgpu';
import { ACCENTS, PALETTE } from '../../render/style/palette';
import {
  mergePainted,
  paintGeometry,
  toonMaterial,
  vertexColorToonMaterial,
} from '../../render/style/toon';
import type { ArcheryConfig } from './config';
import { RING_COLORS, ringWidth } from './target';

const UP = new Vector3(0, 1, 0);
const NEG_Z = new Vector3(0, 0, -1);
const tmpObj = new Object3D();
const tmpQ = new Quaternion();
const tmpM = new Matrix4();
const tmpV = new Vector3();
const tmpD = new Vector3();
const tmpScale = new Vector3();
const tmpColor = new Color();

const STRAW = 0xe9c46a;
const HEDGE = 0x6fbf7a;
const HEDGE_LIGHT = 0x84cf8c;
const HEDGE_DARK = 0x4f9f69;
const WOOD = 0xc9a27a;
/** Stuck arrows a normal round can hold; a pass-and-play game passes its own total. */
const STUCK_CAPACITY = 12;
/** The shooter's colour bead on a stuck arrow's tail, m. */
const BEAD_RADIUS = 0.055;
const ARROW_LENGTH = 0.75;
/** How far a stuck arrow's tip sits behind the face, m. */
const EMBED = 0.12;

/** Place a geometry (position, rotation, scale) and paint it one flat colour. */
function part(
  geo: BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): BufferGeometry {
  tmpObj.position.set(x, y, z);
  tmpObj.rotation.set(rx, ry, rz);
  tmpObj.scale.set(sx, sy, sz);
  tmpObj.updateMatrix();
  geo.applyMatrix4(tmpObj.matrix);
  return paintGeometry(geo, color);
}

/** A cylinder from point a to point b. */
function rod(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  color: number,
): BufferGeometry {
  tmpV.set(bx - ax, by - ay, bz - az);
  const len = tmpV.length();
  const geo = new CylinderGeometry(radius, radius, len, 6);
  tmpQ.setFromUnitVectors(UP, tmpV.multiplyScalar(1 / len));
  tmpM.compose(tmpD.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), tmpQ, new Vector3(1, 1, 1));
  geo.applyMatrix4(tmpM);
  return paintGeometry(geo, color);
}

/** The arrow along -z: tip at the origin, tail at +z, painted. */
export function createArrowGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const tipLen = 0.09;
  const tip = new ConeGeometry(0.022, tipLen, 6);
  tip.rotateX(-Math.PI / 2);
  tip.translate(0, 0, tipLen / 2);
  parts.push(paintGeometry(tip, PALETTE.ink2));
  const shaftLen = ARROW_LENGTH - tipLen;
  const shaft = new CylinderGeometry(0.012, 0.012, shaftLen, 6);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, tipLen + shaftLen / 2);
  parts.push(paintGeometry(shaft, 0xd9b98a));
  for (let i = 0; i < 3; i++) {
    const vane = new BoxGeometry(0.006, 0.07, 0.16);
    vane.rotateZ((i * Math.PI) / 3);
    vane.translate(0, 0, ARROW_LENGTH - 0.1);
    parts.push(paintGeometry(vane, i === 0 ? PALETTE.whistle : PALETTE.chalk));
  }
  return mergePainted(parts);
}

export interface ArcheryWorld {
  /** The arrow in flight (hidden until `showFlying`). */
  readonly flying: Mesh;
  readonly arrowGeometry: BufferGeometry;
  /** Reticle on the target plane. */
  setReticle(visible: boolean, x: number, y: number, radius: number): void;
  setFlag(wind: number, t: number): void;
  /** Orient and place the flying arrow from its tip and velocity. */
  showFlying(x: number, y: number, z: number, vx: number, vy: number, vz: number): void;
  hideFlying(): void;
  /**
   * Leave an arrow stuck with its tip at (x, y, z), flying along (dx, dy, dz). With `color` (a
   * pass-and-play game) the arrow's tail carries a bead in the shooter's colour.
   */
  addStuck(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    color?: number,
  ): void;
  dispose(): void;
}

/**
 * The range: striped lane, chalk line, hedges and trees, the ringed target on a tripod in front of
 * a hedge backstop, the wind flag. Static parts are merged into one mesh.
 */
export function createWorld(
  scene: Scene,
  cfg: ArcheryConfig,
  capacity: number = STUCK_CAPACITY,
): ArcheryWorld {
  const stuckCapacity = Math.max(STUCK_CAPACITY, Math.floor(capacity));
  const D = cfg.targetDistance;
  const th = cfg.targetHeight;
  const parts: BufferGeometry[] = [];

  // Lane: mown stripes along the shooting direction.
  const laneW = 7;
  const laneFront = 5;
  const laneBack = D + 6;
  const stripeLen = 3;
  const stripes = Math.ceil((laneFront + laneBack) / stripeLen);
  for (let i = 0; i < stripes; i++) {
    const z0 = laneFront - i * stripeLen;
    const g = new PlaneGeometry(laneW, stripeLen, 1, 1);
    parts.push(
      part(
        g,
        i % 2 === 0 ? PALETTE.turfLight : 0x9bdba0,
        0,
        0.012,
        z0 - stripeLen / 2,
        -Math.PI / 2,
      ),
    );
  }
  // Chalk shooting line and a short marker at each side.
  parts.push(
    part(new PlaneGeometry(laneW, 0.1, 1, 1), PALETTE.chalk, 0, 0.02, -0.45, -Math.PI / 2),
  );

  // Hedges along both sides (soft rounded blobs), and trees beyond them.
  const hedgeEnd = -(D + 5);
  let n = 0;
  for (let z = 4; z > hedgeEnd; z -= 2.4) {
    for (const sx of [-1, 1]) {
      const color = n % 3 === 0 ? HEDGE_LIGHT : n % 3 === 1 ? HEDGE : HEDGE_DARK;
      parts.push(
        part(new SphereGeometry(1, 10, 7), color, sx * 3.7, 0.35, z, 0, 0, 0, 0.75, 0.55, 1.35),
      );
    }
    n++;
  }
  const treeColors = [0x77c98a, 0x8bd69a, 0x6fbf93];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (7 + ((i * 37) % 9));
    const z = 3 - ((i * 4.9) % (D + 10));
    const h = 1.6 + ((i * 13) % 5) * 0.35;
    parts.push(part(new CylinderGeometry(0.14, 0.2, h, 6), 0xb98f6a, x, h / 2, z));
    parts.push(
      part(
        new SphereGeometry(1, 10, 8),
        treeColors[i % 3]!,
        x,
        h + 0.9,
        z,
        0,
        0,
        0,
        1.1,
        1.25,
        1.1,
      ),
    );
  }

  // Backstop: a hedge wall behind the target (dark, so the face reads against it).
  parts.push(part(new BoxGeometry(9, 2.8, 0.9), HEDGE_DARK, 0, 1.4, -D - 1.9));
  parts.push(
    part(new SphereGeometry(1, 12, 8), HEDGE, -4.5, 1.4, -D - 1.9, 0, 0, 0, 0.6, 1.4, 0.6),
  );
  parts.push(part(new SphereGeometry(1, 12, 8), HEDGE, 4.5, 1.4, -D - 1.9, 0, 0, 0, 0.6, 1.4, 0.6));

  // Hay bales either side of the target.
  for (const sx of [-1, 1]) {
    parts.push(
      part(new BoxGeometry(1.0, 0.5, 0.5), STRAW, sx * 2.1, 0.25, -D + 0.6, 0, sx * 0.2, 0),
    );
    parts.push(
      part(new BoxGeometry(1.0, 0.5, 0.5), 0xdfb95c, sx * 2.0, 0.75, -D + 0.5, 0, sx * -0.15, 0),
    );
  }

  // Target: tripod, straw boss, ten rings.
  const faceZ = -D;
  const bossR = cfg.targetRadius * 1.28;
  parts.push(
    part(new CylinderGeometry(bossR, bossR, 0.22, 28), STRAW, 0, th, faceZ - 0.13, Math.PI / 2),
  );
  parts.push(rod(-0.5, 0, faceZ - 1.05, 0, th - 0.4, faceZ - 0.2, 0.035, WOOD));
  parts.push(rod(0.5, 0, faceZ - 1.05, 0, th - 0.4, faceZ - 0.2, 0.035, WOOD));
  parts.push(rod(0, 0, faceZ + 0.55, 0, th - 0.4, faceZ - 0.2, 0.035, WOOD));
  const w = ringWidth(cfg.targetRadius);
  for (let k = 1; k <= 10; k++) {
    const radius = (11 - k) * w;
    // Inner rings stand a hair proud so the rings never z-fight.
    parts.push(
      part(
        new CylinderGeometry(radius, radius, 0.012, 40),
        RING_COLORS[k - 1]!,
        0,
        th,
        faceZ + 0.01 + k * 0.007,
        Math.PI / 2,
      ),
    );
  }

  // Wind flag on a pole near the target.
  const poleX = 2.6;
  const poleZ = faceZ + 0.2;
  parts.push(part(new CylinderGeometry(0.035, 0.045, 3.4, 6), PALETTE.chalk, poleX, 1.7, poleZ));
  parts.push(part(new SphereGeometry(0.07, 8, 6), ACCENTS.archery, poleX, 3.42, poleZ));

  const staticMesh = new Mesh(mergePainted(parts), vertexColorToonMaterial());
  staticMesh.name = 'archery-range';
  scene.add(staticMesh);

  const flag = new Group();
  flag.position.set(poleX, 3.15, poleZ);
  const flagGeo = new BoxGeometry(1.1, 0.6, 0.03);
  flagGeo.translate(0.55, -0.3, 0);
  const flagMesh = new Mesh(flagGeo, toonMaterial(PALETTE.whistle));
  flag.add(flagMesh);
  scene.add(flag);

  // Arrows.
  const arrowGeometry = createArrowGeometry();
  const arrowMat = vertexColorToonMaterial();
  const flying = new Mesh(arrowGeometry, arrowMat);
  flying.visible = false;
  flying.frustumCulled = false;
  scene.add(flying);
  const stuck = new InstancedMesh(arrowGeometry, arrowMat, stuckCapacity);
  stuck.count = 0;
  stuck.frustumCulled = false;
  scene.add(stuck);
  // Colour beads on the tails: only created when an arrow is added with a colour.
  let beadGeometry: SphereGeometry | null = null;
  let beads: InstancedMesh | null = null;

  // Reticle: a ring, a dark halo and a dot, drawn on top of everything.
  const ringGeo = new RingGeometry(0.86, 1, 40);
  const haloGeo = new RingGeometry(0.76, 0.86, 40);
  const dotGeo = new CircleGeometry(1, 16);
  const ringMat = new MeshBasicMaterial({ color: PALETTE.chalk, depthTest: false, fog: false });
  const haloMat = new MeshBasicMaterial({ color: PALETTE.ink, depthTest: false, fog: false });
  const dotMat = new MeshBasicMaterial({ color: PALETTE.whistle, depthTest: false, fog: false });
  const reticle = new Group();
  const ring = new Mesh(ringGeo, ringMat);
  const halo = new Mesh(haloGeo, haloMat);
  const dot = new Mesh(dotGeo, dotMat);
  ring.renderOrder = 12;
  halo.renderOrder = 11;
  dot.renderOrder = 13;
  const dotScale = 0.09;
  dot.scale.setScalar(dotScale);
  reticle.add(halo, ring, dot);
  reticle.visible = false;
  reticle.position.z = faceZ + 0.3;
  scene.add(reticle);

  return {
    flying,
    arrowGeometry,
    setReticle(visible, x, y, radius): void {
      reticle.visible = visible;
      if (!visible) return;
      reticle.position.x = x;
      reticle.position.y = y;
      ring.scale.setScalar(radius);
      halo.scale.setScalar(radius);
    },
    setFlag(wind, t): void {
      const k = Math.min(1, Math.abs(wind) / Math.max(1e-3, cfg.maxWind));
      const dirSign = wind >= 0 ? 1 : -1;
      flag.scale.x = dirSign;
      const flutter = Math.sin(t * 7 + 1.3) * 0.08 * (0.3 + k);
      flag.rotation.z = -dirSign * (1.35 * (1 - k) + 0.12) + flutter;
    },
    showFlying(x, y, z, vx, vy, vz): void {
      flying.visible = true;
      flying.position.set(x, y, z);
      tmpD.set(vx, vy, vz).normalize();
      flying.quaternion.setFromUnitVectors(NEG_Z, tmpD);
    },
    hideFlying(): void {
      flying.visible = false;
    },
    addStuck(x, y, z, dx, dy, dz, color): void {
      if (stuck.count >= stuckCapacity) return;
      tmpD.set(dx, dy, dz).normalize();
      tmpQ.setFromUnitVectors(NEG_Z, tmpD);
      tmpV.set(x + tmpD.x * EMBED, y + tmpD.y * EMBED, z + tmpD.z * EMBED);
      tmpM.compose(tmpV, tmpQ, new Vector3(1, 1, 1));
      stuck.setMatrixAt(stuck.count, tmpM);
      if (color !== undefined) {
        if (beads === null) {
          beadGeometry = new SphereGeometry(BEAD_RADIUS, 10, 8);
          beads = new InstancedMesh(beadGeometry, toonMaterial(0xffffff), stuckCapacity);
          beads.count = 0;
          beads.frustumCulled = false;
          scene.add(beads);
        }
        // The tail is one arrow length behind the tip, back along the flight line.
        tmpV.set(x, y, z).addScaledVector(tmpD, EMBED - ARROW_LENGTH);
        tmpM.compose(tmpV, tmpQ.identity(), tmpScale.set(1, 1, 1));
        beads.setMatrixAt(beads.count, tmpM);
        beads.setColorAt(beads.count, tmpColor.setHex(color));
        beads.count++;
        beads.instanceMatrix.needsUpdate = true;
        if (beads.instanceColor) beads.instanceColor.needsUpdate = true;
      }
      stuck.count++;
      stuck.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      staticMesh.removeFromParent();
      staticMesh.geometry.dispose();
      flag.removeFromParent();
      flagGeo.dispose();
      flying.removeFromParent();
      stuck.removeFromParent();
      stuck.dispose();
      if (beads !== null) {
        beads.removeFromParent();
        beads.dispose();
      }
      beadGeometry?.dispose();
      arrowGeometry.dispose();
      reticle.removeFromParent();
      ringGeo.dispose();
      haloGeo.dispose();
      dotGeo.dispose();
      ringMat.dispose();
      haloMat.dispose();
      dotMat.dispose();
    },
  };
}
