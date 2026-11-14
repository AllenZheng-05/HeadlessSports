import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
} from 'three/webgpu';
import { disposeObjectTree, isShared, markShared } from './dispose';
import { toonMaterial } from './style/toon';

function spy(target: { addEventListener(t: 'dispose', f: () => void): void }) {
  const fn = vi.fn();
  target.addEventListener('dispose', fn);
  return fn;
}

describe('disposeObjectTree', () => {
  it('disposes each geometry exactly once, even when meshes share it', () => {
    const geo = new BoxGeometry();
    const a = new Mesh(geo, new MeshBasicMaterial());
    const b = new Mesh(geo, new MeshBasicMaterial());
    const root = new Group();
    root.add(a, b);
    const g = spy(geo);
    disposeObjectTree(root);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('dispatches the object dispose event for every object so the renderer drops its render object', () => {
    const mesh = new Mesh(new BoxGeometry(), toonMaterial(0x123456));
    const group = new Group();
    group.add(mesh);
    const m = spy(mesh);
    const gr = spy(group);
    disposeObjectTree(group);
    expect(m).toHaveBeenCalledTimes(1);
    expect(gr).toHaveBeenCalledTimes(1);
  });

  it('skips shared and cached materials and shared geometries but disposes private ones', () => {
    const cached = toonMaterial(0xabcdef);
    const own = new MeshToonMaterial();
    const sharedGeo = markShared(new BoxGeometry());
    const root = new Group();
    root.add(new Mesh(sharedGeo, cached), new Mesh(new BoxGeometry(), own));
    const c = spy(cached);
    const o = spy(own);
    const sg = spy(sharedGeo);
    disposeObjectTree(root);
    expect(isShared(cached)).toBe(true);
    expect(c).not.toHaveBeenCalled();
    expect(sg).not.toHaveBeenCalled();
    expect(o).toHaveBeenCalledTimes(1);
  });

  it('handles material arrays and instanced meshes', () => {
    const m1 = new MeshBasicMaterial();
    const m2 = new MeshBasicMaterial();
    const geo = new BoxGeometry();
    const inst = new InstancedMesh(geo, [m1, m2] as unknown as MeshBasicMaterial, 4);
    const root = new Group();
    root.add(inst);
    const im = spy(inst.instanceMatrix);
    const a = spy(m1);
    const b = spy(m2);
    const g = spy(geo);
    disposeObjectTree(root);
    expect(im).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(g).toHaveBeenCalledTimes(1);
  });
});
