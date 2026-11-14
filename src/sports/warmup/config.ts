/** Every threshold and timing of the sport lives in one mutable object (registered as tunables). */
export const warmupConfig = {
  fistsToWin: 5,
  timeLimitS: 30,
  /** Pause between the last fist and the results screen, seconds. */
  finishDelayS: 1.2,
};
export type WarmupConfig = typeof warmupConfig;
