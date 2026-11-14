import { ConeGeometry, InstancedMesh, Mesh, Object3D, SphereGeometry } from 'three/webgpu';
import type { RendererHandle } from '../../render/renderer';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { PALETTE } from '../../render/style/palette';
import { createFieldDayScene } from '../../render/style/scene';
import { BlobShadow } from '../../render/style/blobShadow';
import { toonMaterial } from '../../render/style/toon';
import { median } from './evaluate';

export interface RenderBenchmark {
  /** Start rendering the representative scene every animation frame. */
  start(): void;
  /** Stop and return the median frame time (ms) over frames rendered since markMeasureStart(). */
  stop(): { frameMs: number; frames: number };
  markMeasureStart(): void;
  dispose(): void;
}

const PROP_COUNT = 60;
const BALL_COUNT = 3;
const FRAME_RING = 4096;

/**
 * A representative load: Field Day scene, the athlete with moving arms, about 60 instanced toon
 * props (one InstancedMesh), a few moving balls with blob shadows. Well under 100 draw calls.
 * Frame time is the gap between animation-frame timestamps, so it reflects what the display delivers.
 */
export function createRenderBenchmark(handle: RendererHandle): RenderBenchmark {
  const field = createFieldDayScene();
  const { scene, camera } = field;

  const rig = new AvatarRig();
  scene.add(rig.root);

  const propGeo = new ConeGeometry(0.25, 0.7, 12);
  const props = new InstancedMesh(propGeo, toonMaterial(PALETTE.whistle), PROP_COUNT);
  props.frustumCulled = false;
  const dummy = new Object3D();
  for (let i = 0; i < PROP_COUNT; i++) {
    const row = Math.floor(i / 12);
    const col = i % 12;
    dummy.position.set((col - 5.5) * 1.1, 0.35, -3 - row * 1.4);
    dummy.updateMatrix();
    props.setMatrixAt(i, dummy.matrix);
  }
  props.instanceMatrix.needsUpdate = true;
  scene.add(props);

  const ballGeo = new SphereGeometry(0.15, 16, 12);
  const ballMat = toonMaterial(PALETTE.putty);
  const balls: Mesh[] = [];
  const shadows: BlobShadow[] = [];
  for (let i = 0; i < BALL_COUNT; i++) {
    const ball = new Mesh(ballGeo, ballMat);
    scene.add(ball);
    balls.push(ball);
    const shadow = new BlobShadow(0.18);
    scene.add(shadow.mesh);
    shadows.push(shadow);
  }
  const avatarShadow = new BlobShadow(0.45);
  scene.add(avatarShadow.mesh);
  avatarShadow.follow(rig.root);

  const frameTimes = new Float64Array(FRAME_RING);
  let frameCount = 0;
  let measuring = false;
  let running = false;
  let rafId = 0;
  let lastStamp = -1;
  let lastAspect = 0;

  const tick = (stamp: number): void => {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    const dt = lastStamp < 0 ? 0 : stamp - lastStamp;
    lastStamp = stamp;
    const t = stamp / 1000;

    rig.setArmTarget('left', -0.35, 1.5 + Math.sin(t * 6) * 0.25, -0.35);
    rig.setArmTarget('right', 0.35, 1.5 + Math.cos(t * 5) * 0.25, -0.35);
    rig.update(dt / 1000);
    for (let i = 0; i < BALL_COUNT; i++) {
      const phase = t * 2 + i * 2.1;
      const ball = balls[i] as Mesh;
      ball.position.set(Math.sin(phase * 0.7) * 1.5, 0.3 + Math.abs(Math.sin(phase)) * 1.2, -1.5);
      (shadows[i] as BlobShadow).follow(ball);
    }

    handle.resize();
    const canvas = handle.renderer.domElement;
    const aspect =
      canvas.clientWidth > 0 ? canvas.clientWidth / Math.max(1, canvas.clientHeight) : 16 / 9;
    if (aspect !== lastAspect) {
      lastAspect = aspect;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    handle.render(scene, camera);

    if (measuring && dt > 0 && frameCount < FRAME_RING) frameTimes[frameCount++] = dt;
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastStamp = -1;
      rafId = requestAnimationFrame(tick);
    },
    markMeasureStart() {
      frameCount = 0;
      measuring = true;
    },
    stop() {
      running = false;
      measuring = false;
      cancelAnimationFrame(rafId);
      return { frameMs: median(frameTimes, frameCount), frames: frameCount };
    },
    dispose() {
      running = false;
      cancelAnimationFrame(rafId);
      for (const s of shadows) s.dispose();
      avatarShadow.dispose();
      for (const b of balls) b.removeFromParent();
      props.removeFromParent();
      props.dispose();
      propGeo.dispose();
      ballGeo.dispose();
      rig.dispose();
      field.dispose();
    },
  };
}
