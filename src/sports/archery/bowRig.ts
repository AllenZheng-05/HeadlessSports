import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry, Object3D } from 'three/webgpu';
import { ACCENTS, PALETTE } from '../../render/style/palette';
import { toonMaterial } from '../../render/style/toon';

const UP = new Vector3(0, 1, 0);
const a = new Vector3();
const mid = new Vector3();
const dir = new Vector3();

const RADIUS = 1.1;
const ARC = 1.0;
const TIP_Y = RADIUS * Math.sin(ARC / 2);
const TIP_Z = RADIUS * (1 - Math.cos(ARC / 2));
/** How far the string is pulled back at full draw, and how far it follows the draw mitt's height, m. */
const MAX_PULL = 0.5;
const MAX_FOLLOW = 0.1;
const ARROW_LENGTH = 0.75;
const TWANG_S = 0.45;

/** A unit-length cylinder along +y, to be stretched between two points. */
function segment(color: number, radius: number): { mesh: Mesh; geometry: CylinderGeometry } {
  const geometry = new CylinderGeometry(radius, radius, 1, 5);
  const mesh = new Mesh(geometry, toonMaterial(color));
  return { mesh, geometry };
}

function place(mesh: Mesh, from: Vector3, to: Vector3): void {
  mid.copy(from).add(to).multiplyScalar(0.5);
  dir.copy(to).sub(from);
  const len = dir.length();
  mesh.position.copy(mid);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
  mesh.scale.set(1, Math.max(len, 1e-4), 1);
}

/**
 * The bow in the bow mitt. It faces the target (-z): a curved arc with a grip, a string from tip to
 * tip whose middle follows the draw mitt while drawing, and the nocked arrow. Everything is
 * updated in place.
 */
export class BowRig {
  readonly group = new Group();
  private readonly parent: Object3D;
  private readonly bowMitt: Object3D;
  private readonly drawMitt: Object3D;
  private readonly upper: ReturnType<typeof segment>;
  private readonly lower: ReturnType<typeof segment>;
  private readonly arrow: Mesh;
  private readonly geometries: BufferGeometry[] = [];
  private twangT = 99;
  private readonly top = new Vector3(0, TIP_Y, TIP_Z);
  private readonly bottom = new Vector3(0, -TIP_Y, TIP_Z);
  private readonly nock = new Vector3(0, 0, TIP_Z);

  constructor(
    bowMitt: Object3D,
    drawMitt: Object3D,
    arrowGeometry: BufferGeometry,
    /** Turn of the bow about the vertical, radians: shows the curve from behind the archer. */
    yaw = 0,
  ) {
    this.bowMitt = bowMitt;
    this.drawMitt = drawMitt;
    this.parent = bowMitt;
    this.group.name = 'bow';
    this.group.rotation.y = yaw;

    const limb = new TorusGeometry(RADIUS, 0.02, 6, 28, ARC);
    limb.rotateZ(-ARC / 2);
    limb.translate(-RADIUS, 0, 0);
    limb.rotateY(Math.PI / 2);
    this.geometries.push(limb);
    this.group.add(new Mesh(limb, toonMaterial(PALETTE.putty)));

    const grip = new CapsuleGeometry(0.034, 0.16, 4, 8);
    this.geometries.push(grip);
    const gripMesh = new Mesh(grip, toonMaterial(ACCENTS.archery));
    gripMesh.position.set(0, 0, -0.01);
    this.group.add(gripMesh);

    this.upper = segment(PALETTE.chalk, 0.006);
    this.lower = segment(PALETTE.chalk, 0.006);
    this.geometries.push(this.upper.geometry, this.lower.geometry);
    this.group.add(this.upper.mesh, this.lower.mesh);

    this.arrow = new Mesh(arrowGeometry, toonMaterial(PALETTE.chalk));
    this.arrow.visible = false;
    this.group.add(this.arrow);

    this.parent.add(this.group);
    this.update(0, false);
  }

  /** The string snaps straight and rings for a moment. */
  twang(): void {
    this.twangT = 0;
  }

  update(dt: number, drawing: boolean, draw = 0): void {
    this.twangT += dt;
    if (drawing) {
      // The string is pulled back toward the archer in proportion to the draw, and follows the
      // draw mitt's height a little; the arrow lies along the bow's axis, tail on the string.
      a.copy(this.drawMitt.position).sub(this.bowMitt.position);
      const dy = a.y < -MAX_FOLLOW ? -MAX_FOLLOW : a.y > MAX_FOLLOW ? MAX_FOLLOW : a.y;
      this.nock.set(0, dy, TIP_Z + MAX_PULL * draw);
      this.arrow.visible = true;
      this.arrow.quaternion.identity();
      this.arrow.position.set(0, dy, this.nock.z - ARROW_LENGTH);
    } else {
      this.arrow.visible = false;
      const k = this.twangT < TWANG_S ? Math.exp(-this.twangT * 9) * Math.cos(this.twangT * 55) : 0;
      this.nock.set(0, 0, TIP_Z + 0.06 * k);
    }
    place(this.upper.mesh, this.top, this.nock);
    place(this.lower.mesh, this.nock, this.bottom);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
  }
}
