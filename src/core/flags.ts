/** The single parser for query flags (see CLAUDE.md). */

import { MAX_PLAYERS, parseHands, parseNames } from './multiplayer/players';

export interface Flags {
  /** `?input=debug`: mouse instead of camera. */
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
  /** `?hand=left|right`: default dominant hand for mouse play. Null when absent. */
  hand: 'left' | 'right' | null;
  /** `?tutorial=1`: the direct-start sport (`?sport=`) opens in tutorial mode, when it has one. */
  tutorial: boolean;
  /** `?players=2..4` with `?sport=`: start a pass-and-play game with default names. 1 when absent. */
  players: number;
  /** `?names=Mia,Sam`: seat names for `?players=`. Null when absent. */
  names: string[] | null;
  /** `?hands=r,l,r`: dominant hand per seat for `?players=` (mouse, synthetic, replay). Null when absent. */
  hands: ('left' | 'right' | null)[] | null;
}

export const TIME_SCALE_MIN = 0.1;
export const TIME_SCALE_MAX = 16;

/** `?players=` as 2..4, or 1 for anything else. */
function playersFlag(raw: string | null): number {
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 2 ? Math.min(MAX_PLAYERS, n) : 1;
}

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
    tutorial: params.get('tutorial') === '1',
    players: playersFlag(params.get('players')),
    names: parseNames(params.get('names')),
    hands: parseHands(params.get('hands')),
  };
}

/**
 * The query string for "Turn camera on": the same flags, minus the camera-off choice
 * (`input=debug`). Returns '' or a string starting with '?'.
 */
export function cameraOnSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('input');
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}
