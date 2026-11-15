import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { climbingConfig as cfg } from './config';
import { createScreenMap, screenToWall, updateScreenMap, wallToScreen } from './screenMap';

const PLANE_Z = cfg.wallZ + 0.07;

/** The camera the sport builds: no rotation, centred on x, `camY` high, fitted to the wall span. */
function makeCamera(aspect: number, camX: number, camY: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(cfg.cameraFov, aspect, 0.1, 100);
  const dist =
    (cfg.cameraBelowM + cfg.cameraAboveM) / 2 / Math.tan((cfg.cameraFov * Math.PI) / 360);
  cam.position.set(camX, camY, cfg.wallZ + dist);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('screen map', () => {
  const holds = [
    { x: 0, y: 3 },
    { x: -0.8, y: 4.4 },
    { x: 0.7, y: 9.1 },
    { x: 0.3, y: 20.2 },
  ];

  for (const aspect of [16 / 9, 4 / 3, 21 / 9]) {
    for (const camY of [2.2, 11.5]) {
      it(`gives back the hold drawn under the pointer (aspect ${aspect.toFixed(2)}, camera y ${camY})`, () => {
        const cam = makeCamera(aspect, 0.12, camY);
        const map = createScreenMap();
        updateScreenMap(
          map,
          cam.position.x,
          cam.position.y,
          cam.position.z,
          PLANE_Z,
          cam.fov,
          cam.aspect,
        );
        const out = { x: 0, y: 0 };
        const v = new Vector3();
        let tested = 0;
        for (const h of holds) {
          // Where three.js really draws the hold (NDC to 0..1, y down).
          v.set(h.x, h.y, PLANE_Z).project(cam);
          const px = (v.x + 1) / 2;
          const py = (1 - v.y) / 2;
          if (px < 0 || px > 1 || py < 0 || py > 1) continue;
          tested++;
          screenToWall(map, px, py, out);
          expect(out.x).toBeCloseTo(h.x, 6);
          expect(out.y).toBeCloseTo(h.y, 6);
          wallToScreen(map, h.x, h.y, out);
          expect(out.x).toBeCloseTo(px, 6);
          expect(out.y).toBeCloseTo(py, 6);
        }
        expect(tested).toBeGreaterThan(0);
      });
    }
  }

  it('a screen corner maps to the visible wall corner', () => {
    const cam = makeCamera(16 / 9, 0, 5);
    const map = createScreenMap();
    updateScreenMap(map, 0, 5, cam.position.z, PLANE_Z, cam.fov, cam.aspect);
    const out = { x: 0, y: 0 };
    screenToWall(map, 1, 0, out);
    const v = new Vector3(out.x, out.y, PLANE_Z).project(cam);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(1, 6);
  });
});
