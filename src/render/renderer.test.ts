import { describe, expect, it } from 'vitest';
import { rendererKindFromQuery } from './renderer';

describe('rendererKindFromQuery', () => {
  it('defaults to webgpu', () => {
    expect(rendererKindFromQuery(new URLSearchParams(''))).toBe('webgpu');
    expect(rendererKindFromQuery(new URLSearchParams('renderer=other'))).toBe('webgpu');
  });
  it('switches to webgl', () => {
    expect(rendererKindFromQuery(new URLSearchParams('?renderer=webgl'))).toBe('webgl');
  });
});
