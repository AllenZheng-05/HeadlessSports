import { WebGPURenderer } from 'three/webgpu';
import type * as THREE from 'three/webgpu';

export type RendererKind = 'webgpu' | 'webgl';

export interface RendererHandle {
  readonly renderer: THREE.WebGPURenderer;
  /** What is actually running after init. */
  readonly backend: 'webgpu' | 'webgl2';
  /** Match canvas client size * min(devicePixelRatio, 1.5). */
  resize(): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Draw calls in the last rendered frame. */
  drawCalls(): number;
  /** three's own resource counters (live object, read only). */
  memory(): { geometries: number; textures: number };
  dispose(): void;
}

const MAX_PIXEL_RATIO = 1.5;

export function rendererKindFromQuery(params: URLSearchParams): RendererKind {
  return params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  kind: RendererKind,
): Promise<RendererHandle> {
  // `forceWebGL` selects the WebGL2 backend of the same renderer, so both paths share node materials.
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: kind === 'webgl' });
  await renderer.init();
  // We call render() ourselves (no setAnimationLoop), so the per-frame stats reset is ours to do.
  renderer.info.autoReset = false;

  const backend: 'webgpu' | 'webgl2' =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? 'webgpu'
      : 'webgl2';

  let lastW = -1;
  let lastH = -1;
  let lastDpr = -1;

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (w === lastW && h === lastH && dpr === lastDpr) return;
    lastW = w;
    lastH = h;
    lastDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
  };
  resize();

  return {
    renderer,
    backend,
    resize,
    render(scene, camera) {
      renderer.info.reset();
      renderer.render(scene, camera);
    },
    drawCalls() {
      return renderer.info.render.drawCalls;
    },
    memory() {
      return renderer.info.memory;
    },
    dispose() {
      renderer.dispose();
    },
  };
}
