import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three/webgpu';

import { markShared } from '../dispose';

let gradient: DataTexture | null = null;
let vertexColored: MeshToonMaterial | null = null;
const cache = new Map<number, MeshToonMaterial>();
const scratchColor = new Color();

/** Shared 3-step gradient map (shadow, mid, lit) with nearest filtering for hard toon bands. */
export function toonGradientMap(): DataTexture {
  if (gradient === null) {
    const data = new Uint8Array([120, 195, 255]);
    gradient = new DataTexture(data, 3, 1, RedFormat, UnsignedByteType);
    gradient.minFilter = NearestFilter;
    gradient.magFilter = NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
    markShared(gradient);
  }
  return gradient;
}

/** Toon material, cached per colour. Do not mutate the returned material. */
export function toonMaterial(color: number): MeshToonMaterial {
  let m = cache.get(color);
  if (m === undefined) {
    m = new MeshToonMaterial({ color, gradientMap: toonGradientMap() });
    cache.set(color, markShared(m));
  }
  return m;
}

/** Shared toon material that reads flat colours from a geometry's `color` attribute. */
export function vertexColorToonMaterial(): MeshToonMaterial {
  if (vertexColored === null) {
    vertexColored = markShared(
      new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradientMap() }),
    );
  }
  return vertexColored;
}

/** Adds a flat `color` attribute (linear working space) so geometries can merge under one material. */
export function paintGeometry(geometry: BufferGeometry, color: number): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  scratchColor.setHex(color);
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = scratchColor.r;
    data[i * 3 + 1] = scratchColor.g;
    data[i * 3 + 2] = scratchColor.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(data, 3));
  return geometry;
}

/** Merge painted geometries (position, normal, color) into one non-indexed geometry. */
export function mergePainted(geometries: BufferGeometry[]): BufferGeometry {
  const parts = geometries.map((g) => (g.index !== null ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const n = g.getAttribute('position').count * 3;
    pos.set(g.getAttribute('position').array as Float32Array, o);
    nor.set(g.getAttribute('normal').array as Float32Array, o);
    col.set(g.getAttribute('color').array as Float32Array, o);
    o += n;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  for (const g of parts) g.dispose();
  return out;
}
