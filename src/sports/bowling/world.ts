import { BoxGeometry, CapsuleGeometry, CircleGeometry, CylinderGeometry, Mesh } from 'three/webgpu';
import type { BufferGeometry, Scene } from 'three/webgpu';
import { PALETTE } from '../../render/style/palette';
import { mergePainted, paintGeometry, vertexColorToonMaterial } from '../../render/style/toon';
import { BACK_WALL_Z, HEAD_PIN_Z, LAYOUT } from './layout';

/** Visual lift of the whole alley above the turf plane, so the two never z-fight. */
export const Y0 = 0.012;

const MAPLE_A = 0xf0d29a;
const MAPLE_B = 0xe9c487;
const APPROACH = 0xf7e6c4;
const DECK = 0xdcbf86;
const GUTTER = 0x8fa0b6;
const RAIL = PALETTE.chalk;
const BACKSTOP = 0xf5a6a0;
const FLAGS = [PALETTE.whistle, PALETTE.chalk, 0xf0d29a, 0x8ccbee, 0xb8a6e6];

const parts: BufferGeometry[] = [];

/** Box from corner ranges, painted. */
function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: number,
): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  parts.push(paintGeometry(g, color));
}

/** Where the ball rack stands for each side, and the resting height of the ball on it. */
export function rackSpot(hand: 'left' | 'right'): { x: number; y: number; z: number } {
  return { x: hand === 'right' ? 1.15 : -1.15, y: Y0 + 0.46 + LAYOUT.ballRadius, z: -0.6 };
}

/**
 * The alley, outdoors: a maple lane with chalk foul line, arrows and dots, gutters, a soft pit
 * backstop, a ball return pedestal and a little bunting. Everything is one merged mesh with
 * vertex colours (one draw call). Returns a disposer.
 */
export function buildAlley(scene: Scene, hand: 'left' | 'right'): () => void {
  parts.length = 0;
  const half = LAYOUT.laneHalf;
  const gw = LAYOUT.gutterWidth;
  const frontZ = LAYOUT.foulZ + LAYOUT.approachLength;
  const deckStart = HEAD_PIN_Z + 0.7;
  const bottom = -0.3;

  // Lane boards: 21 strips alternating two maple tones.
  const boards = 21;
  const bw = (half * 2) / boards;
  for (let i = 0; i < boards; i++) {
    box(
      -half + i * bw,
      -half + (i + 1) * bw,
      bottom,
      Y0,
      deckStart,
      LAYOUT.foulZ,
      i % 2 === 0 ? MAPLE_A : MAPLE_B,
    );
  }
  // Pin deck and approach.
  box(-half, half, bottom, Y0, BACK_WALL_Z, deckStart, DECK);
  box(-half - gw - 0.16, half + gw + 0.16, bottom, Y0, LAYOUT.foulZ, frontZ, APPROACH);
  box(-half - gw, half + gw, bottom, Y0 - LAYOUT.gutterDrop, BACK_WALL_Z, LAYOUT.foulZ, GUTTER);
  // Foul line.
  box(-half - gw, half + gw, Y0, Y0 + 0.003, LAYOUT.foulZ - 0.02, LAYOUT.foulZ + 0.03, RAIL);
  // Rails stand outside the gutters; the approach slab is as wide as the lot between them.
  for (const s of [-1, 1]) {
    const inner = s * (half + gw);
    const outer = s * (half + gw + 0.16);
    box(
      Math.min(inner, outer),
      Math.max(inner, outer),
      bottom,
      Y0 + 0.26,
      BACK_WALL_Z,
      LAYOUT.foulZ,
      RAIL,
    );
  }

  // Arrows (V of seven, 4.6 m past the foul line) and dots.
  for (let i = 0; i < 7; i++) {
    const g = new CylinderGeometry(0.045, 0.045, 0.003, 3);
    g.rotateY(Math.PI);
    const k = 3 - Math.abs(i - 3);
    g.translate((i - 3) * 0.1575, Y0 + 0.0035, LAYOUT.foulZ - 4.2 - k * 0.45);
    parts.push(paintGeometry(g, 0x9a7a45));
  }
  for (let i = 0; i < 5; i++) {
    const g = new CircleGeometry(0.014, 10);
    g.rotateX(-Math.PI / 2);
    g.translate((i - 2) * 0.21, Y0 + 0.0035, LAYOUT.foulZ - 2.1);
    parts.push(paintGeometry(g, 0x9a7a45));
  }

  // Soft backstop behind the pins.
  box(-half - gw - 0.2, half + gw + 0.2, bottom, 0.95, BACK_WALL_Z - 0.9, BACK_WALL_Z, BACKSTOP);
  {
    const cap = new CapsuleGeometry(0.32, half * 2 + gw * 2 + 0.4 - 0.64, 6, 12);
    cap.rotateZ(Math.PI / 2);
    cap.translate(0, 0.95, BACK_WALL_Z - 0.5);
    parts.push(paintGeometry(cap, 0xfab8b0));
  }

  // Ball return pedestal beside the approach.
  const rack = rackSpot(hand);
  {
    const ped = new CylinderGeometry(0.17, 0.2, 0.46, 18);
    ped.translate(rack.x, Y0 + 0.23, rack.z);
    parts.push(paintGeometry(ped, PALETTE.chalk));
    const band = new CylinderGeometry(0.205, 0.205, 0.07, 18);
    band.translate(rack.x, Y0 + 0.1, rack.z);
    parts.push(paintGeometry(band, PALETTE.whistle));
    const cup = new CylinderGeometry(0.15, 0.12, 0.04, 18);
    cup.translate(rack.x, Y0 + 0.47, rack.z);
    parts.push(paintGeometry(cup, PALETTE.whistle));
  }

  // Bunting along both sides: posts every 6 m with a string of little flags between them.
  const postX = half + gw + 1.5;
  const postH = 1.7;
  const postZ: number[] = [];
  for (let z = LAYOUT.foulZ + 2.5; z > HEAD_PIN_Z - 0.5; z -= 6) postZ.push(z);
  let flagIndex = 0;
  for (const s of [-1, 1]) {
    for (const z of postZ) {
      const post = new CapsuleGeometry(0.04, postH - 0.08, 4, 8);
      post.translate(s * postX, postH / 2, z);
      parts.push(paintGeometry(post, 0xf4e9d4));
    }
    for (let p = 0; p + 1 < postZ.length; p++) {
      const za = postZ[p] as number;
      const zb = postZ[p + 1] as number;
      const flags = 5;
      for (let f = 0; f < flags; f++) {
        const u = (f + 0.5) / flags;
        const z = za + (zb - za) * u;
        const sag = 0.22 * Math.sin(Math.PI * u);
        const y = postH - 0.06 - sag;
        const tri = new CircleGeometry(0.11, 3);
        tri.rotateZ(-Math.PI / 2);
        tri.translate(s * postX, y - 0.09, z);
        parts.push(paintGeometry(tri, FLAGS[flagIndex++ % FLAGS.length] as number));
      }
    }
  }

  const mesh = new Mesh(mergePainted(parts), vertexColorToonMaterial());
  mesh.name = 'bowling-alley';
  mesh.frustumCulled = false;
  scene.add(mesh);
  parts.length = 0;
  return () => {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  };
}
