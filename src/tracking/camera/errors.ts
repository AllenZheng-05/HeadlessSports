import type { TrackingError, TrackingErrorCode } from '../types';

export function createTrackingError(
  code: TrackingErrorCode,
  message: string,
  cause?: unknown,
): TrackingError {
  const err = new Error(message, cause === undefined ? undefined : { cause }) as TrackingError;
  err.name = 'TrackingError';
  err.code = code;
  return err;
}

export function isTrackingError(err: unknown): err is TrackingError {
  return err instanceof Error && typeof (err as Partial<TrackingError>).code === 'string';
}

/** Maps a getUserMedia rejection to a TrackingError. */
export function mapCameraError(err: unknown): TrackingError {
  if (isTrackingError(err)) return err;
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return createTrackingError('camera-denied', 'Camera permission was denied.', err);
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return createTrackingError('camera-missing', 'No camera was found.', err);
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return createTrackingError('camera-in-use', 'The camera is in use by another app.', err);
    default:
      return createTrackingError(
        'unsupported',
        `Camera failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
  }
}

export const MIN_CAMERA_WIDTH = 640;
export const MIN_CAMERA_HEIGHT = 360;

export function checkResolution(width: number, height: number): TrackingError | null {
  if (width < MIN_CAMERA_WIDTH || height < MIN_CAMERA_HEIGHT) {
    return createTrackingError(
      'camera-low-resolution',
      `Camera resolution ${width}x${height} is below ${MIN_CAMERA_WIDTH}x${MIN_CAMERA_HEIGHT}.`,
    );
  }
  return null;
}
