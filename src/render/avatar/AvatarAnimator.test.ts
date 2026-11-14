import { Vector3 } from 'three/webgpu';
import type { Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { POSE_COUNT, POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { AvatarAnimator } from './AvatarAnimator';
import type { OneShot } from './AvatarAnimator';
import { AvatarRig } from './AvatarRig';
import type { Side } from './AvatarRig';

const DT = 1 / 60;
const SHOULDER_Y = 1.3;

function setup(): { rig: AvatarRig; anim: AvatarAnimator } {
  const rig = new AvatarRig();
  return { rig, anim: new AvatarAnimator(rig) };
}

function frame(rig: AvatarRig, anim: AvatarAnimator, n = 1): void {
  for (let i = 0; i < n; i++) {
    anim.update(DT);
    rig.update(DT);
  }
  rig.root.updateMatrixWorld(true);
}

function mitt(rig: AvatarRig, side: Side): Vector3 {
  return rig.mitts[side].getWorldPosition(new Vector3());
}
function part(rig: AvatarRig, name: string): Object3D {
  const o = rig.root.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return o;
}

function tPose(): Float32Array {
  const p = new Float32Array(POSE_COUNT * POSE_STRIDE);
  const set = (i: number, x: number, y: number): void => {
    p[i * POSE_STRIDE] = x;
    p[i * POSE_STRIDE + 1] = y;
    p[i * POSE_STRIDE + 3] = 1;
  };
  set(PoseIndex.LEFT_SHOULDER, 0.4, 0.3);
  set(PoseIndex.RIGHT_SHOULDER, 0.6, 0.3);
  set(PoseIndex.LEFT_ELBOW, 0.265, 0.3);
  set(PoseIndex.RIGHT_ELBOW, 0.735, 0.3);
  set(PoseIndex.LEFT_WRIST, 0.14, 0.3);
  set(PoseIndex.RIGHT_WRIST, 0.86, 0.3);
  return p;
}

function followPlayer(rig: AvatarRig): void {
  rig.setUpperBodyFromPose(tPose(), tPose(), 1, 16 / 9);
}

const CLIPS: OneShot[] = [
  'throw-over',
  'throw-under',
  'swing',
  'celebrate',
  'slump',
  'hop',
  'bow-release',
];
const DURATIONS: Record<OneShot, number> = {
  'throw-over': 0.55,
  'throw-under': 0.6,
  swing: 0.5,
  celebrate: 1.4,
  slump: 1.0,
  hop: 0.35,
  'bow-release': 0.4,
};

describe('run cycle', () => {
  it('alternates leg flexion at the requested cadence', () => {
    const { rig, anim } = setup();
    anim.setRun(3, 1);
    let changes = 0;
    let last = 0;
    let maxHip = 0;
    for (let i = 0; i < 120; i++) {
      frame(rig, anim);
      const hip = part(rig, 'thigh-left').rotation.x;
      maxHip = Math.max(maxHip, Math.abs(hip));
      const sign = hip > 0.01 ? 1 : hip < -0.01 ? -1 : 0;
      if (sign !== 0) {
        if (last !== 0 && sign !== last) changes++;
        last = sign;
      }
    }
    expect(changes).toBeGreaterThanOrEqual(5);
    expect(changes).toBeLessThanOrEqual(7);
    expect(maxHip).toBeGreaterThan(0.6);
    expect(maxHip).toBeLessThan(1.0);
  });

  it('moves the legs in antiphase, bends the forward knee and bobs the body', () => {
    const { rig, anim } = setup();
    anim.setRun(3, 1);
    let opposite = 0;
    let maxKnee = 0;
    let maxY = 0;
    for (let i = 0; i < 90; i++) {
      frame(rig, anim);
      const l = part(rig, 'thigh-left').rotation.x;
      const r = part(rig, 'thigh-right').rotation.x;
      if (l * r <= 0) opposite++;
      maxKnee = Math.max(maxKnee, -part(rig, 'shin-left').rotation.x);
      maxY = Math.max(maxY, part(rig, 'pelvis').position.y);
    }
    expect(opposite).toBe(90);
    expect(maxKnee).toBeGreaterThan(0.9);
    expect(maxY).toBeGreaterThan(0.78 + 0.03);
  });

  it('scales with amplitude and never touches the arms', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    const before = mitt(rig, 'right').clone();
    anim.setRun(3, 0.4);
    let maxKnee = 0;
    for (let i = 0; i < 90; i++) {
      frame(rig, anim);
      maxKnee = Math.max(maxKnee, -part(rig, 'shin-left').rotation.x);
    }
    expect(maxKnee).toBeLessThan(0.6);
    const after = mitt(rig, 'right');
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.z - before.z)).toBeLessThan(1e-6);
  });

  it('returns to standing within a quarter second of setRun(0)', () => {
    const { rig, anim } = setup();
    anim.setRun(3, 1);
    frame(rig, anim, 60);
    anim.setRun(0);
    frame(rig, anim, 15);
    expect(Math.abs(part(rig, 'thigh-left').rotation.x)).toBeLessThan(0.06);
    expect(Math.abs(part(rig, 'thigh-right').rotation.x)).toBeLessThan(0.06);
    expect(Math.abs(part(rig, 'shin-left').rotation.x)).toBeLessThan(0.06);
    frame(rig, anim, 60);
    expect(part(rig, 'thigh-left').rotation.x).toBe(0);
    expect(part(rig, 'shin-right').rotation.x).toBeCloseTo(0, 12);
  });
});

describe('breathing and sway', () => {
  it('breathes by default and can be switched off', () => {
    const { rig, anim } = setup();
    let min = 9;
    let max = -9;
    for (let i = 0; i < 300; i++) {
      frame(rig, anim);
      const y = part(rig, 'pelvis').position.y;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    expect(min).toBeGreaterThanOrEqual(0.78 - 1e-9);
    expect(max).toBeLessThanOrEqual(0.78 + 0.006 + 1e-9);
    expect(max - min).toBeGreaterThan(0.004);
    anim.setBreathing(false);
    frame(rig, anim, 2);
    expect(part(rig, 'pelvis').position.y).toBeCloseTo(0.78, 9);
  });

  it('sways the torso and returns it', () => {
    const { rig, anim } = setup();
    anim.setSway(1);
    frame(rig, anim, 60);
    const torso = part(rig, 'torso');
    expect(Math.abs(torso.quaternion.z)).toBeGreaterThan(0.03);
    anim.setSway(0);
    frame(rig, anim, 90);
    expect(Math.abs(torso.quaternion.z)).toBeLessThan(0.005);
  });
});

describe('one-shots', () => {
  it.each(CLIPS)('%s plays, reports busy, ends on time and hands the arms back', (clip) => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    expect(anim.busy).toBe(false);
    anim.play(clip);
    expect(anim.busy).toBe(true);
    expect(anim.current).toBe(clip);
    const frames = Math.round(DURATIONS[clip] / DT);
    frame(rig, anim, frames - 3);
    expect(anim.busy).toBe(true);
    frame(rig, anim, 6);
    expect(anim.busy).toBe(false);
    expect(anim.current).toBeNull();
    // Arms follow the player again.
    followPlayer(rig);
    frame(rig, anim, 90);
    expect(mitt(rig, 'right').x).toBeGreaterThan(0.5);
    expect(mitt(rig, 'left').x).toBeLessThan(-0.5);
  });

  it('throw-over cocks behind the shoulder, goes over the top and ends in front', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    const startZ = mitt(rig, 'right').z;
    anim.play('throw-over');
    let maxZ = -9;
    let maxY = -9;
    let z = 0;
    let y = 0;
    for (let i = 0; i < Math.round(0.55 / DT) - 1; i++) {
      frame(rig, anim);
      followPlayer(rig); // the player's pose must not fight the clip
      const m = mitt(rig, 'right');
      maxZ = Math.max(maxZ, m.z);
      maxY = Math.max(maxY, m.y);
      z = m.z;
      y = m.y;
    }
    expect(maxZ).toBeGreaterThan(0.15);
    expect(maxY).toBeGreaterThan(SHOULDER_Y + 0.3);
    expect(z).toBeLessThan(startZ - 0.25);
    expect(z).toBeLessThan(-0.2);
    expect(y).toBeLessThan(SHOULDER_Y);
    expect(mitt(rig, 'left').z).toBeGreaterThan(-0.1);
  });

  it('throw-over with the left hand mirrors it', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    const rightBefore = mitt(rig, 'right').clone();
    anim.play('throw-over', { side: 'left' });
    frame(rig, anim, 28);
    expect(mitt(rig, 'left').z).toBeLessThan(-0.2);
    expect(mitt(rig, 'right').distanceTo(rightBefore)).toBeLessThan(0.15);
  });

  it('throw-under swings from low at the hip up to about head height in front', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('throw-under');
    let minY = 9;
    let maxY = -9;
    let z = 0;
    for (let i = 0; i < Math.round(0.6 / DT) - 1; i++) {
      frame(rig, anim);
      const m = mitt(rig, 'right');
      minY = Math.min(minY, m.y);
      maxY = Math.max(maxY, m.y);
      z = m.z;
    }
    expect(minY).toBeLessThan(0.9);
    expect(maxY).toBeGreaterThan(1.4);
    expect(z).toBeLessThan(-0.15);
  });

  it('swing carries both hands across the body', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('swing', { side: 'right' });
    let minX = 9;
    let maxX = -9;
    for (let i = 0; i < Math.round(0.5 / DT) - 1; i++) {
      frame(rig, anim);
      const m = mitt(rig, 'right');
      minX = Math.min(minX, m.x);
      maxX = Math.max(maxX, m.x);
      expect(Math.abs(mitt(rig, 'left').x - m.x)).toBeLessThan(0.7);
    }
    expect(maxX - minX).toBeGreaterThan(0.4);
  });

  it('celebrate lifts both mitts above the shoulders and hops with squash', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('celebrate');
    let leftTop = 0;
    let rightTop = 0;
    let maxPelvis = 0;
    let minScale = 1;
    for (let i = 0; i < Math.round(1.4 / DT) - 1; i++) {
      frame(rig, anim);
      leftTop = Math.max(leftTop, mitt(rig, 'left').y);
      rightTop = Math.max(rightTop, mitt(rig, 'right').y);
      maxPelvis = Math.max(maxPelvis, part(rig, 'pelvis').position.y);
      minScale = Math.min(minScale, rig.root.scale.y);
    }
    expect(leftTop).toBeGreaterThan(SHOULDER_Y + 0.2);
    expect(rightTop).toBeGreaterThan(SHOULDER_Y + 0.2);
    expect(maxPelvis).toBeGreaterThan(0.78 + 0.08);
    expect(minScale).toBeLessThan(0.95);
  });

  it('slump drops the pelvis and lets the arms hang forward', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('slump');
    let minPelvis = 9;
    let z = 0;
    for (let i = 0; i < 30; i++) {
      frame(rig, anim);
      minPelvis = Math.min(minPelvis, part(rig, 'pelvis').position.y);
      z = mitt(rig, 'right').z;
    }
    expect(minPelvis).toBeLessThan(0.78 - 0.03);
    expect(z).toBeLessThan(-0.05);
  });

  it('hop rises and squashes on landing', () => {
    const { rig, anim } = setup();
    anim.setBreathing(false);
    frame(rig, anim, 30);
    anim.play('hop');
    let maxPelvis = 0;
    for (let i = 0; i < 22; i++) {
      frame(rig, anim);
      maxPelvis = Math.max(maxPelvis, part(rig, 'pelvis').position.y);
    }
    expect(maxPelvis).toBeGreaterThan(0.78 + 0.1);
    expect(rig.root.scale.y).toBeLessThan(0.99);
  });

  it('bow-release springs the draw hand back while the bow arm stays out front', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('bow-release');
    frame(rig, anim, 3);
    const earlyDraw = mitt(rig, 'right').clone();
    frame(rig, anim, 12);
    const lateDraw = mitt(rig, 'right');
    expect(lateDraw.x - earlyDraw.x).toBeGreaterThan(0.1);
    expect(mitt(rig, 'left').z).toBeLessThan(-0.3);
  });

  it('stop releases the arms at once', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('throw-over');
    frame(rig, anim, 10);
    anim.stop();
    expect(anim.busy).toBe(false);
    followPlayer(rig);
    frame(rig, anim, 90);
    expect(mitt(rig, 'right').x).toBeGreaterThan(0.5);
  });

  it('strength scales the travel', () => {
    const range = (strength: number): number => {
      const { rig, anim } = setup();
      frame(rig, anim, 30);
      anim.play('throw-over', { strength });
      let lo = 9;
      let hi = -9;
      for (let i = 0; i < 31; i++) {
        frame(rig, anim);
        const m = mitt(rig, 'right');
        lo = Math.min(lo, m.z);
        hi = Math.max(hi, m.z);
      }
      return hi - lo;
    };
    const full = range(1);
    const weak = range(0.4);
    expect(weak).toBeLessThan(full * 0.7);
    expect(weak).toBeGreaterThan(0.02);
  });

  it('a new one-shot replaces a running one and hands back arms it no longer needs', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    anim.play('swing');
    frame(rig, anim, 10);
    anim.play('throw-over', { side: 'left' });
    expect(anim.current).toBe('throw-over');
    frame(rig, anim, 5);
    followPlayer(rig);
    frame(rig, anim, 60);
    expect(anim.busy).toBe(false);
    expect(mitt(rig, 'right').x).toBeGreaterThan(0.5);
  });

  it('starts without teleporting the mitt', () => {
    const { rig, anim } = setup();
    frame(rig, anim, 30);
    const before = mitt(rig, 'right').clone();
    anim.play('throw-over');
    frame(rig, anim);
    expect(mitt(rig, 'right').distanceTo(before)).toBeLessThan(0.1);
  });
});

describe('robustness', () => {
  it('stays finite over 10 s of mixed calls', () => {
    const { rig, anim } = setup();
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 600; i++) {
      if (i % 37 === 0) {
        anim.play(CLIPS[Math.floor(rnd() * CLIPS.length)], {
          side: rnd() < 0.5 ? 'left' : 'right',
          strength: rnd(),
        });
      }
      if (i % 53 === 0) anim.setRun(rnd() * 5, rnd());
      if (i % 61 === 0) anim.setSway(rnd() * 2 - 1);
      if (i % 211 === 0) anim.stop();
      anim.update(i % 90 === 0 ? 0.5 : DT);
      rig.update(DT);
    }
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => {
      for (const e of o.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true);
    });
    anim.reset();
    expect(anim.busy).toBe(false);
  });
});
