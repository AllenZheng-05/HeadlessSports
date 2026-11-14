import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from 'three/webgpu';
import type { BufferGeometry } from 'three/webgpu';
import { PALETTE } from './palette';
import { mergePainted, paintGeometry, vertexColorToonMaterial } from './toon';

export interface FieldDayScene {
  scene: Scene;
  camera: PerspectiveCamera;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  ground: Mesh;
  dispose(): void;
}

const SKY_TOP = 0x8ccbee;
const SKY_RADIUS = 300;

/** [x, z, radiusX, height, radiusZ] hills, kept out of the play area in front of the camera. */
const HILLS: readonly (readonly [number, number, number, number, number])[] = [
  [-42, -70, 30, 7, 22],
  [10, -95, 40, 9, 26],
  [55, -75, 28, 6, 20],
  [-85, -30, 26, 6, 24],
  [90, -20, 30, 7, 22],
  [-30, -130, 50, 12, 30],
  [75, -125, 46, 10, 28],
  [-110, -90, 34, 8, 26],
];

function buildSky(): Mesh {
  const geo = new SphereGeometry(SKY_RADIUS, 24, 12);
  const pos = geo.getAttribute('position');
  const horizon = new Color(PALETTE.sky);
  const top = new Color(SKY_TOP);
  const c = new Color();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / SKY_RADIUS));
    c.copy(horizon).lerp(top, Math.pow(t, 0.7));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    fog: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = 'sky';
  return mesh;
}

function buildGround(accent: number | undefined): Mesh {
  const parts: BufferGeometry[] = [];
  const plane = new PlaneGeometry(600, 600, 1, 1);
  plane.rotateX(-Math.PI / 2);
  parts.push(paintGeometry(plane, PALETTE.turf));
  const hillColor = new Color(PALETTE.turfLight);
  if (accent !== undefined) hillColor.lerp(new Color(accent), 0.2);
  const hillHex = hillColor.getHex();
  for (const [x, z, rx, h, rz] of HILLS) {
    const hill = new SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    hill.scale(rx, h, rz);
    hill.translate(x, -0.05, z);
    parts.push(paintGeometry(hill, hillHex));
  }
  const mesh = new Mesh(mergePainted(parts), vertexColorToonMaterial());
  mesh.name = 'ground';
  return mesh;
}

/**
 * Sky gradient (inverted vertex-coloured sphere, works on both backends), fog toward the horizon
 * colour, hemisphere + one directional light, turf ground with soft rounded hills.
 * `accent` tints the distant hills slightly. `ground: false` returns an empty, unattached ground mesh.
 */
export function createFieldDayScene(options?: {
  accent?: number;
  ground?: boolean;
}): FieldDayScene {
  const scene = new Scene();
  scene.background = new Color(PALETTE.sky);
  scene.fog = new Fog(PALETTE.sky, 30, 150);

  const sky = buildSky();
  scene.add(sky);

  const hemi = new HemisphereLight(PALETTE.sky, PALETTE.turf, 1.6);
  scene.add(hemi);
  const sun = new DirectionalLight(0xfff4e0, 2.2);
  // Upper left, in front of the athlete (towards the camera at +z).
  sun.position.set(-4, 8, 5);
  scene.add(sun);

  let ground: Mesh;
  if (options?.ground === false) {
    ground = new Mesh();
    ground.name = 'ground';
  } else {
    ground = buildGround(options?.accent);
    scene.add(ground);
  }

  const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 700);
  camera.position.set(0, 1.6, 3.6);
  camera.lookAt(0, 1.0, 0);

  return {
    scene,
    camera,
    sun,
    hemi,
    ground,
    dispose() {
      sky.geometry.dispose();
      (sky.material as MeshBasicMaterial).dispose();
      ground.geometry.dispose();
      scene.remove(sky, ground, hemi, sun);
    },
  };
}
