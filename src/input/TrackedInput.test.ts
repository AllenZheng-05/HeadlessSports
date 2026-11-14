import { describe, expect, it, vi } from 'vitest';
import { createEmptyFrame } from '../tracking/synthetic/body';
import { createSyntheticSource } from '../tracking/synthetic/SyntheticSource';
import { idle } from '../tracking/synthetic/scripts/moves';
import type {
  FrameListener,
  LandmarkFrame,
  LandmarkSource,
  TrackerNeeds,
  TrackingStats,
} from '../tracking/types';
import { TrackedInput } from './TrackedInput';
import type { Recognizer } from './recognizers/types';
import { noop } from './testing/collect';
import { createTestState } from './testing/frames';
import type { GameEvent } from './types';

const NEEDS: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: false };

/** A source the test drives by hand. */
class FakeSource implements LandmarkSource {
  readonly kind = 'synthetic' as const;
  readonly video = null;
  readonly stats: TrackingStats = {
    inferenceMs: 0,
    trackingHz: 0,
    latencyMs: 0,
    droppedFrames: 0,
    delegate: 'none',
    inWorker: false,
  };
  started = 0;
  stopped = 0;
  needs: TrackerNeeds[] = [];
  listeners: FrameListener[] = [];
  readonly frame = createEmptyFrame();
  private seq = 0;

  start(needs: TrackerNeeds): Promise<void> {
    this.started++;
    this.needs.push(needs);
    return Promise.resolve();
  }
  setNeeds(needs: TrackerNeeds): Promise<void> {
    this.needs.push(needs);
    return Promise.resolve();
  }
  pump(): void {
    // nothing to do
  }
  subscribe(listener: FrameListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  stop(): void {
    this.stopped++;
  }

  /** Deliver a frame of the standing test pose at time t. */
  send(t: number, hasPose = true): LandmarkFrame {
    const f = this.frame;
    f.t = t;
    f.seq = ++this.seq;
    f.hasPose = hasPose;
    f.pose.set(createTestState().pose);
    for (const l of [...this.listeners]) l(f);
    return f;
  }
}

describe('TrackedInput', () => {
  it('starts the source with the needs and subscribes', async () => {
    const source = new FakeSource();
    const input = new TrackedInput(source, { recognizers: [] });
    await input.start(NEEDS);
    expect(source.started).toBe(1);
    expect(source.needs[0]).toEqual(NEEDS);
    expect(source.listeners).toHaveLength(1);
    expect(input.source).toBe(source);
  });

  it('processes frames into state and counts them', async () => {
    const source = new FakeSource();
    const input = new TrackedInput(source, { recognizers: [] });
    await input.start(NEEDS);
    source.send(100);
    source.send(133);
    source.send(133); // same timestamp: ignored
    expect(input.frameCount).toBe(2);
    expect(input.state.tracking).toBe(true);
    expect(input.state.t).toBe(133);
    expect(input.state.shoulderWidth).toBeGreaterThan(0);
  });

  it('runs recognizers once per tracking frame, with a single emit function', async () => {
    const source = new FakeSource();
    const emits = new Set<unknown>();
    const rec: Recognizer = {
      name: 'probe',
      update: vi.fn((_s, emit) => {
        emits.add(emit);
      }),
      reset: vi.fn(),
    };
    const input = new TrackedInput(source, { recognizers: [rec] });
    await input.start(NEEDS);
    source.send(100);
    source.send(133);
    expect(rec.update).toHaveBeenCalledTimes(2);
    expect(emits.size).toBe(1);
  });

  it('delivers events only from update(), in timestamp order', async () => {
    const source = new FakeSource();
    const rec: Recognizer = {
      name: 'probe',
      update: (state, emit) => {
        if (state.t === 100) emit({ type: 'Jump', t: 90, height: 1 });
        if (state.t === 133) emit({ type: 'Jump', t: 50, height: 2 });
      },
      reset: noop,
    };
    const input = new TrackedInput(source, { recognizers: [rec] });
    const seen: number[] = [];
    input.on('Jump', (e) => seen.push(e.t));
    await input.start(NEEDS);
    source.send(100);
    source.send(133);
    expect(seen).toEqual([]);
    input.update(150);
    expect(seen).toEqual([50, 90]);
    input.update(166);
    expect(seen).toEqual([50, 90]);
  });

  it('skips recognizers without a usable frame and resets them when tracking is lost', async () => {
    const source = new FakeSource();
    const rec: Recognizer = { name: 'probe', update: vi.fn(), reset: vi.fn() };
    const handsOnly: Recognizer = {
      name: 'hands',
      needsPose: false,
      update: vi.fn(),
      reset: vi.fn(),
    };
    const input = new TrackedInput(source, { recognizers: [rec, handsOnly] });
    await input.start(NEEDS);
    source.send(100);
    expect(rec.update).toHaveBeenCalledTimes(1);
    source.send(133, false);
    expect(rec.update).toHaveBeenCalledTimes(1);
    expect(rec.reset).toHaveBeenCalled();
    // Hands-only recognizers run whenever something is tracked, with or without pose.
    expect(handsOnly.update).toHaveBeenCalledTimes(1);
  });

  it('pushes TrackingLost when frames stop, and TrackingFound when they return', async () => {
    const source = new FakeSource();
    const input = new TrackedInput(source, { recognizers: [] });
    const events: GameEvent[] = [];
    input.onAny((e) => events.push(e));
    await input.start(NEEDS);
    source.send(100);
    input.update(120);
    expect(events).toHaveLength(0); // first acquisition is silent
    input.update(1000); // far beyond lostAfterMs without a frame
    expect(input.state.tracking).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['TrackingLost']);
    source.send(1100);
    input.update(1120);
    expect(events.map((e) => e.type)).toEqual(['TrackingLost', 'TrackingFound']);
  });

  it('resets recognizers and cadence when tracking is lost', async () => {
    const source = new FakeSource();
    const rec: Recognizer = { name: 'probe', update: noop, reset: vi.fn() };
    const input = new TrackedInput(source, { recognizers: [rec] });
    await input.start(NEEDS);
    source.send(100);
    input.state.cadence.stepsPerSecond = 3;
    input.update(2000);
    expect(rec.reset).toHaveBeenCalled();
    expect(input.state.cadence.stepsPerSecond).toBe(0);
  });

  it('setNeeds forwards to the source and resets recognizers; setCalibration is forwarded', async () => {
    const source = new FakeSource();
    const setCalibrated = vi.fn();
    const rec: Recognizer = { name: 'probe', update: noop, reset: vi.fn(), setCalibrated };
    const input = new TrackedInput(source, { recognizers: [rec] });
    await input.start(NEEDS);
    await input.setNeeds({ pose: true, handCrops: false, fullFrameHands: false });
    expect(source.needs).toHaveLength(2);
    expect(rec.reset).toHaveBeenCalled();
    input.setCalibration({
      centreX: 0.5,
      centreY: 0.3,
      hipY: 0.5,
      shoulderWidth: 0.1,
      armLength: 1.5,
      handedness: 'right',
      seated: false,
    });
    expect(setCalibrated).toHaveBeenLastCalledWith(true);
    input.setCalibration(null);
    expect(setCalibrated).toHaveBeenLastCalledWith(false);
  });

  it('stop unsubscribes, stops the source and drops queued events', async () => {
    const source = new FakeSource();
    const rec: Recognizer = {
      name: 'probe',
      update: (_s, emit) => emit({ type: 'Jump', t: 1, height: 1 }),
      reset: noop,
    };
    const input = new TrackedInput(source, { recognizers: [rec] });
    const h = vi.fn();
    input.on('Jump', h);
    await input.start(NEEDS);
    source.send(100);
    input.stop();
    expect(source.stopped).toBe(1);
    expect(source.listeners).toHaveLength(0);
    input.update(200);
    expect(h).not.toHaveBeenCalled();
    const frames = input.frameCount;
    source.send(300);
    expect(input.frameCount).toBe(frames);
  });

  it('pumps the source from update', async () => {
    const source = createSyntheticSource({ script: { name: 'i', steps: idle(2000) } });
    const input = new TrackedInput(source);
    await input.start(NEEDS);
    expect(input.frameCount).toBe(0);
    input.update(0);
    input.update(500);
    expect(input.frameCount).toBeGreaterThan(10);
    expect(input.state.tracking).toBe(true);
  });
});
