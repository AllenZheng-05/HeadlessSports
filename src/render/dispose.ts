import type { BufferGeometry, Material, Object3D } from 'three/webgpu';

/**
 * Resources that live for the whole session (cached toon materials, the blob shadow disc, the
 * gradient map). `disposeObjectTree` never disposes them.
 */
const shared = new WeakSet<object>();

/** Mark a geometry, material or texture as session-long so tree disposal skips it. */
export function markShared<T extends object>(resource: T): T {
  shared.add(resource);
  return resource;
}

export function isShared(resource: object): boolean {
  return shared.has(resource);
}

interface Renderable extends Object3D {
  geometry?: BufferGeometry;
  material?: Material | Material[];
}

/**
 * Releases everything the renderer holds for `root` and its descendants.
 *
 * three's renderer keeps one render object per (object, material, lights) and registers listeners
 * on the object, its geometry, its material and the lights node. With session-long shared
 * materials those listeners keep every dead mesh (and its vertex buffers, pipelines and bindings)
 * reachable, so removing a mesh from the scene is not enough: the object's own `dispose` event is
 * what makes the renderer drop its render object. This dispatches it for every object, disposes
 * each geometry exactly once and each non-shared material exactly once. Safe to call twice.
 */
export function disposeObjectTree(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((object) => {
    const r = object as Renderable;
    if (r.geometry !== undefined && !shared.has(r.geometry)) geometries.add(r.geometry);
    const mat = r.material;
    if (mat !== undefined) {
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (!shared.has(m)) materials.add(m);
      }
    }
    // Mesh, InstancedMesh (also frees its matrix and colour buffers), lights, groups.
    object.dispose();
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}
