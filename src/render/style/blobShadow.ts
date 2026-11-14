import {
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three/webgpu';
import type { BufferGeometry, Object3D } from 'three/webgpu';
import { markShared } from '../dispose';
import { PALETTE } from './palette';

const MAX_HEIGHT = 6;
const scratch = new Vector3();

let sharedGeometry: BufferGeometry | null = null;
let sharedMaterial: MeshBasicMaterial | null = null;

function geometry(): BufferGeometry {
  if (sharedGeometry === null) {
    // Unit disc lying on the ground; RGBA vertex colours give a soft edge (centre opaque, rim clear).
    const g = new CircleGeometry(1, 20);
    g.rotateX(-Math.PI / 2);
    const c = new Color(PALETTE.turfShadow);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors[i * 4] = c.r;
      colors[i * 4 + 1] = c.g;
      colors[i * 4 + 2] = c.b;
      colors[i * 4 + 3] = i === 0 ? 1 : 0;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 4));
    sharedGeometry = markShared(g);
  }
  return sharedGeometry;
}

function material(): MeshBasicMaterial {
  if (sharedMaterial === null) {
    sharedMaterial = markShared(
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
  }
  return sharedMaterial;
}

/** A soft dark disc that sits just above the ground under an object. Shared geometry and material. */
export class BlobShadow {
  readonly mesh: Mesh;
  private readonly radius: number;

  constructor(radius: number) {
    this.radius = radius;
    this.mesh = new Mesh(geometry(), material());
    this.mesh.name = 'blob-shadow';
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(radius);
  }

  /**
   * Place under `target` (world position). The material is shared, so "fading" with height is done
   * by shrinking the disc and hiding it beyond MAX_HEIGHT metres.
   */
  follow(target: Object3D, groundY = 0): void {
    target.getWorldPosition(scratch);
    const h = Math.max(0, scratch.y - groundY);
    const k = Math.max(0, 1 - h / MAX_HEIGHT);
    const s = this.radius * k * k * (1 / (1 + h * 0.25));
    this.mesh.visible = s > 0.005;
    this.mesh.position.set(scratch.x, groundY + 0.012, scratch.z);
    this.mesh.scale.setScalar(s);
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
