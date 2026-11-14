import type { Side } from '../../input/types';
import type { BattingConfig } from './config';
import type { Pitch } from './pitch';

export type Quality = 'perfect' | 'good' | 'weak' | 'foul' | 'miss';
export type MissReason = 'early' | 'late' | 'under' | 'over';

/** The swing as the sport needs it: the SwingStarted event plus the SwingPeak speed when it came in time. */
export interface SwingInput {
  /** Game ms the swing began. Already lag-corrected by the recognizer, so it is in the past on arrival. */
  t: number;
  /** SwingStarted.speed, sw/s. */
  startSpeed: number;
  /** Hands relative to the shoulder line, sw, positive up. */
  height: number;
  /** SwingPeak.speed, sw/s, or null when no peak arrived within peakWaitMs. */
  peakSpeed: number | null;
}

export interface Judgement {
  quality: Quality;
  /** Why a miss missed; null for hits and fouls. */
  reason: MissReason | null;
  /** Game ms the bat meets (or passes) the ball: swing start plus batTravelMs. */
  contactMs: number;
  /** contactMs minus arrivalMs: negative is early. */
  timingError: number;
  /** Bat height at contact, metres. */
  batHeight: number;
  /** batHeight minus the ball height, metres. */
  heightError: number;
  launchDeg: number;
  /** 0..1. */
  power: number;
  exitSpeed: number;
  /** Degrees; positive sends the ball toward screen right (+x), negative toward screen left. */
  sprayDeg: number;
  /** Banner text. */
  label: string;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Does a swing starting at `t` belong to this pitch? From the start of the wind-up to the end of the late window. */
export function swingInWindow(pitch: Pitch, t: number, cfg: BattingConfig): boolean {
  return t >= pitch.windupStartMs && t <= pitch.arrivalMs + cfg.lateWindowMs;
}

/** Game time at which a pitch with no swing is called a strike: swing events arrive late, so wait for them. */
export function noSwingResolveMs(pitch: Pitch, cfg: BattingConfig): number {
  return pitch.arrivalMs + cfg.lateWindowMs + cfg.eventDelayAllowanceMs;
}

/** Timing band for an absolute timing error. 'miss' means beyond the foul band. */
export function timingQuality(absErrorMs: number, cfg: BattingConfig): Quality {
  if (absErrorMs <= cfg.perfectMs) return 'perfect';
  if (absErrorMs <= cfg.goodMs) return 'good';
  if (absErrorMs <= cfg.okMs) return 'weak';
  if (absErrorMs <= cfg.foulMs) return 'foul';
  return 'miss';
}

/** Hand height (sw above the shoulder line) to bat height (metres), clamped. */
export function batHeightM(heightSw: number, cfg: BattingConfig): number {
  return clamp(
    cfg.shoulderHeightM + heightSw * cfg.swToMetres - cfg.batDrop,
    cfg.batHeightMin,
    cfg.batHeightMax,
  );
}

/** Swing speed (sw/s) to power in [0, 1]. */
export function powerFromSpeed(speed: number, cfg: BattingConfig): number {
  return clamp((speed - cfg.powerFloor) / (cfg.powerCeil - cfg.powerFloor), 0, 1);
}

/** The peak speed when it arrived in time, otherwise the (lower) onset speed scaled up. */
export function swingPower(swing: SwingInput, cfg: BattingConfig): number {
  const speed = swing.peakSpeed ?? swing.startSpeed * cfg.startSpeedGain;
  return powerFromSpeed(speed, cfg);
}

/** A bat below the ball's centre lifts it, above drives it down. */
export function launchAngle(heightError: number, cfg: BattingConfig): number {
  return clamp(cfg.baseLaunch - heightError * cfg.launchPerMetre, cfg.launchMin, cfg.launchMax);
}

export function qualityFactor(q: Quality, cfg: BattingConfig): number {
  if (q === 'perfect') return cfg.qualityPerfect;
  if (q === 'good') return cfg.qualityGood;
  if (q === 'weak') return cfg.qualityWeak;
  return 0;
}

const sideSign = (hand: Side): number => (hand === 'right' ? 1 : -1);

function judgement(
  quality: Quality,
  reason: MissReason | null,
  label: string,
  contactMs: number,
  timingError: number,
  batHeight: number,
  heightError: number,
): Judgement {
  return {
    quality,
    reason,
    contactMs,
    timingError,
    batHeight,
    heightError,
    launchDeg: 0,
    power: 0,
    exitSpeed: 0,
    sprayDeg: 0,
    label,
  };
}

/**
 * Judge one swing against one pitch. Uses the swing's own timestamp (never the time the event
 * arrived), so a swing the tracker reports 150 ms late is judged exactly like a prompt one.
 * `hand` is the batter's handedness: a right-handed early swing pulls toward screen left.
 */
export function judgeSwing(
  cfg: BattingConfig,
  pitch: Pitch,
  swing: SwingInput,
  hand: Side,
): Judgement {
  const contactMs = swing.t + cfg.batTravelMs;
  const timingError = contactMs - pitch.arrivalMs;
  const batHeight = batHeightM(swing.height, cfg);
  const heightError = batHeight - pitch.ty;
  const abs = Math.abs(timingError);
  const quality = timingQuality(abs, cfg);
  const mk = (q: Quality, reason: MissReason | null, label: string): Judgement =>
    judgement(q, reason, label, contactMs, timingError, batHeight, heightError);

  // A swing started after the wind-up but well before the release is always early.
  if (quality === 'miss' || swing.t < pitch.releaseMs - 200) {
    return timingError < 0 ? mk('miss', 'early', 'Too early') : mk('miss', 'late', 'Too late');
  }
  if (Math.abs(heightError) > cfg.missHeight) {
    return heightError < 0 ? mk('miss', 'under', 'Under it') : mk('miss', 'over', 'Over it');
  }
  const pull = timingError < 0 ? -1 : 1; // -1 early, +1 late
  const handSign = sideSign(hand);
  if (quality === 'foul') {
    const j = mk('foul', null, 'Foul');
    j.sprayDeg = pull * cfg.foulSprayDeg * handSign;
    return j;
  }
  const j = mk(quality, null, quality === 'perfect' ? 'Perfect!' : 'Good hit');
  if (quality === 'weak') j.label = 'Weak contact';
  j.launchDeg = launchAngle(heightError, cfg);
  j.power = swingPower(swing, cfg);
  const base = cfg.minExit + (cfg.maxExit - cfg.minExit) * j.power;
  j.exitSpeed = base * qualityFactor(quality, cfg);
  j.sprayDeg = clamp(timingError * cfg.sprayPerMs * handSign, -cfg.sprayMax, cfg.sprayMax);
  return j;
}
