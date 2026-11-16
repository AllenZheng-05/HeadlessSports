import type { Coach } from '../sport';

const noop = (): void => undefined;
const noopUnregister = (): void => undefined;

/** A coach that does nothing: what a sport gets when it is not running its tutorial. */
export const NO_COACH: Coach = {
  show: noop,
  setFeedback: noop,
  confirm: noop,
  onSkip: () => noopUnregister,
  hide: noop,
};
