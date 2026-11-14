import { describe, expect, it } from 'vitest';
import { parseFlags } from '../core/flags';
import { createLandmarkSource } from './createSource';

describe('createLandmarkSource', () => {
  it('uses the idle script by default for synthetic', async () => {
    const source = await createLandmarkSource(parseFlags('source=synthetic'));
    expect(source.kind).toBe('synthetic');
    expect(source.video).toBeNull();
  });

  it('builds a named script', async () => {
    const source = await createLandmarkSource(parseFlags('source=synthetic&script=wave'));
    expect(source.kind).toBe('synthetic');
  });

  it('rejects an unknown script', async () => {
    await expect(createLandmarkSource(parseFlags('source=synthetic&script=nope'))).rejects.toThrow(
      /Unknown script "nope"/,
    );
  });

  it('rejects an unknown or missing clip', async () => {
    await expect(createLandmarkSource(parseFlags('source=replay&clip=nope'))).rejects.toThrow(
      /nope/,
    );
    await expect(createLandmarkSource(parseFlags('source=replay'))).rejects.toThrow(/clip/);
  });
});
