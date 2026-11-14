// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { SoundName } from '../core/sport';
import { createAudioKit } from './audio';

const NAMES: SoundName[] = [
  'select',
  'tick',
  'grab',
  'release',
  'whoosh',
  'thud',
  'clatter',
  'good',
  'great',
  'bad',
  'cheer',
];

describe('audio kit', () => {
  it('play before unlock is a silent no-op', () => {
    const audio = createAudioKit();
    for (const n of NAMES) expect(() => audio.play(n, { pitch: 1.2, volume: 0.5 })).not.toThrow();
    audio.dispose();
  });

  it('unlock without an AudioContext does not throw', () => {
    const audio = createAudioKit();
    expect(() => audio.unlock()).not.toThrow();
    expect(() => audio.play('select')).not.toThrow();
    audio.setMuted(true);
    expect(() => audio.play('cheer')).not.toThrow();
    audio.dispose();
  });

  it('a user gesture triggers unlock without errors', () => {
    const audio = createAudioKit();
    expect(() => document.dispatchEvent(new Event('pointerdown'))).not.toThrow();
    audio.dispose();
  });
});
