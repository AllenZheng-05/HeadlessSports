import { describe, expect, it } from 'vitest';
import { checkResolution, createTrackingError, mapCameraError } from './errors';

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('mapCameraError', () => {
  it('maps the standard getUserMedia failures', () => {
    expect(mapCameraError(named('NotAllowedError')).code).toBe('camera-denied');
    expect(mapCameraError(named('NotFoundError')).code).toBe('camera-missing');
    expect(mapCameraError(named('NotReadableError')).code).toBe('camera-in-use');
  });
  it('passes TrackingErrors through and falls back to unsupported', () => {
    const own = createTrackingError('worker-failed', 'x');
    expect(mapCameraError(own)).toBe(own);
    expect(mapCameraError(named('Weird')).code).toBe('unsupported');
    expect(mapCameraError('str').code).toBe('unsupported');
  });
});

describe('checkResolution', () => {
  it('rejects small streams', () => {
    expect(checkResolution(320, 240)?.code).toBe('camera-low-resolution');
    expect(checkResolution(640, 360)).toBeNull();
    expect(checkResolution(1280, 720)).toBeNull();
  });
});
