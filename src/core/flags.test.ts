import { describe, expect, it } from 'vitest';
import { parseFlags } from './flags';

describe('parseFlags', () => {
  it('has sensible defaults', () => {
    expect(parseFlags('')).toEqual({
      input: 'camera',
      source: 'camera',
      script: null,
      clip: null,
      renderer: 'webgpu',
      pose: 'lite',
      skipGate: false,
      timeScale: 1,
      debug: false,
      mainThread: false,
      sport: null,
      seed: 1,
    });
  });

  it('parses each flag', () => {
    const f = parseFlags(
      '?input=debug&source=synthetic&script=wave&clip=c&renderer=webgl&pose=full&skipGate=1&debug=1&main=1&sport=bowling&seed=7&timeScale=4',
    );
    expect(f).toEqual({
      input: 'debug',
      source: 'synthetic',
      script: 'wave',
      clip: 'c',
      renderer: 'webgl',
      pose: 'full',
      skipGate: true,
      timeScale: 4,
      debug: true,
      mainThread: true,
      sport: 'bowling',
      seed: 7,
    });
  });

  it('accepts URLSearchParams and the replay source', () => {
    const f = parseFlags(new URLSearchParams('source=replay&clip=x'));
    expect(f.source).toBe('replay');
    expect(f.clip).toBe('x');
  });

  it('ignores unknown values', () => {
    const f = parseFlags('source=bogus&renderer=metal&pose=huge&input=touch&seed=abc');
    expect(f.source).toBe('camera');
    expect(f.renderer).toBe('webgpu');
    expect(f.pose).toBe('lite');
    expect(f.input).toBe('camera');
    expect(f.seed).toBe(1);
  });

  it('clamps timeScale for stepped sources', () => {
    expect(parseFlags('source=synthetic&timeScale=100').timeScale).toBe(16);
    expect(parseFlags('source=replay&timeScale=0.01').timeScale).toBe(0.1);
    expect(parseFlags('source=synthetic&timeScale=nope').timeScale).toBe(1);
    expect(parseFlags('source=synthetic&timeScale=2.5').timeScale).toBe(2.5);
  });

  it('forces timeScale to 1 for the camera', () => {
    expect(parseFlags('timeScale=8').timeScale).toBe(1);
    expect(parseFlags('source=camera&timeScale=8').timeScale).toBe(1);
  });
});
