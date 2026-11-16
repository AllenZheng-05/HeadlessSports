import { describe, expect, it } from 'vitest';
import { cameraOnSearch, parseFlags } from './flags';

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
      short: false,
      hand: null,
      tutorial: false,
      players: 1,
      names: null,
      hands: null,
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
      short: false,
      hand: null,
      tutorial: false,
      players: 1,
      names: null,
      hands: null,
    });
  });

  it('reads the tutorial flag', () => {
    expect(parseFlags('?sport=climbing&tutorial=1').tutorial).toBe(true);
    expect(parseFlags('?tutorial=0').tutorial).toBe(false);
    expect(parseFlags('?tutorial=true').tutorial).toBe(false);
  });

  it('reads players (2 to 4) and names for a direct pass-and-play start', () => {
    expect(parseFlags('?sport=archery&players=3').players).toBe(3);
    expect(parseFlags('?players=9').players).toBe(4);
    expect(parseFlags('?players=1').players).toBe(1);
    expect(parseFlags('?players=abc').players).toBe(1);
    expect(parseFlags('?players=2.5').players).toBe(1);
    expect(parseFlags('?players=3&names=Mia,Sam').names).toEqual(['Mia', 'Sam']);
    expect(parseFlags('').names).toBeNull();
  });

  it('reads ?hands= as one side per seat, unknown entries kept as gaps', () => {
    expect(parseFlags('?players=3&hands=r,l,r').hands).toEqual(['right', 'left', 'right']);
    expect(parseFlags('?hands=Left,RIGHT').hands).toEqual(['left', 'right']);
    expect(parseFlags('?hands=l,,x').hands).toEqual(['left', null, null]);
    expect(parseFlags('').hands).toBeNull();
    expect(parseFlags('?hands=').hands).toBeNull();
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

  it('parses the hand flag', () => {
    expect(parseFlags('hand=left').hand).toBe('left');
    expect(parseFlags('hand=right').hand).toBe('right');
    expect(parseFlags('hand=both').hand).toBeNull();
    expect(parseFlags('').hand).toBeNull();
  });

  it('forces timeScale to 1 for the camera', () => {
    expect(parseFlags('timeScale=8').timeScale).toBe(1);
    expect(parseFlags('source=camera&timeScale=8').timeScale).toBe(1);
  });
});

describe('cameraOnSearch', () => {
  it('drops the camera-off choice and keeps every other flag', () => {
    expect(cameraOnSearch('?input=debug&sport=bowling&hand=left')).toBe('?sport=bowling&hand=left');
    expect(cameraOnSearch('?input=debug')).toBe('');
    expect(cameraOnSearch('')).toBe('');
    expect(cameraOnSearch('?debug=1')).toBe('?debug=1');
  });
});
