import type { GateCapabilities } from './types';

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i;

function detectWebgl2(win: Window): boolean {
  try {
    const canvas = win.document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function detectTouchPrimary(win: Window): boolean {
  const nav = win.navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile === true) return true;
  if (MOBILE_UA.test(nav.userAgent ?? '')) return true;
  if (typeof win.matchMedia !== 'function') return false;
  return win.matchMedia('(pointer: coarse)').matches && !win.matchMedia('(hover: hover)').matches;
}

export function detectCapabilities(win: Window = window): GateCapabilities {
  return {
    webgl2: detectWebgl2(win),
    cameraApi: typeof win.navigator.mediaDevices?.getUserMedia === 'function',
    workers: typeof (win as unknown as { Worker?: unknown }).Worker === 'function',
    touchPrimary: detectTouchPrimary(win),
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
  };
}
