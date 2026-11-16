import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
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
import type { ClimbingConfig } from './config';
import { KIND_CRIMP, TINT_COUNT } from './layout';
import type { Layout } from './layout';

const HOLD_POOL = 80;
const LEDGE_POOL = 3;
const MARKER_POOL = 4;
const SEAT_POOL = 3;
const SEAM_POOL = 14;
const SEAM_EVERY = 1.5;
const MARKER_EVERY = 5;
const WALL_HEIGHT = 300;
const WALL_DEPTH = 0.4;
const LIT_SCALE = 1.15;
/** Pastel jug colours, then the crimp colour. */
const JUG_COLOURS = [0xa8e0c0, 0xc5b8ee, 0xf6e0a0, 0xa8d4f0, 0xf4b6c6];
const CRIMP_COLOUR = 0x6f86a8;
const WALL_COLOUR = 0xf3e4d4;
const SEAM_COLOUR = 0xe6cdb6;
const LEDGE_COLOUR = 0xd9895f;

/**
 * The wall and everything on it. Draw calls stay constant however high the climb goes: holds,
 * ledges and seams are pooled instances that are re-laid when the camera crosses a row boundary,
 * and the number plates are a few quads whose texture is redrawn when their number changes.
 */
export class WallScene {
  readonly drawCalls: number;
  private readonly scene: Scene;
  private readonly cfg: ClimbingConfig;
  private readonly layout: Layout;
  private readonly geometries: BufferGeometry[] = [];
  private readonly meshes: Mesh[] = [];
  private readonly holds: InstancedMesh;
  private readonly ledges: InstancedMesh;
  private readonly seams: InstancedMesh;
  private readonly markers: InstancedMesh;
  private readonly seatMarks: InstancedMesh | null = null;
  private readonly plates: {
    mesh: Mesh;
    canvas: HTMLCanvasElement;
    texture: CanvasTexture;
    n: number;
  }[] = [];

  private holdLo = -1;
  private holdCount = 0;
  private lastRowLo = -1;
  private lastRowHi = -1;
  private ledgeBase = -1;
  private seamBase = -1;
  private markerBase = -1;
  /** Highlighted hold indices (hovered or held by each hand), -1 for none. */
  private readonly lit = new Int32Array([-1, -1, -1, -1]);

  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly zAxis = new Vector3(0, 0, 1);
  private readonly c = new Color();
  private readonly jugColors: Color[] = [];
  private readonly jugLit: Color[] = [];
  private readonly crimpColor = new Color(CRIMP_COLOUR);
  private readonly crimpLit = new Color();

  constructor(scene: Scene, cfg: ClimbingConfig, layout: Layout, multi = false) {
    this.scene = scene;
    this.cfg = cfg;
    this.layout = layout;
    const wallZ = cfg.wallZ;
    const half = cfg.wallWidth / 2;

    // Wall slab and side pillars in one merged, vertex-coloured mesh.
    const slab = new BoxGeometry(cfg.wallWidth, WALL_HEIGHT, WALL_DEPTH);
    slab.translate(0, WALL_HEIGHT / 2 - 0.5, wallZ - WALL_DEPTH / 2);
    const parts: BufferGeometry[] = [paintGeometry(slab, WALL_COLOUR)];
    for (const sign of [-1, 1]) {
      const pillar = new BoxGeometry(0.24, WALL_HEIGHT, 0.06);
      pillar.translate(sign * (half - 0.12), WALL_HEIGHT / 2 - 0.5, wallZ + 0.03);
      parts.push(paintGeometry(pillar, ACCENTS.climbing));
    }
    const wallGeo = mergePainted(parts);
    this.geometries.push(wallGeo);
    const wall = new Mesh(wallGeo, vertexColorToonMaterial());
    wall.name = 'climbing-wall';
    scene.add(wall);
    this.meshes.push(wall);

    // Seams.
    const seamGeo = new BoxGeometry(cfg.wallWidth - 0.5, 0.035, 0.012);
    this.geometries.push(seamGeo);
    this.seams = this.pool(seamGeo, SEAM_POOL, SEAM_COLOUR, 'wall-seams');

    // Ledges.
    const ledgeGeo = new BoxGeometry(cfg.wallWidth - 0.5, 0.14, 0.5);
    this.geometries.push(ledgeGeo);
    this.ledges = this.pool(ledgeGeo, LEDGE_POOL, LEDGE_COLOUR, 'rest-ledges');

    // Height marker chalk lines.
    const markerGeo = new BoxGeometry(cfg.wallWidth - 0.6, 0.06, 0.016);
    this.geometries.push(markerGeo);
    this.markers = this.pool(markerGeo, MARKER_POOL, PALETTE.chalk, 'height-markers');

    // Earlier climbers' best heights (multiplayer only): one coloured line each, one draw call.
    if (multi) {
      const seatGeo = new BoxGeometry(cfg.wallWidth - 1.1, 0.09, 0.02);
      this.geometries.push(seatGeo);
      const marks = this.pool(seatGeo, SEAT_POOL, 0xffffff, 'seat-marks');
      marks.instanceColor = new InstancedBufferAttribute(new Float32Array(SEAT_POOL * 3), 3);
      this.seatMarks = marks;
    }

    // Number plates.
    const plateGeo = new PlaneGeometry(0.62, 0.31);
    this.geometries.push(plateGeo);
    for (let i = 0; i < MARKER_POOL; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(plateGeo, new MeshBasicMaterial({ map: texture, transparent: true }));
      mesh.name = 'height-plate';
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.plates.push({ mesh, canvas, texture, n: -1 });
    }

    // Holds: one unit sphere, squashed per instance.
    const holdGeo = new SphereGeometry(0.5, 14, 10);
    this.geometries.push(holdGeo);
    this.holds = this.pool(holdGeo, HOLD_POOL, 0xffffff, 'holds');
    this.holds.instanceColor = new InstancedBufferAttribute(new Float32Array(HOLD_POOL * 3), 3);
    this.holds.instanceColor.setUsage(DynamicDrawUsage);
    for (let i = 0; i < TINT_COUNT; i++) {
      const base = new Color(JUG_COLOURS[i]);
      this.jugColors.push(base);
      this.jugLit.push(new Color().copy(base).lerp(new Color(0xffffff), 0.55));
    }
    this.crimpLit.copy(this.crimpColor).lerp(new Color(0xffffff), 0.45);
    this.drawCalls = 4 + this.plates.length + 1 + (multi ? 1 : 0);
  }

  private pool(geo: BufferGeometry, n: number, color: number, name: string): InstancedMesh {
    const mesh = new InstancedMesh(geo, toonMaterial(color), n);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  /** Follow the camera: re-lay pooled instances when the window crosses a boundary. */
  update(camY: number): void {
    const cfg = this.cfg;
    const lo = camY - cfg.cameraBelowM - 1;
    const hi = camY + cfg.cameraAboveM + 1;
    this.layout.ensure(hi + 1);

    const rowLo = this.layout.rowOf(lo);
    const rowHi = Math.min(this.layout.rows, this.layout.rowOf(hi) + 1);
    if (rowLo !== this.lastRowLo || rowHi !== this.lastRowHi) {
      this.lastRowLo = rowLo;
      this.lastRowHi = rowHi;
      this.holdLo = this.layout.rowStart[Math.min(rowLo, this.layout.rows)]!;
      const end = this.layout.rowStart[rowHi]!;
      this.holdCount = Math.max(0, Math.min(HOLD_POOL, end - this.holdLo));
      this.holds.count = this.holdCount;
      for (let i = 0; i < this.holdCount; i++) this.writeHold(this.holdLo + i, false);
      this.holds.instanceMatrix.needsUpdate = true;
      if (this.holds.instanceColor) this.holds.instanceColor.needsUpdate = true;
      for (const idx of this.lit) this.writeHold(idx, true);
    }

    const ledgeBase = Math.max(1, Math.floor(lo / cfg.ledgeEveryM));
    if (ledgeBase !== this.ledgeBase) {
      this.ledgeBase = ledgeBase;
      let n = 0;
      for (let i = 0; i < LEDGE_POOL; i++) {
        const y = (ledgeBase + i) * cfg.ledgeEveryM;
        this.p.set(0, y - 0.07, cfg.wallZ + 0.25);
        this.q.identity();
        this.s.set(1, 1, 1);
        this.ledges.setMatrixAt(n++, this.m.compose(this.p, this.q, this.s));
      }
      this.ledges.count = n;
      this.ledges.instanceMatrix.needsUpdate = true;
    }

    const seamBase = Math.floor(lo / SEAM_EVERY);
    if (seamBase !== this.seamBase) {
      this.seamBase = seamBase;
      for (let i = 0; i < SEAM_POOL; i++) {
        this.p.set(0, (seamBase + i) * SEAM_EVERY, cfg.wallZ + 0.006);
        this.q.identity();
        this.s.set(1, 1, 1);
        this.seams.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      }
      this.seams.count = SEAM_POOL;
      this.seams.instanceMatrix.needsUpdate = true;
    }

    const markerBase = Math.max(1, Math.floor(lo / MARKER_EVERY));
    if (markerBase !== this.markerBase) {
      this.markerBase = markerBase;
      for (let i = 0; i < MARKER_POOL; i++) {
        const n = markerBase + i;
        const y = n * MARKER_EVERY;
        this.p.set(0, y, cfg.wallZ + 0.01);
        this.q.identity();
        this.s.set(1, 1, 1);
        const slot = n % MARKER_POOL;
        this.markers.setMatrixAt(slot, this.m.compose(this.p, this.q, this.s));
        const plate = this.plates[slot]!;
        plate.mesh.position.set(-cfg.wallWidth / 2 + 0.7, y + 0.22, cfg.wallZ + 0.014);
        plate.mesh.visible = true;
        if (plate.n !== n * MARKER_EVERY) this.drawPlate(plate, n * MARKER_EVERY);
      }
      this.markers.count = MARKER_POOL;
      this.markers.instanceMatrix.needsUpdate = true;
    }
  }

  private drawPlate(
    plate: { canvas: HTMLCanvasElement; texture: CanvasTexture; n: number },
    metres: number,
  ): void {
    plate.n = metres;
    const g = plate.canvas.getContext('2d');
    if (g === null) return;
    g.clearRect(0, 0, 128, 64);
    g.fillStyle = '#fbf8f1';
    g.beginPath();
    g.roundRect(4, 6, 120, 52, 20);
    g.fill();
    g.fillStyle = '#27364a';
    g.font = '700 34px ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${metres} m`, 64, 34);
    plate.texture.needsUpdate = true;
  }

  /** Write one hold's matrix and colour if it is in the pool window. */
  private writeHold(i: number, lit: boolean): void {
    if (i < this.holdLo || i >= this.holdLo + this.holdCount) return;
    const L = this.layout;
    const slot = i - this.holdLo;
    const crimp = L.kinds[i] === KIND_CRIMP;
    const k = L.size[i]! * (lit ? LIT_SCALE : 1);
    this.p.set(L.xs[i]!, L.ys[i]!, this.cfg.wallZ + (crimp ? 0.05 : 0.07));
    this.q.setFromAxisAngle(this.zAxis, L.tilt[i]!);
    if (crimp) this.s.set(0.23 * k, 0.08 * k, 0.13 * k);
    else this.s.set(0.34 * k, 0.26 * k, 0.2 * k);
    this.holds.setMatrixAt(slot, this.m.compose(this.p, this.q, this.s));
    const color = crimp
      ? lit
        ? this.crimpLit
        : this.crimpColor
      : (lit ? this.jugLit : this.jugColors)[L.tint[i]!]!;
    this.holds.setColorAt(slot, this.c.copy(color));
  }

  /**
   * Tutorial: a finish band across the wall at height `y` (world metres) and a flag on a pole at
   * its right end. One merged mesh, so one more draw call. Call at most once.
   */
  addFinishFlag(y: number): void {
    const z = this.cfg.wallZ;
    const poleX = this.cfg.wallWidth / 2 - 0.9;
    const band = new BoxGeometry(this.cfg.wallWidth - 0.5, 0.1, 0.03);
    band.translate(0, y, z + 0.02);
    const pole = new BoxGeometry(0.07, 1.1, 0.07);
    pole.translate(poleX, y + 0.6, z + 0.05);
    const flag = new BoxGeometry(0.5, 0.32, 0.03);
    flag.translate(poleX + 0.29, y + 1.0, z + 0.05);
    const geo = mergePainted([
      paintGeometry(band, PALETTE.chalk),
      paintGeometry(pole, PALETTE.ink),
      paintGeometry(flag, PALETTE.whistle),
    ]);
    this.geometries.push(geo);
    const mesh = new Mesh(geo, vertexColorToonMaterial());
    mesh.name = 'finish-flag';
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  /**
   * Multiplayer: a coloured line across the wall at each earlier climber's best height (feet,
   * world metres). Call at a handover, not per frame. At most three; `n` 0 clears them.
   */
  setSeatMarks(heights: readonly number[], colors: readonly number[], n: number): void {
    const marks = this.seatMarks;
    if (marks === null) return;
    const count = Math.min(n, SEAT_POOL);
    for (let i = 0; i < count; i++) {
      this.p.set(0, heights[i]!, this.cfg.wallZ + 0.02);
      this.q.identity();
      this.s.set(1, 1, 1);
      marks.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      marks.setColorAt(i, this.c.setHex(colors[i]!));
    }
    marks.count = count;
    marks.instanceMatrix.needsUpdate = true;
    if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
  }

  /** Highlight up to four holds (hover and held, per hand). -1 for none. Cheap when unchanged. */
  setLit(a: number, b: number, c: number, d: number): void {
    const lit = this.lit;
    if (lit[0] === a && lit[1] === b && lit[2] === c && lit[3] === d) return;
    for (let k = 0; k < 4; k++) this.writeHold(lit[k]!, false);
    lit[0] = a;
    lit[1] = b;
    lit[2] = c;
    lit[3] = d;
    for (let k = 0; k < 4; k++) this.writeHold(lit[k]!, true);
    this.holds.instanceMatrix.needsUpdate = true;
    if (this.holds.instanceColor) this.holds.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.removeFromParent();
    for (const mesh of [this.holds, this.ledges, this.seams, this.markers]) mesh.dispose();
    this.seatMarks?.dispose();
    for (const plate of this.plates) {
      plate.texture.dispose();
      (plate.mesh.material as MeshBasicMaterial).dispose();
    }
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.meshes.length = 0;
  }
}
