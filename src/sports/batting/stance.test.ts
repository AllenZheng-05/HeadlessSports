import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { battingConfig } from './config';
import { BatterPose, batterX, batterYaw, batterZ, sideSign } from './stance';

const cfg = { ...battingConfig };

describe('side placement', () => {
  it('a right-hander stands on the screen-left of the plate, a left-hander on the screen-right', () => {
    expect(batterX('right', cfg)).toBeLessThan(0);
    expect(batterX('left', cfg)).toBeGreaterThan(0);
    expect(batterX('right', cfg)).toBe(-batterX('left', cfg));
    expect(sideSign('right')).toBe(1);
    expect(sideSign('left')).toBe(-1);
  });

  it('is outside the plate but within reach of it', () => {
    expect(Math.abs(batterX('right', cfg))).toBeGreaterThan(0.215);
    expect(Math.abs(batterX('right', cfg))).toBeLessThan(1.3);
    expect(batterZ(cfg)).toBeGreaterThan(cfg.plateZ);
  });

  it('the chest faces the plate: toward +x for a right-hander, -x for a left-hander', () => {
    for (const hand of ['right', 'left'] as const) {
      const rig = new AvatarRig();
      rig.root.rotation.y = batterYaw(hand);
      rig.root.updateMatrixWorld(true);
      const fwd = new Vector3(0, 0, -1).transformDirection(rig.root.matrixWorld);
      expect(Math.sign(fwd.x)).toBe(sideSign(hand));
      expect(Math.abs(fwd.z)).toBeLessThan(1e-6);
      // The front shoulder is the one nearer the pitcher (-z): left for a right-hander.
      const left = new Vector3(-0.2, 1.3, 0).applyMatrix4(rig.root.matrixWorld);
      const right = new Vector3(0.2, 1.3, 0).applyMatrix4(rig.root.matrixWorld);
      if (hand === 'right') expect(left.z).toBeLessThan(right.z);
      else expect(right.z).toBeLessThan(left.z);
    }
  });
});

describe('batter pose', () => {
  function run(hand: 'left' | 'right', contactAt: number, height: number, at: number): Vector3[] {
    const rig = new AvatarRig();
    const pose = new BatterPose(cfg, hand);
    for (let t = 0; t <= at; t += 8) pose.update(rig, t, 0.008, contactAt, height, 0);
    return [
      new Vector3(pose.bat.x, pose.bat.y, pose.bat.z),
      new Vector3(pose.bat.dx, pose.bat.dy, pose.bat.dz),
    ];
  }

  it('the stance holds the bat up over the back shoulder', () => {
    for (const hand of ['right', 'left'] as const) {
      const [pos, dir] = run(hand, 1e9, 1, 400);
      expect(dir.y).toBeGreaterThan(0.7);
      // The back shoulder is toward the camera (+z).
      expect(dir.z).toBeGreaterThan(0);
      expect(pos.y).toBeGreaterThan(1.2);
      // The hands are on the batter's own side of the plate.
      expect(Math.sign(pos.x)).toBe(-sideSign(hand));
    }
  });

  it('at contact the bat lies across the plate at the ball height', () => {
    for (const hand of ['right', 'left'] as const) {
      const [pos, dir] = run(hand, 400, 0.9, 400);
      expect(Math.sign(dir.x)).toBe(sideSign(hand));
      expect(Math.abs(dir.x)).toBeGreaterThan(0.8);
      const sx = pos.x + dir.x * 0.6;
      const sy = pos.y + dir.y * 0.6;
      expect(Math.abs(sx)).toBeLessThan(0.3);
      expect(Math.abs(sy - 0.9)).toBeLessThan(0.2);
    }
  });

  it('the swing sweeps from behind the batter to in front of him', () => {
    const zs: number[] = [];
    for (const at of [100, 400, 900]) zs.push(run('right', 400, 0.9, at)[1]!.z);
    expect(zs[0]!).toBeGreaterThan(zs[1]!);
    expect(zs[1]!).toBeGreaterThan(zs[2]!);
  });

  it('is deterministic', () => {
    const a = run('right', 400, 0.9, 380);
    const b = run('right', 400, 0.9, 380);
    expect(a[0]!.toArray()).toEqual(b[0]!.toArray());
    expect(a[1]!.toArray()).toEqual(b[1]!.toArray());
  });
});
