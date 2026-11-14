import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from 'three/webgpu';
import type { BufferGeometry, Scene } from 'three/webgpu';
import { ACCENTS, PALETTE } from '../../render/style/palette';
import { mergePainted, paintGeometry, vertexColorToonMaterial } from '../../render/style/toon';
import type { PitchingConfig } from './config';
import { CELLS, GRID, cellCol, cellRow } from './zone';

const DEG = Math.PI / 180;
const DIRT = 0xe9d3a5;
const DIRT_LIGHT = 0xf1e0b9;
const CHALK_Y = 0.025;
/** The pitcher stands on a mound this high, m. */
export const MOUND_HEIGHT = 0.2;

/** [x, z, radiusX, height, radiusZ]: soft hills far behind the backstop and out to the sides. */
const HILLS: readonly (readonly [number, number, number, number, number])[] = [
  [-95, -150, 40, 9, 30],
  [0, -185, 70, 13, 36],
  [100, -150, 42, 9, 30],
  [-170, -60, 36, 8, 30],
  [170, -70, 36, 8, 30],
  [-60, -230, 60, 12, 30],
  [80, -240, 60, 11, 30],
];

export interface World {
  mesh: Mesh;
  dispose(): void;
}

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

/**
 * The ball field seen from the mound: turf with mowing stripes, a sand mound with the rubber, a
 * dirt circle and an oversized home plate at the far end, chalk lines, batter's boxes and a
 * rounded backstop in the accent colour. All merged into one mesh (one draw call).
 */
export function buildWorld(scene: Scene, cfg: PitchingConfig): World {
  const parts: BufferGeometry[] = [];
  const plateZ = -cfg.plateDistance;
  const S = cfg.zoneVisualScale;

  const plane = new PlaneGeometry(600, 600, 1, 1);
  plane.rotateX(-Math.PI / 2);
  parts.push(paintGeometry(plane, PALETTE.turf));
  // Mowing stripes across the field: depth cues for the long throw.
  for (let z = -60; z < 40; z += 8) {
    const stripe = new PlaneGeometry(240, 4, 1, 1);
    parts.push(paintGeometry(flat(stripe, 0, 0.006, z - 2), PALETTE.turfLight));
  }
  const hillColor = new Color(PALETTE.turfLight).lerp(new Color(ACCENTS.pitching), 0.2).getHex();
  for (const [x, z, rx, h, rz] of HILLS) {
    const hill = new SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    hill.scale(rx, h, rz);
    hill.translate(x, -0.05, z);
    parts.push(paintGeometry(hill, hillColor));
  }

  // Mound and rubber under the pitcher.
  const moundGeo = new CylinderGeometry(1.7, 2.7, MOUND_HEIGHT, 32);
  moundGeo.translate(0, MOUND_HEIGHT / 2, 0);
  parts.push(paintGeometry(moundGeo, DIRT_LIGHT));
  parts.push(box(0.7, 0.04, 0.16, 0, MOUND_HEIGHT + 0.02, -0.55, 0, PALETTE.chalk));

  // Dirt around the plate and a home plate drawn large enough to read from the mound.
  parts.push(paintGeometry(flat(new CircleGeometry(4.2, 40), 0, 0.012, plateZ - 0.6), DIRT));
  const shape = new Shape();
  shape.moveTo(-0.215, 0.22);
  shape.lineTo(0.215, 0.22);
  shape.lineTo(0.215, 0);
  shape.lineTo(0, -0.215);
  shape.lineTo(-0.215, 0);
  shape.closePath();
  const plate = new ShapeGeometry(shape);
  plate.scale(S, S, 1);
  parts.push(paintGeometry(flat(plate, 0, 0.03, plateZ + 0.22 * S), PALETTE.chalk));

  // Batter's boxes on both sides of the plate.
  const lw = 0.07;
  for (const sg of [-1, 1]) {
    const x0 = sg * 1.35;
    const x1 = sg * 2.75;
    const z0 = plateZ - 1.4;
    const z1 = plateZ + 1.7;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    parts.push(box(Math.abs(x1 - x0), 0.02, lw, cx, CHALK_Y, z0, 0, PALETTE.chalk));
    parts.push(box(Math.abs(x1 - x0), 0.02, lw, cx, CHALK_Y, z1, 0, PALETTE.chalk));
    parts.push(box(lw, 0.02, z1 - z0, x0, CHALK_Y, cz, 0, PALETTE.chalk));
    parts.push(box(lw, 0.02, z1 - z0, x1, CHALK_Y, cz, 0, PALETTE.chalk));
  }

  // Foul lines from the plate out past the mound, toward the pitcher's side of the field.
  for (const sg of [-1, 1]) {
    const a = 45 * DEG * sg;
    const len = 60;
    parts.push(
      box(
        0.14,
        0.02,
        len,
        Math.sin(a) * (len / 2),
        CHALK_Y,
        plateZ + Math.cos(a) * (len / 2),
        a,
        PALETTE.chalk,
      ),
    );
  }

  // Backstop: a rounded wall behind the plate with a chalk rail on top.
  const r = 6.5;
  const height = 3.4;
  const step = 8;
  const chord = 2 * r * Math.sin((step / 2) * DEG) * 1.03;
  for (let d = -80; d <= 80; d += step) {
    const phi = d * DEG;
    const x = r * Math.sin(phi);
    const z = plateZ - 0.5 - r * Math.cos(phi);
    parts.push(box(chord, height, 0.3, x, height / 2, z, -phi, ACCENTS.pitching));
    parts.push(box(chord, 0.14, 0.4, x, height + 0.07, z, -phi, PALETTE.chalk));
  }

  const geometry = mergePainted(parts);
  const mesh = new Mesh(geometry, vertexColorToonMaterial());
  mesh.name = 'pitching-field';
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

/** Scored plane coordinates (metres) to the drawn plane: the zone is drawn `zoneVisualScale` larger. */
export function drawX(cfg: PitchingConfig, x: number): number {
  return x * cfg.zoneVisualScale;
}
export function drawY(cfg: PitchingConfig, y: number): number {
  return cfg.zoneDrawCentreY + (y - cfg.zoneCentreY) * cfg.zoneVisualScale;
}

export interface Zone {
  /** Light one cell (0 to 8) or none (-1). */
  setLit(cell: number): void;
  /** Gentle pulse of the lit tile, once per frame. */
  pulse(nowMs: number): void;
  /** Mark where a pitch crossed the plane (scored plane coordinates, metres). */
  addDot(x: number, y: number): void;
  clearDots(): void;
  dispose(): void;
}

/**
 * The 3x3 strike-zone grid floating over the plate: soft translucent chalk tiles (one merged
 * mesh), the lit target tile in Whistle, and an InstancedMesh of dots for where each pitch crossed.
 */
export function buildZone(scene: Scene, cfg: PitchingConfig, capacity: number): Zone {
  const plateZ = -cfg.plateDistance;
  const S = cfg.zoneVisualScale;
  const cw = (cfg.zoneWidth / GRID) * S;
  const ch = (cfg.zoneHeight / GRID) * S;
  const gap = 0.05;
  const cy = cfg.zoneDrawCentreY;

  const tileCentre = (cell: number, out: { x: number; y: number }): void => {
    out.x = (cellCol(cell) - (GRID - 1) / 2) * cw;
    out.y = cy + ((GRID - 1) / 2 - cellRow(cell)) * ch;
  };

  const tiles: BufferGeometry[] = [];
  const p = { x: 0, y: 0 };
  for (let c = 0; c < CELLS; c++) {
    tileCentre(c, p);
    const g = new PlaneGeometry(cw - gap, ch - gap);
    g.translate(p.x, p.y, plateZ);
    tiles.push(paintGeometry(g, PALETTE.chalk));
  }
  const tileGeometry = mergePainted(tiles);
  const tileMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    fog: false,
  });
  const tileMesh = new Mesh(tileGeometry, tileMaterial);
  tileMesh.name = 'strike-zone';
  tileMesh.renderOrder = 2;
  tileMesh.frustumCulled = false;
  scene.add(tileMesh);

  // Dark grid lines, so the zone reads over the pale catcher as well as over the backstop.
  const lineW = 0.04;
  const lines: BufferGeometry[] = [];
  for (let i = 0; i <= GRID; i++) {
    const vx = (i - GRID / 2) * cw;
    const v = new PlaneGeometry(lineW, ch * GRID + lineW);
    v.translate(vx, cy, plateZ + 0.005);
    lines.push(paintGeometry(v, PALETTE.ink));
    const hy = cy + (i - GRID / 2) * ch;
    const h = new PlaneGeometry(cw * GRID + lineW, lineW);
    h.translate(0, hy, plateZ + 0.005);
    lines.push(paintGeometry(h, PALETTE.ink));
  }
  const lineGeometry = mergePainted(lines);
  const lineMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: false,
  });
  const lineMesh = new Mesh(lineGeometry, lineMaterial);
  lineMesh.name = 'strike-zone-lines';
  lineMesh.renderOrder = 2;
  lineMesh.frustumCulled = false;
  scene.add(lineMesh);

  const litGeometry = new PlaneGeometry(cw - gap, ch - gap);
  const litMaterial = new MeshBasicMaterial({
    color: PALETTE.whistle,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  const lit = new Mesh(litGeometry, litMaterial);
  lit.name = 'target-cell';
  lit.renderOrder = 3;
  lit.visible = false;
  lit.frustumCulled = false;
  scene.add(lit);

  const dotGeometry = new CircleGeometry(0.075, 14);
  const dotMaterial = new MeshBasicMaterial({ color: PALETTE.ink, fog: false });
  const dots = new InstancedMesh(dotGeometry, dotMaterial, Math.max(1, capacity));
  dots.instanceMatrix.setUsage(DynamicDrawUsage);
  dots.count = 0;
  dots.renderOrder = 4;
  dots.frustumCulled = false;
  scene.add(dots);
  const m = new Matrix4();

  return {
    setLit(cell: number): void {
      if (cell < 0) {
        lit.visible = false;
        return;
      }
      tileCentre(cell, p);
      lit.position.set(p.x, p.y, plateZ + 0.01);
      lit.scale.set(1, 1, 1);
      lit.visible = true;
    },
    pulse(nowMs: number): void {
      if (!lit.visible) return;
      const k = 0.5 + 0.5 * Math.sin(nowMs * 0.006);
      litMaterial.opacity = 0.65 + 0.3 * k;
      const s = 1 + 0.04 * k;
      lit.scale.set(s, s, 1);
    },
    addDot(x: number, y: number): void {
      if (dots.count >= dots.instanceMatrix.count) return;
      m.makeTranslation(drawX(cfg, x), drawY(cfg, y), plateZ + 0.02);
      dots.setMatrixAt(dots.count, m);
      dots.count++;
      dots.instanceMatrix.needsUpdate = true;
    },
    clearDots(): void {
      dots.count = 0;
    },
    dispose(): void {
      tileMesh.removeFromParent();
      lineMesh.removeFromParent();
      lineGeometry.dispose();
      lineMaterial.dispose();
      lit.removeFromParent();
      dots.removeFromParent();
      tileGeometry.dispose();
      tileMaterial.dispose();
      litGeometry.dispose();
      litMaterial.dispose();
      dotGeometry.dispose();
      dotMaterial.dispose();
      dots.dispose();
    },
  };
}

export interface AimMarker {
  /** Move to a point on the drawn plane (scored plane coordinates, metres) and show. */
  show(x: number, y: number): void;
  hide(): void;
  readonly visible: boolean;
  dispose(): void;
}

/**
 * The live aim indicator: a white ring with a dark outline and a centre dot, one merged mesh drawn
 * on top of the zone and the catcher. Built once; moving it only sets a position.
 */
export function buildAimMarker(scene: Scene, cfg: PitchingConfig): AimMarker {
  const plateZ = -cfg.plateDistance;
  const r = 0.27;
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, z: number, color: number): void => {
    g.translate(0, 0, z);
    parts.push(paintGeometry(g, color));
  };
  add(new RingGeometry(r - 0.07, r + 0.07, 36), 0, PALETTE.ink);
  add(new RingGeometry(r - 0.035, r + 0.035, 36), 0.002, 0xffffff);
  add(new CircleGeometry(0.075, 18), 0.003, PALETTE.ink);
  add(new CircleGeometry(0.045, 18), 0.004, 0xffffff);
  for (let k = 0; k < 4; k++) {
    const tick = new PlaneGeometry(0.06, 0.16);
    tick.translate(0, r + 0.17, 0);
    tick.rotateZ((k * Math.PI) / 2);
    add(tick, 0.001, PALETTE.ink);
  }
  const geometry = mergePainted(parts);
  const material = new MeshBasicMaterial({
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'aim-marker';
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return {
    show(x: number, y: number): void {
      mesh.position.set(drawX(cfg, x), drawY(cfg, y), plateZ + 0.03);
      mesh.visible = true;
    },
    hide(): void {
      mesh.visible = false;
    },
    get visible(): boolean {
      return mesh.visible;
    },
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
