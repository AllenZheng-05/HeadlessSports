import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from 'three/webgpu';
import type { BufferGeometry, Scene } from 'three/webgpu';
import { ACCENTS, PALETTE } from '../../render/style/palette';
import { mergePainted, paintGeometry, vertexColorToonMaterial } from '../../render/style/toon';
import type { BattingConfig } from './config';

/** Infield dirt and the pitcher's mound. A warm sand, not in the shared palette. */
export const DIRT = 0xe9d3a5;
const DIRT_LIGHT = 0xf1e0b9;
const DEG = Math.PI / 180;
const FENCE_SPAN_DEG = 48;
const FENCE_STEP_DEG = 4;
const CHALK_Y = 0.025;
const M_PER_FT = 0.3048;
/** Distance boards and arcs, in feet from the plate (the fence is at 350). */
const BOARD_FEET: readonly number[] = [100, 200, 300];

/** [x, z, radiusX, height, radiusZ]: soft hills, all beyond the fence so the whole fence shows. */
const HILLS: readonly (readonly [number, number, number, number, number])[] = [
  [-95, -150, 40, 9, 30],
  [0, -185, 70, 13, 36],
  [100, -150, 42, 9, 30],
  [-170, -70, 36, 8, 30],
  [170, -80, 36, 8, 30],
  [-60, -230, 60, 12, 30],
  [80, -240, 60, 11, 30],
];

export interface World {
  /** One merged mesh holding every static prop. */
  mesh: Mesh;
  dispose(): void;
}

/** A flat shape on the ground, rotated into the xz plane (shape +y points toward -z). */
function flat(g: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  color: number,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.rotateY(rotY);
  g.translate(x, y, z);
  return paintGeometry(g, color);
}

/** A chalk arc on the ground: heading -span..+span degrees at radius r. */
function arc(r: number, spanDeg: number, width: number, color: number): BufferGeometry {
  const g = new RingGeometry(
    r - width / 2,
    r + width / 2,
    72,
    1,
    (90 - spanDeg) * DEG,
    2 * spanDeg * DEG,
  );
  return paintGeometry(flat(g, 0, CHALK_Y, 0), color);
}

/**
 * The ball field, in the Field Day style: dirt and chalk at the plate, a mound 14 m away, chalk
 * foul lines and distance arcs, a low outfield fence in the accent colour at the home-run distance.
 * Everything is merged into one mesh (one draw call).
 */
export function buildWorld(scene: Scene, cfg: BattingConfig, batterX: number): World {
  const parts: BufferGeometry[] = [];
  const plateZ = cfg.plateZ;
  const fenceR = cfg.fenceDistance;
  const mound = -cfg.moundDistance;

  // Own turf and hills (the shared ground has hills inside the fence, which would hide it).
  const plane = new PlaneGeometry(600, 600, 1, 1);
  plane.rotateX(-Math.PI / 2);
  parts.push(paintGeometry(plane, PALETTE.turf));
  const hillColor = new Color(PALETTE.turfLight).lerp(new Color(ACCENTS.batting), 0.2).getHex();
  for (const [x, z, rx, h, rz] of HILLS) {
    const hill = new SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    hill.scale(rx, h, rz);
    hill.translate(x, -0.05, z);
    parts.push(paintGeometry(hill, hillColor));
  }

  // Dirt at the plate and under the batter.
  parts.push(paintGeometry(flat(new CircleGeometry(2.8, 36), 0, 0.012, -0.3), DIRT));

  // Home plate: a pentagon whose flat edge faces the pitcher.
  const shape = new Shape();
  shape.moveTo(-0.215, 0.22);
  shape.lineTo(0.215, 0.22);
  shape.lineTo(0.215, 0);
  shape.lineTo(0, -0.215);
  shape.lineTo(-0.215, 0);
  shape.closePath();
  parts.push(paintGeometry(flat(new ShapeGeometry(shape), 0, 0.03, plateZ + 0.22), PALETTE.chalk));

  // The batter's boxes, one each side of the plate: 1.2 m wide and 1.8 m long, centred on the plate,
  // the batter's own side being the one the batter stands in.
  const boxZ = plateZ + 0.22;
  const bz0 = boxZ - 0.9;
  const bz1 = boxZ + 0.9;
  const lw = 0.06;
  const bd = bz1 - bz0;
  const cz = (bz0 + bz1) / 2;
  for (const bxc of [batterX, -batterX]) {
    const bx0 = bxc - 0.6;
    const bx1 = bxc + 0.6;
    const bw = bx1 - bx0;
    const cx = (bx0 + bx1) / 2;
    parts.push(box(bw, 0.02, lw, cx, CHALK_Y, bz0, 0, PALETTE.chalk));
    parts.push(box(bw, 0.02, lw, cx, CHALK_Y, bz1, 0, PALETTE.chalk));
    parts.push(box(lw, 0.02, bd, bx0, CHALK_Y, cz, 0, PALETTE.chalk));
    parts.push(box(lw, 0.02, bd, bx1, CHALK_Y, cz, 0, PALETTE.chalk));
  }

  // Mound with the pitcher's rubber.
  const moundGeo = new CylinderGeometry(1.5, 2.4, 0.2, 28);
  moundGeo.translate(0, 0.1, mound);
  parts.push(paintGeometry(moundGeo, DIRT_LIGHT));
  parts.push(box(0.62, 0.04, 0.14, 0, 0.22, mound, 0, PALETTE.chalk));

  // Foul lines, distance arcs and the fence.
  for (const sgn of [-1, 1]) {
    const a = 45 * DEG * sgn;
    const len = fenceR * 1.02;
    parts.push(
      box(
        0.12,
        0.02,
        len,
        (Math.sin(a) * len) / 2,
        CHALK_Y,
        plateZ - (Math.cos(a) * len) / 2,
        -a,
        PALETTE.chalk,
      ),
    );
  }
  parts.push(arc(BOARD_FEET[0]! * M_PER_FT, 45, 0.18, PALETTE.chalk));
  parts.push(arc(BOARD_FEET[1]! * M_PER_FT, 45, 0.18, PALETTE.chalk));

  const chord = 2 * fenceR * Math.sin((FENCE_STEP_DEG / 2) * DEG) * 1.02;
  for (let d = -FENCE_SPAN_DEG; d <= FENCE_SPAN_DEG; d += FENCE_STEP_DEG) {
    const phi = d * DEG;
    const x = fenceR * Math.sin(phi);
    const z = plateZ - fenceR * Math.cos(phi);
    parts.push(box(chord, cfg.fenceHeight, 0.35, x, cfg.fenceHeight / 2, z, -phi, ACCENTS.batting));
    parts.push(box(chord, 0.12, 0.45, x, cfg.fenceHeight + 0.06, z, -phi, PALETTE.chalk));
  }

  // Distance boards at 100, 200 and 300 ft: one, two and three chalk dots.
  const boardHeading = 28 * DEG;
  BOARD_FEET.forEach((feet, i) => {
    const dist = feet * M_PER_FT;
    for (const sgn of [-1, 1]) {
      const phi = boardHeading * sgn;
      const x = dist * Math.sin(phi);
      const z = plateZ - dist * Math.cos(phi);
      const poleH = 2.0 + (i === BOARD_FEET.length - 1 ? 0.8 : 0);
      parts.push(box(0.1, poleH, 0.1, x, poleH / 2, z, 0, PALETTE.chalk));
      parts.push(box(0.9, 0.9, 0.12, x, poleH + 0.25, z, -phi, ACCENTS.batting));
      for (let k = 0; k <= i; k++) {
        parts.push(
          box(
            0.17,
            0.17,
            0.06,
            x + (k - i / 2) * 0.24 * Math.cos(phi) - 0.08 * Math.sin(phi),
            poleH + 0.25,
            z + (k - i / 2) * 0.24 * Math.sin(phi) + 0.08 * Math.cos(phi),
            -phi,
            PALETTE.chalk,
          ),
        );
      }
    }
  });

  const geometry = mergePainted(parts);
  const mesh = new Mesh(geometry, vertexColorToonMaterial());
  mesh.name = 'batting-field';
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh,
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
    },
  };
}
