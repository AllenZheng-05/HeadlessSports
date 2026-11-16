import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
} from 'three/webgpu';
import { ACCENTS, PALETTE } from '../../render/style/palette';
import { mergePainted, paintGeometry, vertexColorToonMaterial } from '../../render/style/toon';
import type { JavelinConfig } from './config';

/** Colours of the athletics field (soft, Field Day). */
const TRACK = 0xc0674f;
const TRACK_EDGE = 0xd9876b;
const STAND_A = 0xf6d6c8;
const STAND_B = 0xcfe5f5;
const STAND_C = 0xf8e8a8;
const POST = 0xe9e2d3;

const scratch = new Color();
const SECTOR_HALF_ANGLE = (17 * Math.PI) / 180;
const RUNWAY_HALF_WIDTH = 2;
const MAX_MARK = 100;

/** Accumulates flat, up-facing polygons into one painted geometry. */
class Flat {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly nor: number[] = [];
  private readonly color = { r: 0, g: 0, b: 0 };

  setColor(hex: number): void {
    scratch.setHex(hex);
    this.color.r = scratch.r;
    this.color.g = scratch.g;
    this.color.b = scratch.b;
  }

  private tri(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    y: number,
  ): void {
    // Make the triangle face up whatever order the corners came in.
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const ordered = cross < 0 ? [ax, az, bx, bz, cx, cz] : [ax, az, cx, cz, bx, bz];
    for (let i = 0; i < 3; i++) {
      this.pos.push(ordered[i * 2]!, y, ordered[i * 2 + 1]!);
      this.nor.push(0, 1, 0);
      this.col.push(this.color.r, this.color.g, this.color.b);
    }
  }

  quad(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.tri(x0, z0, x1, z0, x1, z1, y);
    this.tri(x0, z0, x1, z1, x0, z1, y);
  }

  /** A straight strip of width `w` from (x1,z1) to (x2,z2). */
  strip(x1: number, z1: number, x2: number, z2: number, w: number, y: number): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (w / 2);
    const nz = (dx / len) * (w / 2);
    this.tri(x1 + nx, z1 + nz, x1 - nx, z1 - nz, x2 + nx, z2 + nz, y);
    this.tri(x1 - nx, z1 - nz, x2 - nx, z2 - nz, x2 + nx, z2 + nz, y);
  }

  /** An arc of radius r around (cx, cz), opening toward -z, from -half to +half radians. */
  arc(cx: number, cz: number, r: number, half: number, w: number, y: number, segs: number): void {
    let px = cx;
    let pz = cz;
    for (let i = 0; i <= segs; i++) {
      const a = -half + (2 * half * i) / segs;
      const x = cx + r * Math.sin(a);
      const z = cz - r * Math.cos(a);
      if (i > 0) this.strip(px, pz, x, z, w, y);
      px = x;
      pz = z;
    }
  }

  /** A seven-segment digit lying on the ground, readable from +z. (ox, oz) is its bottom-left. */
  digit(d: number, ox: number, oz: number, h: number, y: number): void {
    const w = h * 0.55;
    const t = h * 0.14;
    const m = DIGIT_MASK[d]!;
    const seg = (u0: number, v0: number, u1: number, v1: number): void =>
      this.quad(ox + u0, oz - v0, ox + u1, oz - v1, y);
    if (m & 1) seg(t, h - t, w - t, h); // a
    if (m & 2) seg(w - t, h / 2, w, h); // b
    if (m & 4) seg(w - t, 0, w, h / 2); // c
    if (m & 8) seg(t, 0, w - t, t); // d
    if (m & 16) seg(0, 0, t, h / 2); // e
    if (m & 32) seg(0, h / 2, t, h); // f
    if (m & 64) seg(t, h / 2 - t / 2, w - t, h / 2 + t / 2); // g
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    return g;
  }
}

// a=1 b=2 c=4 d=8 e=16 f=32 g=64
const DIGIT_MASK = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];

function numberWidth(n: number, h: number): number {
  const digits = String(n).length;
  return digits * h * 0.55 + (digits - 1) * h * 0.2;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return paintGeometry(g, color);
}

export interface World {
  group: Group;
  dispose(): void;
}

/**
 * The athletics field. Runway along -z from z = 0 (start) to z = -runwayLength (the foul line),
 * the landing sector beyond it. One merged, vertex-coloured mesh plus the ground.
 */
export function buildWorld(cfg: JavelinConfig): World {
  const L = cfg.runwayLength;
  const flat = new Flat();

  // Runway: brick track with lighter shoulders, chalk lane edges.
  flat.setColor(TRACK_EDGE);
  flat.quad(-RUNWAY_HALF_WIDTH - 0.5, 8, RUNWAY_HALF_WIDTH + 0.5, -L - 0.5, 0.03);
  flat.setColor(TRACK);
  flat.quad(-RUNWAY_HALF_WIDTH, 8, RUNWAY_HALF_WIDTH, -L - 0.5, 0.05);
  flat.setColor(PALETTE.chalk);
  flat.strip(-RUNWAY_HALF_WIDTH, 8, -RUNWAY_HALF_WIDTH, -L, 0.12, 0.07);
  flat.strip(RUNWAY_HALF_WIDTH, 8, RUNWAY_HALF_WIDTH, -L, 0.12, 0.07);
  // Start mark and run-up ticks every 4 m.
  flat.strip(-RUNWAY_HALF_WIDTH, 0.4, RUNWAY_HALF_WIDTH, 0.4, 0.1, 0.07);
  for (let z = 4; z < L - 2; z += 4) {
    flat.strip(-0.35, -z, 0.35, -z, 0.07, 0.07);
  }

  // The foul line: a clear, wide chalk arc, plus a second thin arc for emphasis.
  const R = 14;
  const half = Math.asin(RUNWAY_HALF_WIDTH / R);
  flat.setColor(PALETTE.chalk);
  flat.arc(0, -L + R, R, half, 0.32, 0.08, 18);
  flat.setColor(ACCENTS.javelin);
  flat.arc(0, -L + R + 0.6, R, half, 0.08, 0.075, 18);
  // A straight bar across the whole runway at the line, and warning ticks in the lane before it.
  flat.setColor(PALETTE.chalk);
  flat.strip(-RUNWAY_HALF_WIDTH - 0.5, -L, RUNWAY_HALF_WIDTH + 0.5, -L, 0.5, 0.09);
  flat.setColor(ACCENTS.javelin);
  flat.strip(-RUNWAY_HALF_WIDTH - 0.5, -L + 0.45, RUNWAY_HALF_WIDTH + 0.5, -L + 0.45, 0.2, 0.09);
  for (let k = 1; k <= 3; k++) {
    flat.strip(
      -RUNWAY_HALF_WIDTH,
      -L + 0.45 + k * 1.2,
      RUNWAY_HALF_WIDTH,
      -L + 0.45 + k * 1.2,
      0.1,
      0.085,
    );
  }

  // Landing sector: lines fan out from the line centre, distance arcs every 10 m.
  flat.setColor(PALETTE.chalk);
  const far = MAX_MARK + 6;
  for (const sgn of [-1, 1]) {
    flat.strip(
      0,
      -L,
      sgn * far * Math.sin(SECTOR_HALF_ANGLE),
      -L - far * Math.cos(SECTOR_HALF_ANGLE),
      0.18,
      0.06,
    );
  }
  for (let d = 10; d <= MAX_MARK; d += 10) {
    flat.setColor(d % 50 === 0 ? ACCENTS.javelin : PALETTE.chalk);
    flat.arc(0, -L, d, SECTOR_HALF_ANGLE, d % 50 === 0 ? 0.34 : 0.16, 0.06, Math.max(8, d));
    // Numeral beside the centre line, just beyond the arc.
    const h = 1.1 + d * 0.03;
    const digits = String(d);
    const wTotal = numberWidth(d, h);
    let ox = -wTotal / 2 - 3 - d * 0.02;
    for (const ch of digits) {
      flat.digit(Number(ch), ox, -L - d - 0.6, h, 0.09);
      ox += h * 0.55 + h * 0.2;
    }
  }

  const parts: BufferGeometry[] = [flat.geometry()];

  // Turf ground, our own, so the shell's hills stay out of the sector.
  const turf = new PlaneGeometry(900, 900, 1, 1);
  turf.rotateX(-Math.PI / 2);
  parts.push(paintGeometry(turf, PALETTE.turf));
  // Mown stripes across the sector, a lighter turf.
  for (let i = 0; i < 11; i++) {
    const stripe = new PlaneGeometry(120, 10);
    stripe.rotateX(-Math.PI / 2);
    stripe.translate(0, 0.01, -L - 5 - i * 20);
    parts.push(paintGeometry(stripe, PALETTE.turfLight));
  }

  // Stands: low tiers on both sides of the sector near the line, in soft colours.
  const tiers = [STAND_A, STAND_B, STAND_C];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      parts.push(
        box(5 - k * 0.4, 0.9 + k * 0.8, 46, side * (15 + k * 2.4 + 2.5), 0, -L + 6, tiers[k]!),
      );
    }
    // Canopy post and roof over the top tier.
    parts.push(box(0.3, 3.2, 0.3, side * 24, 0, -L + 26, POST));
    parts.push(box(0.3, 3.2, 0.3, side * 24, 0, -L - 14, POST));
    parts.push(box(2.8, 0.25, 40.6, side * 23.2, 3.2, -L + 6, STAND_A));
  }
  // Back wall of the run-up.
  parts.push(box(14, 1.2, 0.6, 0, 0, 10, STAND_B));

  // Flags along the runway every 8 m, alternating colours.
  const flagColors = [ACCENTS.javelin, PALETTE.chalk, 0x9ad1f0, 0xf6d55c];
  let fi = 0;
  for (let z = 0; z >= -L; z -= 8) {
    for (const side of [-1, 1]) {
      const x = side * 3.6;
      parts.push(box(0.07, 2.4, 0.07, x, 0, z, POST));
      const flag = new ConeGeometry(0.28, 0.9, 3);
      flag.rotateZ((-side * Math.PI) / 2);
      flag.translate(x - side * 0.5, 2.0, z);
      parts.push(paintGeometry(flag, flagColors[fi++ % flagColors.length]!));
    }
  }

  // Marker posts every 10 m on both sector lines.
  for (let d = 10; d <= MAX_MARK; d += 10) {
    for (const side of [-1, 1]) {
      const x = side * d * Math.sin(SECTOR_HALF_ANGLE);
      const z = -L - d * Math.cos(SECTOR_HALF_ANGLE);
      const post = new CylinderGeometry(0.1 + d * 0.004, 0.14 + d * 0.005, 1.2 + d * 0.025, 8);
      post.translate(x, (1.2 + d * 0.025) / 2, z);
      parts.push(paintGeometry(post, d % 50 === 0 ? ACCENTS.javelin : PALETTE.chalk));
    }
  }

  // Far rolling hills and a low horizon wall of soft shapes.
  const hills: [number, number, number, number, number][] = [
    [-70, -L - 80, 36, 8, 26],
    [60, -L - 110, 44, 10, 28],
    [-20, -L - 190, 70, 16, 40],
    [-130, -L - 20, 38, 7, 30],
    [130, -L - 40, 40, 9, 30],
    [0, -L - 260, 110, 18, 40],
  ];
  for (const [x, z, rx, ry, rz] of hills) {
    const hill = new SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    hill.scale(rx, ry, rz);
    hill.translate(x, -0.05, z);
    parts.push(paintGeometry(hill, 0xa9e0ac));
  }

  const merged = mergePainted(parts);
  const mesh = new Mesh(merged, vertexColorToonMaterial());
  mesh.name = 'javelin-world';
  mesh.frustumCulled = false;
  const group = new Group();
  group.name = 'javelin-field';
  group.add(mesh);
  return {
    group,
    dispose(): void {
      group.removeFromParent();
      merged.dispose();
    },
  };
}

/** Length of the javelin, m. The origin is the grip, 40% from the tail. */
export const JAVELIN_LENGTH = 2.6;
export const JAVELIN_TIP = JAVELIN_LENGTH * 0.6;

/** A thin tapered shaft along -z: chalk shaft, accent grip, dark tip. */
export function buildJavelinGeometry(): BufferGeometry {
  const r = 0.04;
  const tail = JAVELIN_LENGTH * 0.4;
  const shaft = new CylinderGeometry(r * 0.75, r, 2.24, 8);
  // The cylinder runs along y; lay it along -z with the narrow end forward.
  shaft.rotateX(-Math.PI / 2);
  shaft.translate(0, 0, -0.08);
  paintGeometry(shaft, PALETTE.chalk);
  const grip = new CylinderGeometry(r * 1.45, r * 1.45, 0.34, 10);
  grip.rotateX(-Math.PI / 2);
  paintGeometry(grip, ACCENTS.javelin);
  const tip = new ConeGeometry(r * 0.9, 0.5, 8);
  tip.rotateX(-Math.PI / 2);
  tip.translate(0, 0, -(JAVELIN_TIP - 0.25));
  paintGeometry(tip, PALETTE.ink);
  const tailCap = new CylinderGeometry(r * 1.1, r * 1.1, 0.12, 8);
  tailCap.rotateX(-Math.PI / 2);
  tailCap.translate(0, 0, tail - 0.06);
  paintGeometry(tailCap, PALETTE.ink2);
  return mergePainted([shaft, grip, tip, tailCap]);
}

/** A flagged distance marker: post and a pennant, origin at the foot. */
export function buildMarkerGeometry(): BufferGeometry {
  const post = new CylinderGeometry(0.06, 0.08, 2.6, 8);
  post.translate(0, 1.3, 0);
  paintGeometry(post, PALETTE.chalk);
  const flag = new BoxGeometry(1.2, 0.7, 0.04);
  flag.translate(0.6, 2.25, 0);
  paintGeometry(flag, ACCENTS.javelin);
  const foot = new CylinderGeometry(0.35, 0.4, 0.12, 12);
  foot.translate(0, 0.06, 0);
  paintGeometry(foot, PALETTE.chalk);
  return mergePainted([post, flag, foot]);
}

/**
 * A small white pennant on a post, origin at the foot: the mark of a player's best throw in a
 * pass-and-play game, tinted per instance with the player's colour.
 */
export function buildSeatMarkGeometry(): BufferGeometry {
  const post = new CylinderGeometry(0.04, 0.05, 1.5, 6);
  post.translate(0, 0.75, 0);
  paintGeometry(post, 0xffffff);
  const flag = new BoxGeometry(0.7, 0.45, 0.04);
  flag.translate(0.35, 1.25, 0);
  paintGeometry(flag, 0xffffff);
  return mergePainted([post, flag]);
}
