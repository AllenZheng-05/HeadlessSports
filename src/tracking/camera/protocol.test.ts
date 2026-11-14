import { describe, expect, it } from 'vitest';
import {
  H_ASPECT,
  H_HAS_POSE,
  H_INFERENCE_MS,
  HAND_LEN,
  PACKED_LEN,
  RequestChain,
  createFrame,
  packHand,
  packPose,
  unpackFrame,
} from './protocol';
import { POSE_COUNT } from '../types';

function fakePose(seed: number) {
  const lms = [];
  const world = [];
  for (let i = 0; i < POSE_COUNT; i++) {
    lms.push({ x: (i + seed) / 100, y: i / 50, z: -i / 200, visibility: 0.5 + i / 100 });
    world.push({ x: i / 10 - 1, y: i / 20, z: i / 30 });
  }
  return { lms, world };
}

describe('packed frame round trip', () => {
  it('mirrors pose x and world x, and preserves everything else', () => {
    const buf = new Float32Array(PACKED_LEN);
    const { lms, world } = fakePose(3);
    packPose(buf, lms, world);
    buf[H_HAS_POSE] = 1;
    buf[H_INFERENCE_MS] = 7.5;
    buf[H_ASPECT] = 1.5;
    const frame = createFrame();
    unpackFrame(buf, frame);
    expect(frame.inferenceMs).toBeCloseTo(7.5);
    expect(frame.aspect).toBeCloseTo(1.5);
    expect(frame.hasPose).toBe(true);
    for (let i = 0; i < POSE_COUNT; i++) {
      expect(frame.pose[i * 4]).toBeCloseTo(1 - lms[i].x, 5);
      expect(frame.pose[i * 4 + 1]).toBeCloseTo(lms[i].y, 5);
      expect(frame.pose[i * 4 + 2]).toBeCloseTo(lms[i].z, 5);
      expect(frame.pose[i * 4 + 3]).toBeCloseTo(lms[i].visibility, 5);
      expect(frame.poseWorld[i * 3]).toBeCloseTo(-world[i].x, 5);
      expect(frame.poseWorld[i * 3 + 1]).toBeCloseTo(world[i].y, 5);
    }
  });

  it('copies present hands, and leaves absent hands stale', () => {
    const buf = new Float32Array(PACKED_LEN);
    const state = new Float32Array(2 * HAND_LEN);
    for (let i = 0; i < state.length; i++) state[i] = i / 1000;
    packHand(buf, 0, true, 0.9, state, 0);
    packHand(buf, 1, false, 0.7, state, HAND_LEN);
    const frame = createFrame();
    frame.hands[1].landmarks.fill(42);
    unpackFrame(buf, frame);
    expect(frame.hands[0].present).toBe(true);
    expect(frame.hands[0].score).toBeCloseTo(0.9);
    expect(frame.hands[0].landmarks[5]).toBeCloseTo(0.005);
    expect(frame.hands[1].present).toBe(false);
    expect(frame.hands[1].score).toBe(0);
    expect(frame.hands[1].landmarks[5]).toBe(42);
  });

  it('keeps stale pose when hasPose is 0', () => {
    const buf = new Float32Array(PACKED_LEN);
    const frame = createFrame();
    frame.pose.fill(9);
    unpackFrame(buf, frame);
    expect(frame.hasPose).toBe(false);
    expect(frame.pose[0]).toBe(9);
  });
});

describe('RequestChain', () => {
  function deferred<T = void>() {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it('runs tasks one at a time, in order, and settles every caller', async () => {
    const chain = new RequestChain();
    const log: string[] = [];
    const a = deferred();
    const b = deferred();
    const pa = chain.run(async () => {
      log.push('a start');
      await a.promise;
      log.push('a end');
      return 1;
    });
    const pb = chain.run(async () => {
      log.push('b start');
      await b.promise;
      log.push('b end');
      return 2;
    });
    await tick();
    expect(log).toEqual(['a start']);
    a.resolve();
    expect(await pa).toBe(1);
    await tick();
    expect(log).toEqual(['a start', 'a end', 'b start']);
    b.resolve();
    expect(await pb).toBe(2);
  });

  it('a failing task rejects its caller and does not block the next one', async () => {
    const chain = new RequestChain();
    const bad = chain.run(() => Promise.reject(new Error('boom')));
    const good = chain.run(() => Promise.resolve('ok'));
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBe('ok');
  });

  it('cancelAll rejects running and queued requests at once and frees the chain', async () => {
    const chain = new RequestChain();
    const never = deferred();
    let secondStarted = false;
    const first = chain.run(() => never.promise);
    const second = chain.run(async () => {
      secondStarted = true;
    });
    const f = expect(first).rejects.toThrow('cancelled');
    const s = expect(second).rejects.toThrow('cancelled');
    chain.cancelAll(new Error('cancelled'));
    await f;
    await s;
    never.resolve();
    await tick();
    expect(secondStarted).toBe(false);
    await expect(chain.run(() => Promise.resolve(3))).resolves.toBe(3);
  });
});
