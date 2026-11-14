import { describe, expect, it } from 'vitest';
import type { TrackerNeeds } from '../types';
import { MoveQueue } from './MoveQueue';
import { defaultControls } from './controls';
import type { BodyControls } from './controls';
import { createSyntheticSource } from './SyntheticSource';

const ALL: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: false };

function sampleAt(q: MoveQueue, t: number): BodyControls {
  const out = defaultControls();
  q.sample(t, out);
  return out;
}

describe('MoveQueue', () => {
  it('starts at the default controls overlaid with start', () => {
    const q = new MoveQueue({ crouch: 0.4 });
    const c = sampleAt(q, 0);
    expect(c.crouch).toBe(0.4);
    expect(c.shoulderY).toBe(0.32);
    expect(q.idle).toBe(true);
    expect(q.label).toBe('');
    expect(q.pendingMs).toBe(0);
  });

  it('plays steps in sequence, each starting where the previous ended', () => {
    const q = new MoveQueue();
    q.enqueue([
      { dur: 100, to: { leftWristY: 1 }, ease: 'linear', label: 'a' },
      { dur: 100, to: { leftWristY: 0, crouch: 1 }, ease: 'linear', label: 'b' },
    ]);
    expect(q.idle).toBe(false);
    expect(sampleAt(q, 1000).leftWristY).toBeCloseTo(-1.4, 9); // starts at first sample
    expect(q.label).toBe('a');
    expect(sampleAt(q, 1050).leftWristY).toBeCloseTo(-0.2, 9);
    const mid = sampleAt(q, 1100);
    expect(mid.leftWristY).toBeCloseTo(1, 9);
    expect(q.label).toBe('b');
    const c = sampleAt(q, 1150);
    expect(c.leftWristY).toBeCloseTo(0.5, 9);
    expect(c.crouch).toBeCloseTo(0.5, 9);
    const end = sampleAt(q, 1200);
    expect(end.leftWristY).toBe(0);
    expect(end.crouch).toBe(1);
    expect(q.idle).toBe(true);
    expect(q.label).toBe('');
    // holds the last pose
    expect(sampleAt(q, 5000).crouch).toBe(1);
  });

  it('a later step moves only the controls it names, from where they are', () => {
    const q = new MoveQueue();
    q.enqueue([{ dur: 100, to: { crouch: 1 }, ease: 'linear' }]);
    sampleAt(q, 0);
    q.enqueue([{ dur: 100, to: { lean: 0.5 }, ease: 'linear' }]);
    const c = sampleAt(q, 150);
    expect(c.crouch).toBe(1);
    expect(c.lean).toBeCloseTo(0.25, 9);
  });

  it('reports pendingMs', () => {
    const q = new MoveQueue();
    q.enqueue([{ dur: 100 }, { dur: 200 }, { dur: 300 }]);
    expect(q.pendingMs).toBe(600);
    sampleAt(q, 0);
    expect(q.pendingMs).toBe(600);
    sampleAt(q, 50);
    expect(q.pendingMs).toBeCloseTo(550, 9);
    sampleAt(q, 150);
    expect(q.pendingMs).toBeCloseTo(450, 9);
    sampleAt(q, 600);
    expect(q.pendingMs).toBe(0);
  });

  it('completes several steps on a large time jump and applies all targets', () => {
    const q = new MoveQueue();
    q.enqueue([
      { dur: 100, to: { crouch: 1 } },
      { dur: 100, to: { lean: -0.3 } },
      { dur: 100, to: { crouch: 0.2 } },
    ]);
    sampleAt(q, 0);
    const c = sampleAt(q, 10_000);
    expect(c.crouch).toBe(0.2);
    expect(c.lean).toBe(-0.3);
    expect(q.idle).toBe(true);
  });

  it('a step queued when idle begins at the next sample, not at the old end time', () => {
    const q = new MoveQueue();
    q.enqueue([{ dur: 100, to: { crouch: 1 }, ease: 'linear' }]);
    sampleAt(q, 0);
    sampleAt(q, 100);
    expect(q.idle).toBe(true);
    q.enqueue([{ dur: 100, to: { crouch: 0 }, ease: 'linear' }]);
    expect(sampleAt(q, 133).crouch).toBe(1);
    expect(sampleAt(q, 183).crouch).toBeCloseTo(0.5, 9);
  });

  it('reset replaces the pose and drops queued steps; clear keeps the pose', () => {
    const q = new MoveQueue();
    q.enqueue([{ dur: 100, to: { crouch: 1 }, ease: 'linear' }]);
    sampleAt(q, 0);
    sampleAt(q, 50);
    q.clear();
    expect(q.idle).toBe(true);
    expect(q.pendingMs).toBe(0);
    expect(sampleAt(q, 60).crouch).toBeCloseTo(0.5, 9);
    q.enqueue([{ dur: 100, to: { lean: 1 } }]);
    q.reset({ handsOnly: 1 });
    expect(q.idle).toBe(true);
    const c = sampleAt(q, 70);
    expect(c.handsOnly).toBe(1);
    expect(c.crouch).toBe(0);
    expect(c.lean).toBe(0);
  });

  it('throws a clear error when the ring is full, and enqueues nothing', () => {
    const q = new MoveQueue();
    const many = Array.from({ length: 256 }, () => ({ dur: 10 }));
    q.enqueue(many);
    expect(() => q.enqueue([{ dur: 10 }])).toThrow(/full/);
    expect(q.pendingMs).toBe(2560);
    // draining frees slots
    sampleAt(q, 0);
    sampleAt(q, 100);
    expect(() => q.enqueue([{ dur: 10 }])).not.toThrow();
  });

  it('wraps around the ring', () => {
    const q = new MoveQueue();
    let t = 0;
    for (let i = 0; i < 600; i++) {
      q.enqueue([{ dur: 10, to: { lean: i / 1000 }, ease: 'linear' }]);
      t += 10;
      sampleAt(q, t);
    }
    expect(sampleAt(q, t + 20).lean).toBeCloseTo(0.599, 9);
  });

  it('rejects non-positive durations', () => {
    expect(() => new MoveQueue().enqueue([{ dur: 0 }])).toThrow();
  });
});

describe('SyntheticSource director mode', () => {
  function pumpTo(s: ReturnType<typeof createSyntheticSource>, to: number): void {
    for (let t = 0; t < to; t += 16) s.pump(t);
    s.pump(to);
  }

  it('calls the director exactly when idle, never while moves are pending', async () => {
    const s = createSyntheticSource({ script: { name: 'x', steps: [] } });
    const calls: number[] = [];
    s.setDirector((q, t) => {
      calls.push(t);
      q.enqueue([{ dur: 200, to: { crouch: 1 }, label: 'go' }]);
    });
    expect(s.queue).not.toBeNull();
    await s.start(ALL);
    pumpTo(s, 1000);
    // frames at 0, 33.3...; each 200 ms move ends and the director is asked again on the next frame
    expect(calls[0]).toBe(0);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i] - calls[i - 1]).toBeGreaterThanOrEqual(200);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(s.finished).toBe(false);
  });

  it('holds the pose when the director enqueues nothing, and keeps 30 Hz stepping', async () => {
    const s = createSyntheticSource({ script: { name: 'x', steps: [] } });
    const ts: number[] = [];
    let n = 0;
    s.subscribe((f) => ts.push(f.t));
    s.setDirector(
      () => {
        n++;
      },
      { crouch: 0.3 },
    );
    await s.start(ALL);
    pumpTo(s, 1000);
    expect(n).toBe(ts.length);
    expect(ts).toHaveLength(31);
    expect(s.queue?.idle).toBe(true);
    expect(s.finished).toBe(false);
  });

  it('reports the queue label and plays the enqueued motion', async () => {
    const s = createSyntheticSource({ script: { name: 'x', steps: [] } });
    let once = true;
    s.setDirector((q) => {
      if (!once) return;
      once = false;
      q.enqueue([{ dur: 300, label: 'wave' }]);
    });
    await s.start(ALL);
    s.pump(0);
    s.pump(100);
    expect(s.currentLabel).toBe('wave');
    s.pump(400);
    expect(s.currentLabel).toBe('');
  });

  it('switches between script and director modes', async () => {
    const s = createSyntheticSource({
      script: { name: 'x', steps: [{ dur: 100, label: 'scripted' }] },
    });
    await s.start(ALL);
    s.pump(0);
    expect(s.currentLabel).toBe('scripted');
    s.setDirector((q) => q.enqueue([{ dur: 1000, label: 'directed' }]));
    s.pump(5000);
    expect(s.currentLabel).toBe('directed');
    expect(s.scriptTimeMs).toBe(0);
    s.setScript({ name: 'y', steps: [{ dur: 100, label: 'again' }] });
    expect(s.queue).toBeNull();
    s.pump(6000);
    expect(s.currentLabel).toBe('again');
    s.setDirector(null);
    expect(s.queue).toBeNull();
  });
});
