import { describe, expect, it } from 'vitest';
import { OneEuroBank, OneEuroFilter } from './oneEuro';

const DT = 1000 / 30;

describe('OneEuroFilter', () => {
  it('leaves a constant input unchanged', () => {
    const f = new OneEuroFilter(1, 1);
    for (let i = 0; i < 100; i++) expect(f.filter(0.4, i * DT)).toBeCloseTo(0.4, 6);
  });

  it('passes the first sample through', () => {
    const f = new OneEuroFilter(1, 0);
    expect(f.filter(0.7, 5000)).toBe(0.7);
  });

  it('converges after a step', () => {
    const f = new OneEuroFilter(1, 0);
    f.filter(0, 0);
    let out = 0;
    for (let i = 1; i <= 60; i++) out = f.filter(1, i * DT);
    expect(out).toBeGreaterThan(0.99);
  });

  it('attenuates alternating jitter by at least 5x', () => {
    const f = new OneEuroFilter(1, 0);
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      const out = f.filter(i % 2 === 0 ? 0.01 : -0.01, i * DT);
      if (i > 50) peak = Math.max(peak, Math.abs(out));
    }
    expect(peak).toBeLessThan(0.01 / 5);
  });

  it('is safe with dt = 0 and negative dt', () => {
    const f = new OneEuroFilter(1, 5);
    f.filter(0, 1000);
    const a = f.filter(1, 1033);
    expect(f.filter(5, 1033)).toBe(a);
    expect(f.filter(5, 900)).toBe(a);
    expect(Number.isFinite(f.filter(NaN, 1100))).toBe(true);
    expect(Number.isFinite(f.filter(1, 1100))).toBe(true);
  });

  it('higher beta lags less on a fast ramp', () => {
    const lag = (beta: number): number => {
      const f = new OneEuroFilter(1, beta);
      let err = 0;
      for (let i = 0; i < 90; i++) {
        const v = (i * DT) / 1000;
        err = v - f.filter(v, i * DT);
      }
      return err;
    };
    expect(lag(30)).toBeLessThan(lag(0));
  });
});

describe('OneEuroBank', () => {
  it('matches independent filters and honours stride and components', () => {
    const bank = new OneEuroBank(4, 1, 2);
    const a = new OneEuroFilter(1, 2);
    const b = new OneEuroFilter(1, 2);
    const input = new Float32Array(6);
    const out = new Float32Array(6).fill(-1);
    for (let i = 0; i < 20; i++) {
      input[0] = Math.sin(i);
      input[1] = Math.cos(i);
      input[3] = i * 0.1;
      input[4] = -i * 0.1;
      bank.filterInto(input, i * DT, out, 3, 2);
      const ea = a.filter(input[0], i * DT);
      const eb = b.filter(input[1], i * DT);
      expect(out[0]).toBeCloseTo(ea, 5);
      expect(out[1]).toBeCloseTo(eb, 5);
      expect(out[2]).toBe(-1);
    }
  });

  it('supports in-place filtering and per-channel params', () => {
    const bank = new OneEuroBank(2, 1, 0);
    bank.setChannelParams(1, 100, 0);
    const buf = new Float32Array(2);
    bank.filterInto(buf, 0, buf);
    buf[0] = 1;
    buf[1] = 1;
    bank.filterInto(buf, DT, buf);
    expect(buf[1]).toBeGreaterThan(buf[0]);
  });

  it('returns previous output on a stalled clock', () => {
    const bank = new OneEuroBank(1, 1, 0);
    const out = new Float32Array(1);
    bank.filterInto(new Float32Array([0]), 0, out);
    bank.filterInto(new Float32Array([1]), DT, out);
    const prev = out[0];
    bank.filterInto(new Float32Array([9]), DT, out);
    expect(out[0]).toBe(prev);
    bank.filterInto(new Float32Array([9]), 0, out);
    expect(out[0]).toBe(prev);
  });
});
