/** The single parser for query flags (see CLAUDE.md). */

export interface Flags {
  /** `?input=debug`: keyboard and mouse instead of camera. */
  input: 'camera' | 'debug';
  /** `?source=` */
  source: 'camera' | 'synthetic' | 'replay';
  /** `?script=` */
  script: string | null;
  /** `?clip=` */
  clip: string | null;
  /** `?renderer=webgl` */
  renderer: 'webgpu' | 'webgl';
  /** `?pose=full` */
  pose: 'lite' | 'full';
  /** `?skipGate=1` */
  skipGate: boolean;
  /** `?timeScale=`, clamped 0.1..16, forced to 1 unless the source is synthetic or replay. */
  timeScale: number;
  /** `?debug=1` */
  debug: boolean;
  /** `?main=1` forces main-thread tracking. */
  mainThread: boolean;
  /** `?sport=<id>` jumps straight into a sport. */
  sport: string | null;
  /** `?seed=`, default 1. */
  seed: number;
  /** `?short=1`: sports play a shortened round (for headless checks and quick tries). */
  short: boolean;
  /** `?hand=left|right`: default dominant hand for keyboard and mouse play. Null when absent. */
  hand: 'left' | 'right' | null;
}

export const TIME_SCALE_MIN = 0.1;
export const TIME_SCALE_MAX = 16;

function text(params: URLSearchParams, key: string): string | null {
  const v = params.get(key);
  return v === null || v === '' ? null : v;
}

export function parseFlags(search: string | URLSearchParams): Flags {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;

  const sourceRaw = params.get('source');
  const source: Flags['source'] =
    sourceRaw === 'synthetic' || sourceRaw === 'replay' ? sourceRaw : 'camera';

  const scaleRaw = params.get('timeScale');
  const scale = scaleRaw === null || scaleRaw === '' ? NaN : Number(scaleRaw);
  let timeScale = 1;
  if (source !== 'camera' && Number.isFinite(scale)) {
    timeScale = Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, scale));
  }

  const seedRaw = params.get('seed');
  const seedNum = seedRaw === null || seedRaw === '' ? NaN : Number(seedRaw);

  const handRaw = params.get('hand');

  return {
    input: params.get('input') === 'debug' ? 'debug' : 'camera',
    source,
    script: text(params, 'script'),
    clip: text(params, 'clip'),
    renderer: params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu',
    pose: params.get('pose') === 'full' ? 'full' : 'lite',
    skipGate: params.get('skipGate') === '1',
    timeScale,
    debug: params.get('debug') === '1',
    mainThread: params.get('main') === '1',
    sport: text(params, 'sport'),
    seed: Number.isFinite(seedNum) ? seedNum : 1,
    short: params.get('short') === '1',
    hand: handRaw === 'left' || handRaw === 'right' ? handRaw : null,
  };
}
