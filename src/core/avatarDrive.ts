import type { AvatarRig } from '../render/avatar/AvatarRig';
import type { InputState } from '../input/types';

/**
 * Mirror the player's upper body and mitt curl onto the rig, interpolating between the two
 * latest poses (alpha clamped to [0, maxAlpha]; pass maxAlpha > 1 during fast phases to
 * extrapolate a little). No allocation. Leaves the arms alone when the state has no pose, so an
 * animator clip or the last pose stays in place.
 */
export function mirrorUpperBody(
  avatar: AvatarRig,
  state: InputState,
  nowMs: number,
  maxAlpha = 1,
): void {
  if (state.hasPose && state.tracking) {
    const span = state.t - state.tPrev;
    let alpha = span > 0 ? (nowMs - state.t) / span : 1;
    if (alpha < 0) alpha = 0;
    else if (alpha > maxAlpha) alpha = maxAlpha;
    avatar.setUpperBodyFromPose(state.posePrev, state.pose, alpha, state.aspect);
  }
  avatar.setMittCurl('left', state.hands.left.closed ? 1 : 0);
  avatar.setMittCurl('right', state.hands.right.closed ? 1 : 0);
}
