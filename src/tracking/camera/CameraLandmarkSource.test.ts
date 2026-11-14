// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCameraSource } from './CameraLandmarkSource';

const NEEDS = { pose: true, handCrops: false, fullFrameHands: false };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: unknown = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeWorker.instances = [];
  getUserMedia = vi.fn();
  vi.stubGlobal('Worker', FakeWorker);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  // happy-dom only accepts a real MediaStream here; keep it a plain property.
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    configurable: true,
    writable: true,
    value: null,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 720,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CameraSource start/stop races', () => {
  it('stop() while getUserMedia is pending: the late stream is released and start() rejects', async () => {
    const gum = deferred<MediaStream>();
    getUserMedia.mockReturnValue(gum.promise);
    const source = createCameraSource();
    const started = source.start(NEEDS);
    const assertion = expect(started).rejects.toThrow(/cancelled/);
    source.stop();
    const { track, stream } = fakeStream();
    gum.resolve(stream);
    await assertion;
    expect(track.stop).toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('stop() while the worker is initialising rejects start() at once and terminates the worker', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const source = createCameraSource();
    const started = source.start(NEEDS);
    const assertion = expect(started).rejects.toThrow(/cancelled/);
    // Let the camera open and the worker be created; it never answers.
    for (let i = 0; i < 20 && FakeWorker.instances.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(FakeWorker.instances).toHaveLength(1);
    source.stop();
    await assertion;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    // No fallback worker or main-thread init was started.
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('can be started again after a cancelled start', async () => {
    const first = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(first.promise);
    const source = createCameraSource();
    const p1 = source.start(NEEDS);
    const a1 = expect(p1).rejects.toThrow(/cancelled/);
    source.stop();
    getUserMedia.mockResolvedValueOnce(fakeStream().stream);
    const p2 = source.start(NEEDS);
    const second = fakeStream();
    first.resolve(second.stream);
    await a1;
    // The stale stream was stopped, and the second start is still alive and waiting for its worker.
    expect(second.track.stop).toHaveBeenCalled();
    for (let i = 0; i < 20 && FakeWorker.instances.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(FakeWorker.instances).toHaveLength(1);
    const a2 = expect(p2).rejects.toThrow(/cancelled/);
    source.stop();
    await a2;
  });

  it('setNeeds calls that were queued behind init are rejected by stop()', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const source = createCameraSource();
    const started = source.start(NEEDS);
    const a = expect(started).rejects.toThrow(/cancelled/);
    for (let i = 0; i < 20 && FakeWorker.instances.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const n1 = source.setNeeds({ pose: true, handCrops: true, fullFrameHands: false });
    const n2 = source.setNeeds({ pose: false, handCrops: false, fullFrameHands: true });
    const b1 = expect(n1).rejects.toThrow();
    const b2 = expect(n2).rejects.toThrow();
    source.stop();
    await Promise.all([a, b1, b2]);
  });
});
