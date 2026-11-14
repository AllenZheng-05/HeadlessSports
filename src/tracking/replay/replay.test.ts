import { describe, expect, it } from 'vitest';
import { createSyntheticSource } from '../synthetic/SyntheticSource';
import { getScript } from '../synthetic/scripts';
import { createEmptyFrame } from '../synthetic/body';
import type { LandmarkClip, LandmarkFrame, LandmarkSource, TrackerNeeds } from '../types';
import { listClips, loadClip } from './library';
import { createReplaySource } from './ReplaySource';
import { LandmarkRecorder, scriptToClip, validateClip } from './recorder';

const ALL: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: true };

interface Copy {
  t: number;
  hasPose: boolean;
  pose: Float32Array;
  present: [boolean, boolean];
  hands: [Float32Array, Float32Array];
}

function copyOf(f: LandmarkFrame): Copy {
  return {
    t: f.t,
    hasPose: f.hasPose,
    pose: Float32Array.from(f.pose),
    present: [f.hands[0].present, f.hands[1].present],
    hands: [Float32Array.from(f.hands[0].landmarks), Float32Array.from(f.hands[1].landmarks)],
  };
}

/** Pump a stepped source in 16 ms steps from 0 to `to` and copy every frame. */
async function drain(source: LandmarkSource, to: number, from = 0): Promise<Copy[]> {
  const out: Copy[] = [];
  source.subscribe((f) => out.push(copyOf(f)));
  await source.start(ALL);
  for (let t = from; t < to; t += 16) source.pump(t);
  source.pump(to);
  return out;
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe('recorder and replayer', () => {
  it('round trips a synthetic script through a clip within 1e-4', async () => {
    const script = getScript('bowl');
    expect(script).not.toBeNull();
    if (!script) return;
    const clip = validateClip(scriptToClip(script, { seed: 4 }));
    expect(clip.origin).toBe('synthetic');
    expect(clip.version).toBe(1);
    expect(clip.frames[0].t).toBe(0);
    expect(clip.needs.pose).toBe(true);

    const live = createSyntheticSource({ script, noise: { seed: 4 } });
    const original = await drain(live, clip.frames[clip.frames.length - 1].t);
    const replayed = await drain(createReplaySource(clip), clip.frames[clip.frames.length - 1].t);
    expect(replayed).toHaveLength(clip.frames.length);
    expect(original).toHaveLength(clip.frames.length);
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(replayed[i].t - original[i].t)).toBeLessThan(1e-3);
      expect(replayed[i].hasPose).toBe(original[i].hasPose);
      expect(maxDiff(replayed[i].pose, original[i].pose)).toBeLessThan(1e-4);
      for (const h of [0, 1] as const) {
        expect(replayed[i].present[h]).toBe(original[i].present[h]);
        if (original[i].present[h]) {
          expect(maxDiff(replayed[i].hands[h], original[i].hands[h])).toBeLessThan(1e-4);
        }
      }
    }
  });

  it('round trips the hands-only script with no pose', async () => {
    const script = getScript('hands');
    if (!script) throw new Error('hands script missing');
    const clip = scriptToClip(script);
    expect(clip.needs).toEqual({ pose: false, handCrops: false, fullFrameHands: true });
    expect(clip.frames.every((f) => f.pose === null && f.world === null)).toBe(true);
    const frames = await drain(createReplaySource(clip), 500);
    expect(frames.every((f) => !f.hasPose && f.present[0] && f.present[1])).toBe(true);
  });

  it('replays a null pose as hasPose false and a null hand as not present', async () => {
    const script = getScript('lost');
    if (!script) throw new Error('lost script missing');
    const clip = scriptToClip(script);
    expect(clip.frames.some((f) => f.pose === null)).toBe(true);
    const frames = await drain(createReplaySource(clip), clip.frames[clip.frames.length - 1].t);
    expect(frames.map((f) => f.hasPose)).toEqual(clip.frames.map((f) => f.pose !== null));
    expect(frames.some((f) => !f.present[0] && !f.present[1])).toBe(true);
  });

  it('writes numbers rounded to 4 decimals and timestamps relative to the first frame', async () => {
    const source = createSyntheticSource({
      script: { name: 'x', steps: [{ dur: 300, to: { lean: 0.2 } }] },
    });
    const recorder = new LandmarkRecorder(source);
    expect(recorder.recording).toBe(false);
    await source.start(ALL);
    source.pump(1000);
    recorder.start('rounded');
    expect(recorder.recording).toBe(true);
    for (let t = 1000; t <= 1300; t += 16) source.pump(t);
    expect(recorder.frameCount).toBeGreaterThan(5);
    const clip = recorder.stop();
    expect(recorder.recording).toBe(false);
    expect(clip.name).toBe('rounded');
    expect(clip.frames[0].t).toBe(0);
    expect(clip.frames[1].t).toBeCloseTo(33.3333, 3);
    const rounded = (v: number): boolean => Math.round(v * 1e4) / 1e4 === v;
    expect(clip.frames[0].pose?.every(rounded)).toBe(true);
    expect(clip.frames[0].hands[0]?.every(rounded)).toBe(true);
    expect(clip.frames[0].pose).toHaveLength(132);
    expect(clip.frames[0].world).toHaveLength(99);
    // Stopped: no more frames are captured.
    const n = clip.frames.length;
    source.pump(2000);
    expect(clip.frames).toHaveLength(n);
  });

  it("marks origin 'camera' for camera sources", () => {
    const listeners: ((f: LandmarkFrame) => void)[] = [];
    const fake: LandmarkSource = {
      kind: 'camera',
      video: null,
      stats: createSyntheticSource({ script: { name: 'x', steps: [] } }).stats,
      start: () => Promise.resolve(),
      setNeeds: () => Promise.resolve(),
      pump: () => undefined,
      subscribe: (l) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
      stop: () => undefined,
    };
    const rec = new LandmarkRecorder(fake);
    rec.start('cam');
    const f = createEmptyFrame();
    f.t = 500;
    f.hasPose = true;
    for (const l of listeners) l(f);
    f.t = 533;
    f.hasPose = false;
    for (const l of listeners) l(f);
    const clip = rec.stop();
    expect(listeners).toHaveLength(0);
    expect(clip.origin).toBe('camera');
    expect(clip.frames.map((x) => x.t)).toEqual([0, 33]);
    expect(clip.frames[1].pose).toBeNull();
  });
});

describe('ReplaySource', () => {
  function makeClip(): LandmarkClip {
    const script = getScript('idle');
    if (!script) throw new Error('idle missing');
    return scriptToClip({ ...script, steps: [{ dur: 300 }] });
  }

  it('finishes after the last frame and delivers exactly the clip frames', async () => {
    const clip = makeClip();
    const src = createReplaySource(clip);
    expect(src.kind).toBe('replay');
    expect(src.video).toBeNull();
    const frames = await drain(src, 5000, 700);
    expect(frames).toHaveLength(clip.frames.length);
    expect(frames[0].t).toBe(700);
    expect(src.finished).toBe(true);
  });

  it('loops when asked and never finishes', async () => {
    const clip = makeClip();
    const src = createReplaySource(clip, { loop: true });
    const frames = await drain(src, 2000);
    expect(frames.length).toBeGreaterThan(clip.frames.length * 4);
    expect(src.finished).toBe(false);
    for (let i = 1; i < frames.length; i++) expect(frames[i].t).toBeGreaterThan(frames[i - 1].t);
  });

  it('caps catch-up at 10 frames per pump', async () => {
    const clip = scriptToClip({ name: 'long', steps: [{ dur: 5000 }] });
    const src = createReplaySource(clip);
    const frames: number[] = [];
    src.subscribe((f) => frames.push(f.t));
    await src.start(ALL);
    src.pump(0);
    src.pump(4000);
    expect(frames).toHaveLength(11);
    src.pump(4000);
    expect(frames).toHaveLength(11);
    src.pump(4100);
    expect(frames.length).toBeGreaterThan(11);
    expect(frames[11]).toBeGreaterThan(4000);
  });

  it('restarts on setClip and honours needs', async () => {
    const clip = makeClip();
    const src = createReplaySource(clip);
    const seen: Copy[] = [];
    src.subscribe((f) => seen.push(copyOf(f)));
    await src.start({ pose: false, handCrops: false, fullFrameHands: false });
    src.pump(0);
    expect(seen[0].hasPose).toBe(false);
    expect(seen[0].present).toEqual([false, false]);
    src.setClip(clip);
    expect(src.finished).toBe(false);
    src.pump(100);
    expect(seen[1].t).toBe(100);
  });
});

describe('validateClip', () => {
  function good(): LandmarkClip {
    return scriptToClip({ name: 'g', steps: [{ dur: 100 }] });
  }

  it('accepts a good clip, including after a JSON round trip', () => {
    const clip = good();
    expect(validateClip(clip)).toBe(clip);
    expect(() => validateClip(JSON.parse(JSON.stringify(clip)))).not.toThrow();
  });

  it('rejects malformed input with clear messages', () => {
    const mutate = (fn: (c: LandmarkClip & Record<string, unknown>) => void): unknown => {
      const c = JSON.parse(JSON.stringify(good())) as LandmarkClip & Record<string, unknown>;
      fn(c);
      return c;
    };
    expect(() => validateClip(null)).toThrow(/not an object/);
    expect(() => validateClip([])).toThrow(/not an object/);
    expect(() => validateClip(mutate((c) => ((c as { version: number }).version = 2)))).toThrow(
      /version/,
    );
    expect(() => validateClip(mutate((c) => (c.origin = 'x' as 'camera')))).toThrow(/origin/);
    expect(() => validateClip(mutate((c) => (c.aspect = 0)))).toThrow(/aspect/);
    expect(() => validateClip(mutate((c) => (c.needs = {} as TrackerNeeds)))).toThrow(/needs/);
    expect(() => validateClip(mutate((c) => ((c as Record<string, unknown>).frames = 5)))).toThrow(
      /frames/,
    );
    expect(() => validateClip(mutate((c) => c.frames[0].pose?.pop()))).toThrow(/pose/);
    expect(() => validateClip(mutate((c) => c.frames[0].world?.push(1)))).toThrow(/world/);
    expect(() => validateClip(mutate((c) => (c.frames[0].hands[1] = [1, 2, 3])))).toThrow(
      /hands\[1\]/,
    );
    expect(() => validateClip(mutate((c) => ((c.frames[1] as { t: number }).t = -5)))).toThrow(
      /backwards/,
    );
    expect(() =>
      validateClip(mutate((c) => ((c.frames[0].pose as number[])[3] = Number.NaN))),
    ).toThrow(/finite/);
    expect(() =>
      validateClip(mutate((c) => ((c.frames[0] as { hands: unknown }).hands = [null]))),
    ).toThrow(/hands/);
  });
});

describe('library', () => {
  it('lists recorded clips (possibly none) and rejects unknown names', async () => {
    expect(Array.isArray(listClips())).toBe(true);
    await expect(loadClip('definitely-not-a-clip')).rejects.toThrow(/No recorded clip/);
  });
});
