import { Box3, MeshToonMaterial, Vector3 } from 'three/webgpu';
import type { Object3D, Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { POSE_COUNT, POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { PALETTE } from '../style/palette';
import { AvatarRig } from './AvatarRig';

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function settle(rig: AvatarRig, frames = 60): void {
  for (let i = 0; i < frames; i++) rig.update(1 / 60);
  rig.root.updateMatrixWorld(true);
}

function worldPos(o: Object3D): Vector3 {
  return o.getWorldPosition(new Vector3());
}

function makePose(): Float32Array {
  return new Float32Array(POSE_COUNT * POSE_STRIDE);
}

function setLm(p: Float32Array, idx: number, x: number, y: number, vis = 1): void {
  p[idx * POSE_STRIDE] = x;
  p[idx * POSE_STRIDE + 1] = y;
  p[idx * POSE_STRIDE + 3] = vis;
}

/** Shoulder width 0.2 in image units, so one shoulder width = 0.4 m on the rig (scale 2). */
function tPose(wristRaised = false): Float32Array {
  const p = makePose();
  setLm(p, PoseIndex.LEFT_SHOULDER, 0.4, 0.3);
  setLm(p, PoseIndex.RIGHT_SHOULDER, 0.6, 0.3);
  setLm(p, PoseIndex.LEFT_ELBOW, 0.4 - 0.135, 0.3);
  setLm(p, PoseIndex.RIGHT_ELBOW, 0.6 + 0.135, 0.3);
  if (wristRaised) {
    setLm(p, PoseIndex.LEFT_WRIST, 0.4 - 0.135, 0.3 - 0.125);
    setLm(p, PoseIndex.RIGHT_WRIST, 0.6 + 0.135, 0.3);
  } else {
    setLm(p, PoseIndex.LEFT_WRIST, 0.4 - 0.26, 0.3);
    setLm(p, PoseIndex.RIGHT_WRIST, 0.6 + 0.26, 0.3);
  }
  return p;
}

describe('AvatarRig', () => {
  it('has no head: nothing above shoulder height plus torso radius, no head or neck parts', () => {
    const rig = new AvatarRig();
    rig.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(rig.root);
    expect(box.max.y).toBeLessThanOrEqual(1.3 + 0.19);
    expect(box.min.y).toBeGreaterThan(-0.02);
    rig.root.traverse((o) => expect(o.name).not.toMatch(/head|neck|face/i));
    rig.dispose();
  });

  it('stays within 14 meshes and only mitts and feet use the player colour', () => {
    const rig = new AvatarRig();
    const all = meshes(rig.root);
    expect(all.length).toBeLessThanOrEqual(14);
    let player = 0;
    for (const m of all) {
      const hex = (m.material as MeshToonMaterial).color.getHex();
      const isPlayer = /^(mitt|foot)/.test(m.name);
      if (isPlayer) player++;
      expect(hex === new MeshToonMaterial({ color: PALETTE.whistle }).color.getHex(), m.name).toBe(
        isPlayer,
      );
      if (!isPlayer)
        expect(hex).toBe(new MeshToonMaterial({ color: PALETTE.putty }).color.getHex());
    }
    expect(player).toBe(4);
    rig.dispose();
  });

  it('puts the mitt on a reachable procedural target', () => {
    const rig = new AvatarRig();
    rig.setArmTarget('right', 0.45, 1.5, -0.25, 0.5, 1.0, 0);
    settle(rig, 5);
    const p = worldPos(rig.mitts.right);
    expect(p.distanceTo(new Vector3(0.45, 1.5, -0.25))).toBeLessThan(0.01);
    rig.dispose();
  });

  it('follows the target with the torso leaned', () => {
    const rig = new AvatarRig();
    rig.setTorso(0.3, 0.2);
    rig.setArmTarget('left', -0.4, 1.2, -0.3);
    settle(rig, 120);
    expect(worldPos(rig.mitts.left).distanceTo(new Vector3(-0.4, 1.2, -0.3))).toBeLessThan(0.01);
  });

  it('mirrors a T-pose: left mitt out to -x at shoulder height', () => {
    const rig = new AvatarRig();
    const pose = tPose();
    rig.setUpperBodyFromPose(pose, pose, 1, 1);
    settle(rig);
    const l = worldPos(rig.mitts.left);
    const r = worldPos(rig.mitts.right);
    expect(l.x).toBeCloseTo(-(0.2 + 0.27 + 0.25), 1);
    expect(l.y).toBeCloseTo(1.3, 1);
    expect(Math.abs(l.z)).toBeLessThan(0.05);
    expect(r.x).toBeCloseTo(0.72, 1);
    rig.dispose();
  });

  it('raises the left mitt above the shoulder when the left wrist goes up', () => {
    const rig = new AvatarRig();
    const pose = tPose(true);
    rig.setUpperBodyFromPose(pose, pose, 1, 1);
    settle(rig);
    expect(worldPos(rig.mitts.left).y).toBeGreaterThan(1.3 + 0.2);
    expect(worldPos(rig.mitts.right).y).toBeCloseTo(1.3, 1);
  });

  it('pushes a foreshortened arm forward (toward -z)', () => {
    const rig = new AvatarRig();
    const p = tPose();
    // Left elbow and wrist almost on top of the shoulder in 2D: arm points at the camera.
    setLm(p, PoseIndex.LEFT_ELBOW, 0.39, 0.31);
    setLm(p, PoseIndex.LEFT_WRIST, 0.38, 0.32);
    rig.setUpperBodyFromPose(p, p, 1, 1);
    settle(rig);
    expect(worldPos(rig.mitts.left).z).toBeLessThan(-0.3);
  });

  it('leaves an arm at rest when its landmarks are not visible', () => {
    const rig = new AvatarRig();
    const rest = worldPos(rig.mitts.left).clone();
    const pose = tPose();
    pose[PoseIndex.LEFT_WRIST * POSE_STRIDE + 3] = 0.2;
    rig.setUpperBodyFromPose(pose, pose, 1, 1);
    settle(rig);
    expect(worldPos(rig.mitts.left).distanceTo(rest)).toBeLessThan(0.01);
    expect(worldPos(rig.mitts.right).x).toBeGreaterThan(0.6);
  });

  it('releaseArm returns a procedural arm to rest', () => {
    const rig = new AvatarRig();
    const rest = worldPos(rig.mitts.right).clone();
    rig.setArmTarget('right', 0.3, 1.6, -0.3);
    settle(rig, 5);
    rig.releaseArm('right');
    settle(rig, 90);
    expect(worldPos(rig.mitts.right).distanceTo(rest)).toBeLessThan(0.02);
  });

  it('curls the mitt', () => {
    const rig = new AvatarRig();
    const mesh = meshes(rig.mitts.left)[0]!;
    settle(rig, 5);
    const open = mesh.scale.clone();
    expect(open.y).toBeLessThan(0.7);
    rig.setMittCurl('left', 1);
    settle(rig, 60);
    expect(mesh.scale.y).toBeGreaterThan(0.9);
    expect(mesh.scale.x).toBeCloseTo(0.95, 1);
    expect(mesh.scale.y).not.toBeCloseTo(open.y, 1);
  });

  it('squash eases back to neutral', () => {
    const rig = new AvatarRig();
    rig.squash(0.8);
    rig.update(0.001);
    expect(rig.root.scale.y).toBeLessThan(0.9);
    settle(rig, 120);
    expect(rig.root.scale.y).toBeCloseTo(1, 2);
  });
});
