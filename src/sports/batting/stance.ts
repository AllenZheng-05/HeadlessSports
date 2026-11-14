import type { Side } from '../../input/types';
import type { AvatarRig } from '../../render/avatar/AvatarRig';
import type { BattingConfig } from './config';

/**
 * The batter's side-on stance and swing.
 *
 * The camera is behind the batter, looking at the pitcher. A right-handed batter stands in the box
 * on the screen-left side of the plate and faces screen right (chest toward the plate, front
 * shoulder toward the pitcher); a left-handed batter is the mirror image on the screen-right side.
 *
 * The player's own mirrored pose cannot drive this avatar: the player faces the camera, the batter
 * is turned 90 degrees. So while batting the arms are placed procedurally from the swing's timing
 * (the contact time and bat height the judge works out), in the batter's own frame:
 *   b  toward the back shoulder (world +z, toward the camera),
 *   u  up,
 *   f  toward the plate (world +x for a right-hander, -x for a left-hander).
 */

/** +1 for a right-handed batter (stands at -x, faces +x), -1 for a left-handed one. */
export const sideSign = (hand: Side): number => (hand === 'right' ? 1 : -1);

/** World x of the batter's feet: the screen-left side of the plate for a right-hander. */
export const batterX = (hand: Side, cfg: BattingConfig): number =>
  -sideSign(hand) * cfg.batterOffset;

/** World z of the batter: the middle of the plate, so the chest faces it. */
export const batterZ = (cfg: BattingConfig): number => cfg.plateZ + 0.22;

/** Yaw of the rig root so that the chest faces the plate. */
export const batterYaw = (hand: Side): number => (-sideSign(hand) * Math.PI) / 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (v: number): number => {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c * c * (3 - 2 * c);
};

// Keyframes in the batter's frame. Hands: grip centre (b, u, f). Bat direction: (db, du, df).
// Stance: hands up by the back shoulder, bat cocked over it. Contact: arms out toward the plate,
// the bat across it. Follow: hands wrapped round to the front shoulder, bat toward the pitcher.
const H0_B = 0.2;
const H0_U = 1.4;
const H0_F = 0.14;
const H1_B = -0.02;
const H1_F = 0.38;
const H2_B = -0.28;
const H2_U = 1.38;
const H2_F = 0.12;
const D0_B = 0.45;
const D0_U = 0.88;
const D0_F = 0.1;
const D1_B = -0.25;
const D1_F = 0.96;
const D2_B = -0.7;
const D2_U = 0.6;
const D2_F = 0.15;
/** Torso twist toward the pitcher (rad, before the handedness sign). */
const TW0 = -0.3;
const TW1 = 0.45;
const TW2 = 0.85;
/** The sweet spot is this far along the bat from the grip. */
const SWEET = 0.6;
const HAND_GAP = 0.05;
const REACH_MIN_U = 0.85;
const REACH_MAX_U = 1.35;

/** Where the hands and bat are, in world space, after `BatterPose.update`. */
export interface BatPlacement {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

export class BatterPose {
  /** Grip centre and unit bat direction in the world. */
  readonly bat: BatPlacement = { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0 };
  private readonly sg: number;
  private readonly bx: number;
  private readonly bz: number;
  private readonly back: Side;
  private readonly front: Side;
  // Smoothed pose: hb hu hf db du df tw.
  private readonly cur = new Float64Array(7);
  private ready = false;

  constructor(
    private readonly cfg: BattingConfig,
    hand: Side,
  ) {
    this.sg = sideSign(hand);
    this.bx = batterX(hand, cfg);
    this.bz = batterZ(cfg);
    this.back = hand;
    this.front = hand === 'right' ? 'left' : 'right';
  }

  /**
   * Place the arms and torso. `contactMs` is when the bat meets the ball (very negative: no swing
   * yet), `batHeight` the bat's height there (m), `waggle` 0..1 scales the stance's bat waggle.
   * No allocation.
   */
  update(
    rig: AvatarRig,
    nowMs: number,
    dt: number,
    contactMs: number,
    batHeight: number,
    waggle: number,
  ): void {
    const cfg = this.cfg;
    const tc = nowMs - contactMs;
    const s1 = smooth((tc + cfg.swingLeadMs) / cfg.swingLeadMs);
    const s2 = smooth(tc / 260);
    const s3 = smooth((tc - cfg.swingFollowMs) / cfg.swingReturnMs);
    const a = (1 - s1) * (1 - s3) + s3;
    const b = s1 * (1 - s2) * (1 - s3);
    const c = s2 * (1 - s3);

    // Hands at contact follow the bat height; the bat tilts to make up what the arms cannot reach.
    const hu = clamp(batHeight, REACH_MIN_U, REACH_MAX_U);
    const dy = clamp((batHeight - hu) / (SWEET + 0.02), -0.85, 0.5);
    const hz = Math.sqrt(1 - dy * dy);
    const norm = hz / Math.sqrt(D1_B * D1_B + D1_F * D1_F);

    const wag = waggle * cfg.waggle;
    const wb = wag * Math.sin(nowMs * 0.011);
    const wu = 0.5 * wag * Math.sin(nowMs * 0.0073 + 1);

    const t = this.cur;
    const tHb = H0_B * a + H1_B * b + H2_B * c;
    const tHu = H0_U * a + hu * b + H2_U * c;
    const tHf = H0_F * a + H1_F * b + H2_F * c;
    const tDb = D0_B * a + D1_B * norm * b + D2_B * c + wb * a;
    const tDu = D0_U * a + dy * b + D2_U * c + wu * a;
    const tDf = D0_F * a + D1_F * norm * b + D2_F * c;
    const tTw = TW0 * a + TW1 * b + TW2 * c;
    if (!this.ready) {
      this.ready = true;
      t[0] = tHb;
      t[1] = tHu;
      t[2] = tHf;
      t[3] = tDb;
      t[4] = tDu;
      t[5] = tDf;
      t[6] = tTw;
    } else {
      const k = 1 - Math.exp(-cfg.poseRate * (dt < 0 ? 0 : dt > 0.1 ? 0.1 : dt));
      t[0]! += (tHb - t[0]!) * k;
      t[1]! += (tHu - t[1]!) * k;
      t[2]! += (tHf - t[2]!) * k;
      t[3]! += (tDb - t[3]!) * k;
      t[4]! += (tDu - t[4]!) * k;
      t[5]! += (tDf - t[5]!) * k;
      t[6]! += (tTw - t[6]!) * k;
    }
    const hb = t[0]!;
    const hU = t[1]!;
    const hf = t[2]!;
    let db = t[3]!;
    let du = t[4]!;
    let df = t[5]!;
    const len = Math.sqrt(db * db + du * du + df * df);
    if (len > 1e-6) {
      db /= len;
      du /= len;
      df /= len;
    } else {
      db = 0;
      du = 1;
      df = 0;
    }

    const sg = this.sg;
    // Rig-local: x = sg * b, y = u, z = -f. The back hand is the top hand, nearer the barrel.
    rig.setArmTarget(
      this.back,
      sg * (hb + HAND_GAP * db),
      hU + HAND_GAP * du,
      -(hf + HAND_GAP * df),
      sg * 0.45,
      1.15,
      -0.05,
    );
    rig.setArmTarget(
      this.front,
      sg * (hb - HAND_GAP * db),
      hU - HAND_GAP * du,
      -(hf - HAND_GAP * df),
      -sg * 0.1,
      1.1,
      -0.3,
    );
    rig.setTorso(0, sg * t[6]!);

    const o = this.bat;
    o.x = this.bx + sg * hf;
    o.y = hU;
    o.z = this.bz + hb;
    o.dx = sg * df;
    o.dy = du;
    o.dz = db;
  }
}
