import { describe, expect, it } from 'vitest';
import type { TrackerNeeds } from '../types';
import { createSyntheticSource } from './SyntheticSource';
import type { Script } from './script';

const ALL: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: false };
const script: Script = {
  name: 's',
  steps: [
    { dur: 500, to: { leftWristY: 0.5 }, label: 'one' },
    { dur: 500, to: { leftWristY: -1 }, label: 'two' },
  ],
};

/** Pump in 16 ms steps from `from` (exclusive of nothing) to `to`, ending exactly on `to`. */
function advance(source: ReturnType<typeof createSyntheticSource>, from: number, to: number): void {
  for (let t = from; t < to; t += 16) source.pump(t);
  source.pump(to);
}

function collect(source: ReturnType<typeof createSyntheticSource>): number[] {
  const ts: number[] = [];
  source.subscribe((f) => ts.push(f.t));
  return ts;
}

describe('SyntheticSource stepping', () => {
  it('emits nothing before start or after stop', async () => {
    const s = createSyntheticSource({ script });
    const ts = collect(s);
    s.pump(1000);
    expect(ts).toHaveLength(0);
    await s.start(ALL);
    s.pump(0);
    s.stop();
    s.pump(1000);
    expect(ts).toHaveLength(1);
  });

  it('delivers the exact number of frames for a span at 30 Hz, strictly increasing', async () => {
    const s = createSyntheticSource({ script });
    const ts = collect(s);
    await s.start(ALL);
    advance(s, 0, 1000);
    expect(ts).toHaveLength(31);
    expect(ts[0]).toBe(0);
    expect(ts[30]).toBe(1000);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  });

  it('pumping at render rate gives the same frames as one big pump', async () => {
    const s = createSyntheticSource({ script });
    const ts = collect(s);
    await s.start(ALL);
    let now = 100;
    for (let i = 0; i < 120; i++) {
      s.pump(now);
      now += 1000 / 60;
    }
    const last = now - 1000 / 60;
    expect(ts).toHaveLength(Math.floor(((last - 100) * 30) / 1000 + 1e-9) + 1);
    expect(ts[0]).toBe(100);
  });

  it('anchors at the first pump and honours startDelayMs', async () => {
    const s = createSyntheticSource({ script, startDelayMs: 200 });
    const ts = collect(s);
    await s.start(ALL);
    s.pump(5000);
    expect(ts).toHaveLength(0);
    s.pump(5200);
    expect(ts).toEqual([5200]);
  });

  it('calls listeners synchronously inside pump, with seq incrementing', async () => {
    const s = createSyntheticSource({ script });
    const seqs: number[] = [];
    let inPump = false;
    s.subscribe((f) => {
      expect(inPump).toBe(true);
      seqs.push(f.seq);
    });
    await s.start(ALL);
    inPump = true;
    s.pump(0);
    s.pump(100);
    inPump = false;
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it('caps catch-up at 10 frames and drops the rest', async () => {
    const s = createSyntheticSource({ script });
    const ts = collect(s);
    await s.start(ALL);
    s.pump(0);
    s.pump(5000);
    expect(ts).toHaveLength(11);
    expect(s.stats.droppedFrames).toBeGreaterThan(100);
    s.pump(5000);
    expect(ts).toHaveLength(11);
    s.pump(5040);
    expect(ts).toHaveLength(12);
    expect(ts[11]).toBeCloseTo(5033.333, 2);
  });

  it('unsubscribe stops delivery', async () => {
    const s = createSyntheticSource({ script });
    let n = 0;
    const off = s.subscribe(() => n++);
    await s.start(ALL);
    s.pump(0);
    off();
    s.pump(500);
    expect(n).toBe(1);
  });

  it('sets finished at the end of a non-looping script and keeps emitting', async () => {
    const s = createSyntheticSource({ script });
    const ts = collect(s);
    await s.start(ALL);
    advance(s, 0, 990);
    expect(s.finished).toBe(false);
    s.pump(1000);
    expect(s.finished).toBe(true);
    const n = ts.length;
    s.pump(1100);
    expect(ts.length).toBeGreaterThan(n);
    expect(s.finished).toBe(true);
  });

  it('never finishes when looping and reports labels and script time', async () => {
    const s = createSyntheticSource({ script: { ...script, loop: true } });
    await s.start(ALL);
    advance(s, 0, 600);
    expect(s.currentLabel).toBe('two');
    expect(s.scriptTimeMs).toBeCloseTo(600, 0);
    s.pump(5000);
    s.pump(5600);
    expect(s.finished).toBe(false);
  });

  it('restarts script time at the next pump on setScript', async () => {
    const s = createSyntheticSource({ script });
    const ts = collect(s);
    await s.start(ALL);
    advance(s, 0, 1100);
    expect(s.finished).toBe(true);
    s.setScript({ name: 'again', steps: [{ dur: 300, label: 'x' }] });
    expect(s.finished).toBe(false);
    const before = ts.length;
    s.pump(2000);
    expect(ts[before]).toBe(2000);
    expect(s.scriptTimeMs).toBe(0);
    expect(s.currentLabel).toBe('x');
  });

  it('respects needs: no pose, no hands', async () => {
    const s = createSyntheticSource({ script });
    const seen: boolean[][] = [];
    s.subscribe((f) => seen.push([f.hasPose, f.hands[0].present, f.hands[1].present]));
    await s.start(ALL);
    s.pump(0);
    await s.setNeeds({ pose: false, handCrops: false, fullFrameHands: true });
    s.pump(34);
    await s.setNeeds({ pose: true, handCrops: false, fullFrameHands: false });
    s.pump(67);
    await s.setNeeds({ pose: true, handCrops: true, fullFrameHands: false });
    s.pump(100);
    expect(seen).toEqual([
      [true, true, true],
      [false, true, true],
      [true, false, false],
      [true, true, true],
    ]);
  });

  it('is a video-less synthetic source with sane stats', async () => {
    const s = createSyntheticSource({ script });
    expect(s.kind).toBe('synthetic');
    expect(s.video).toBeNull();
    await s.start(ALL);
    for (let t = 0; t <= 3000; t += 16) s.pump(t);
    expect(s.stats.trackingHz).toBeGreaterThan(29);
    expect(s.stats.trackingHz).toBeLessThan(31);
    expect(s.stats.delegate).toBe('none');
    expect(s.stats.inWorker).toBe(false);
    expect(s.stats.inferenceMs).toBe(0);
    expect(s.stats.latencyMs).toBe(0);
  });

  it('honours a custom fps', async () => {
    const s = createSyntheticSource({ script, fps: 60 });
    const ts = collect(s);
    await s.start(ALL);
    s.pump(0);
    s.pump(100);
    expect(ts).toHaveLength(7);
  });
});
