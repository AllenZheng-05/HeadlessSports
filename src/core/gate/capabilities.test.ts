// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from './capabilities';

function stubMedia(coarse: boolean, hover: boolean): void {
  vi.stubGlobal('matchMedia', (q: string): { matches: boolean } => ({
    matches: q.includes('coarse') ? coarse : q.includes('hover: hover') ? hover : false,
  }));
  window.matchMedia = globalThis.matchMedia;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectCapabilities', () => {
  it('reads the viewport and desktop pointer', () => {
    stubMedia(false, true);
    const c = detectCapabilities(window);
    expect(c.touchPrimary).toBe(false);
    expect(c.viewportWidth).toBe(window.innerWidth);
    expect(c.viewportHeight).toBe(window.innerHeight);
    expect(c.workers).toBe(typeof Worker === 'function');
  });
  it('flags a coarse pointer without hover as touch primary', () => {
    stubMedia(true, false);
    expect(detectCapabilities(window).touchPrimary).toBe(true);
  });
  it('does not flag a coarse pointer that can hover', () => {
    stubMedia(true, true);
    expect(detectCapabilities(window).touchPrimary).toBe(false);
  });
  it('flags a mobile user agent', () => {
    stubMedia(false, true);
    const fake = {
      ...window,
      document: window.document,
      matchMedia: window.matchMedia,
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', mediaDevices: undefined },
      innerWidth: 400,
      innerHeight: 800,
    } as unknown as Window;
    const c = detectCapabilities(fake);
    expect(c.touchPrimary).toBe(true);
    expect(c.cameraApi).toBe(false);
  });
});
