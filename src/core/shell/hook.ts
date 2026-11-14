import type { DebugInput } from '../../input/debug/DebugInput';
import type { Flags } from '../flags';
import type { RoundResult } from '../sport';

export type GamePhase =
  | 'boot'
  | 'gate'
  | 'gate-fail'
  | 'title'
  | 'camera'
  | 'menu'
  | 'howto'
  | 'calibration'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'results'
  | 'error';

/** `window.__game`: always on, read by Playwright. One object, fields assigned in place. */
export interface GameHook {
  phase: GamePhase;
  sportId: string | null;
  result: RoundResult | null;
  isBest: boolean | null;
  /** Rendered frames since boot. */
  frames: number;
  inputKind: 'camera' | 'synthetic' | 'replay' | 'debug' | null;
  drawCalls: number;
  /** renderer.info.memory, assigned in place each frame. */
  rendererMemory: { geometries: number; textures: number };
  error: string | null;
  /** For Playwright to call press / release / moveTo. */
  debugInput: DebugInput | null;
  /** The live Sport object. */
  sport: unknown;
  flags: Flags;
}

declare global {
  interface Window {
    __game: GameHook;
  }
}

export function createHook(flags: Flags): GameHook {
  return {
    phase: 'boot',
    sportId: null,
    result: null,
    isBest: null,
    frames: 0,
    inputKind: null,
    drawCalls: 0,
    rendererMemory: { geometries: 0, textures: 0 },
    error: null,
    debugInput: null,
    sport: null,
    flags,
  };
}
