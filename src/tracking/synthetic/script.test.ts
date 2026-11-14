import { describe, expect, it } from 'vitest';
import { defaultControls } from './controls';
import { ScriptPlayer } from './script';
import type { Script } from './script';

const out = defaultControls();

describe('ScriptPlayer', () => {
  const script: Script = {
    name: 't',
    start: { centreX: 0.2 },
    steps: [
      { dur: 1000, to: { centreX: 0.8 }, ease: 'linear', label: 'a' },
      { dur: 500, to: { centreX: 0.4, lean: 1 }, ease: 'in', label: 'b' },
      { dur: 500, label: 'c' },
    ],
  };

  it('reports its duration', () => {
    expect(new ScriptPlayer(script).durationMs).toBe(2000);
  });

  it('interpolates and hits the end points of every ease', () => {
    const p = new ScriptPlayer(script);
    p.sample(0, out);
    expect(out.centreX).toBeCloseTo(0.2);
    p.sample(500, out);
    expect(out.centreX).toBeCloseTo(0.5);
    p.sample(999.999, out);
    expect(out.centreX).toBeCloseTo(0.8, 3);
    // 'in' is quadratic: a quarter of the way at half time.
    p.sample(1250, out);
    expect(out.centreX).toBeCloseTo(0.8 + (0.4 - 0.8) * 0.25, 5);
    expect(out.lean).toBeCloseTo(0.25, 5);
    p.sample(1500, out);
    expect(out.centreX).toBeCloseTo(0.4);
    expect(out.lean).toBeCloseTo(1);
  });

  it('smooth and out eases are monotonic with correct end points', () => {
    for (const ease of ['smooth', 'out'] as const) {
      const p = new ScriptPlayer({ name: ease, steps: [{ dur: 100, to: { lean: 1 }, ease }] });
      let prev = -1;
      for (let t = 0; t <= 100; t += 5) {
        p.sample(t, out);
        expect(out.lean).toBeGreaterThanOrEqual(prev);
        prev = out.lean;
      }
      p.sample(0, out);
      expect(out.lean).toBe(0);
      p.sample(100, out);
      expect(out.lean).toBe(1);
      p.sample(50, out);
      if (ease === 'smooth') expect(out.lean).toBeCloseTo(0.5);
      else expect(out.lean).toBeCloseTo(0.75);
    }
  });

  it('clamps before the start and after the end', () => {
    const p = new ScriptPlayer(script);
    p.sample(-50, out);
    expect(out.centreX).toBeCloseTo(0.2);
    p.sample(99999, out);
    expect(out.centreX).toBeCloseTo(0.4);
    expect(out.lean).toBeCloseTo(1);
  });

  it('wraps when looping', () => {
    const p = new ScriptPlayer({ ...script, loop: true });
    const a = defaultControls();
    p.sample(500, out);
    p.sample(2500, a);
    expect(a.centreX).toBeCloseTo(out.centreX);
    p.sample(-1500, a);
    expect(a.centreX).toBeCloseTo(out.centreX);
  });

  it('labels the active step, and is empty outside the script', () => {
    const p = new ScriptPlayer(script);
    expect(p.labelAt(0)).toBe('a');
    expect(p.labelAt(999)).toBe('a');
    expect(p.labelAt(1000)).toBe('b');
    expect(p.labelAt(1600)).toBe('c');
    expect(p.labelAt(2000)).toBe('');
    expect(p.labelAt(-1)).toBe('');
    expect(new ScriptPlayer({ ...script, loop: true }).labelAt(2100)).toBe('a');
  });

  it('starts from the defaults for controls the script never names', () => {
    const p = new ScriptPlayer(script);
    p.sample(300, out);
    expect(out.shoulderY).toBe(defaultControls().shoulderY);
  });

  it('rejects steps without a positive duration', () => {
    expect(() => new ScriptPlayer({ name: 'bad', steps: [{ dur: 0 }] })).toThrow();
  });

  it('copes with an empty script', () => {
    const p = new ScriptPlayer({ name: 'empty', steps: [] });
    p.sample(100, out);
    expect(out.centreX).toBe(0.5);
    expect(p.labelAt(0)).toBe('');
  });
});
