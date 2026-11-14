/** Pure rules, no three.js and no DOM: easy to unit test. */
export interface WarmupState {
  count: number;
  elapsed: number;
  done: boolean;
}

export interface WarmupLimits {
  fistsToWin: number;
  timeLimitS: number;
}

export function createWarmupState(): WarmupState {
  return { count: 0, elapsed: 0, done: false };
}

/** A fist closed. Ignored once the round is done. */
export function onFist(state: WarmupState, limits: WarmupLimits): void {
  if (state.done) return;
  state.count++;
  if (state.count >= limits.fistsToWin) state.done = true;
}

/** Advance the clock by `dt` seconds. The clock stops when the round is done. */
export function tick(state: WarmupState, dt: number, limits: WarmupLimits): void {
  if (state.done) return;
  state.elapsed += dt;
  if (state.elapsed >= limits.timeLimitS) {
    state.elapsed = limits.timeLimitS;
    state.done = true;
  }
}

export function isWon(state: WarmupState, limits: WarmupLimits): boolean {
  return state.count >= limits.fistsToWin;
}
