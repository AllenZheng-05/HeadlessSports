import type { Side } from '../../input/types';
import { aimPitch, createAim } from './aim';
import type { Aim, PitchKind } from './aim';
import type { PitchingConfig } from './config';
import { flightSeconds, latencyProgress } from './flight';
import { BALK_SCORE, scorePitch } from './scoring';
import type { PitchRecord, PitchScore } from './scoring';
import { CELLS, cellCentre } from './zone';
import type { Point } from './zone';

/**
 * The pitching rules: a phase machine per pitch, pure (no three.js, no clock of its own). Time
 * advances only through `stepGame(dt)`, so a paused round freezes every timer.
 *
 *   sign    hold the throwing hand still: closed = fastball, open = curve
 *   windup  one cell is lit; the first valid throw is the pitch (or a balk after the pitch clock)
 *   flight  the ball travels to the plate
 *   result  the points are shown, then the next pitch
 */
export type Phase = 'sign' | 'windup' | 'flight' | 'result' | 'done';
export type Reading = PitchKind | 'none';

/** The throwing hand as the rules see it. Filled in place by the sport. */
export interface HandInput {
  present: boolean;
  known: boolean;
  closed: boolean;
  /** Wrist speed, sw/s. */
  speed: number;
}

export interface ThrowInput {
  t: number;
  hand: Side;
  speed: number;
  vy: number;
  lateral: number;
  curvature: number;
  style: 'overarm' | 'underarm';
}

export type ThrowOutcome =
  'taken' | 'paused' | 'wrong-hand' | 'phase' | 'lockout' | 'slow' | 'style';

export interface IgnoredCounts {
  paused: number;
  wrongHand: number;
  phase: number;
  lockout: number;
  slow: number;
  style: number;
}

export interface GameState {
  phase: Phase;
  /** Zero-based index of the pitch in progress. */
  index: number;
  total: number;
  /** The pitch picked for this pitch (fastball until one is picked). */
  kind: PitchKind;
  /** What the hand says right now, during `sign`. */
  reading: Reading;
  /** Still time with an unchanged reading, ms. */
  holdMs: number;
  /** Total still time with a hand that cannot be read, ms. */
  stillTotalMs: number;
  /** The last selection came from the fallback, not from the hand. */
  usedFallback: boolean;
  lockoutMs: number;
  /** Time in `windup`, ms. */
  windupMs: number;
  target: number;
  lastTarget: number;
  /** Time in the current phase, ms. */
  phaseMs: number;
  flightMs: number;
  flightElapsedMs: number;
  /** The current pitch's aim and score (valid from `flight` on). */
  aim: Aim;
  score: PitchScore;
  /** The current pitch is a balk. */
  balk: boolean;
  records: PitchRecord[];
  ignored: IgnoredCounts;
  // Counters the sport compares with what it has already handled.
  selectSeq: number;
  windupSeq: number;
  releaseSeq: number;
  resultSeq: number;
  nextSeq: number;
  doneSeq: number;
  readonly debug: boolean;
  readonly random: () => number;
  /** Scratch, so nothing allocates per step. */
  readonly scratch: Point;
}

export const pitchesFor = (cfg: PitchingConfig, short: boolean): number =>
  Math.max(1, Math.round(short ? cfg.shortPitches : cfg.pitches));

export function createGame(total: number, random: () => number, debug = false): GameState {
  return {
    phase: 'sign',
    index: 0,
    total: Math.max(1, total),
    kind: 'fastball',
    reading: 'none',
    holdMs: 0,
    stillTotalMs: 0,
    usedFallback: false,
    lockoutMs: 0,
    windupMs: 0,
    target: -1,
    lastTarget: -1,
    phaseMs: 0,
    flightMs: 1,
    flightElapsedMs: 0,
    aim: createAim(),
    score: BALK_SCORE,
    balk: false,
    records: [],
    ignored: { paused: 0, wrongHand: 0, phase: 0, lockout: 0, slow: 0, style: 0 },
    selectSeq: 0,
    windupSeq: 0,
    releaseSeq: 0,
    resultSeq: 0,
    nextSeq: 0,
    doneSeq: 0,
    debug,
    random,
    scratch: { x: 0, y: 0 },
  };
}

export const totalIgnored = (g: GameState): number => {
  const i = g.ignored;
  return i.paused + i.wrongHand + i.phase + i.lockout + i.slow + i.style;
};

/** A new target cell, never the same as the last one. */
export function pickTarget(random: () => number, last: number): number {
  let c = Math.min(CELLS - 1, Math.floor(random() * CELLS));
  if (c === last) c = (c + 1 + Math.min(CELLS - 2, Math.floor(random() * (CELLS - 1)))) % CELLS;
  return c;
}

const setPhase = (g: GameState, phase: Phase): void => {
  g.phase = phase;
  g.phaseMs = 0;
};

function select(g: GameState, cfg: PitchingConfig, kind: PitchKind, fallback: boolean): void {
  g.kind = kind;
  g.usedFallback = fallback;
  g.lockoutMs = cfg.throwLockoutMs;
  g.windupMs = 0;
  g.target = pickTarget(g.random, g.lastTarget);
  g.lastTarget = g.target;
  g.selectSeq++;
  g.windupSeq++;
  setPhase(g, 'windup');
}

/** Close the pitch: record it and show the result. Allocates one record per pitch, which is fine. */
function resolve(g: GameState, cfg: PitchingConfig): void {
  cellCentre(cfg, g.target, g.scratch);
  const miss = g.balk ? 0 : Math.hypot(g.aim.x - g.scratch.x, g.aim.y - g.scratch.y);
  g.records.push({
    index: g.index,
    kind: g.kind,
    target: g.target,
    balk: g.balk,
    x: g.balk ? 0 : g.aim.x,
    y: g.balk ? 0 : g.aim.y,
    kmh: g.balk ? 0 : g.aim.kmh,
    score: g.score,
    missM: miss,
  });
  g.resultSeq++;
  setPhase(g, 'result');
}

/** What the throwing hand says: a fist is a fastball, an open hand a curve, `none` when unknown. */
export function readHand(h: HandInput): Reading {
  if (!h.present || !h.known) return 'none';
  return h.closed ? 'fastball' : 'curve';
}

/** Advance the rules by `dt` seconds. A paused round freezes every timer. */
export function stepGame(
  g: GameState,
  cfg: PitchingConfig,
  dt: number,
  hand: HandInput,
  paused: boolean,
): void {
  if (paused || g.phase === 'done') return;
  const ms = dt * 1000;
  g.phaseMs += ms;
  switch (g.phase) {
    case 'sign': {
      const reading = readHand(hand);
      const still = hand.speed < cfg.signStillSpeed;
      if (reading !== g.reading) {
        g.reading = reading;
        g.holdMs = 0;
      }
      if (!still) {
        g.holdMs = 0;
        return;
      }
      if (reading !== 'none') {
        g.holdMs += ms;
        if (g.holdMs >= cfg.signHoldMs) select(g, cfg, reading, false);
      } else {
        g.holdMs = 0;
        g.stillTotalMs += ms;
        if (g.stillTotalMs >= cfg.signFallbackMs) select(g, cfg, 'fastball', true);
      }
      return;
    }
    case 'windup': {
      if (g.lockoutMs > 0) g.lockoutMs = Math.max(0, g.lockoutMs - ms);
      g.windupMs += ms;
      if (g.windupMs >= cfg.pitchClockS * 1000) {
        g.balk = true;
        g.score = BALK_SCORE;
        resolve(g, cfg);
      }
      return;
    }
    case 'flight': {
      g.flightElapsedMs += ms;
      if (g.flightElapsedMs >= g.flightMs) resolve(g, cfg);
      return;
    }
    case 'result': {
      if (g.phaseMs < cfg.betweenPitchesMs) return;
      g.index++;
      if (g.index >= g.total) {
        g.doneSeq++;
        setPhase(g, 'done');
      } else {
        g.reading = 'none';
        g.holdMs = 0;
        g.stillTotalMs = 0;
        g.usedFallback = false;
        g.balk = false;
        g.nextSeq++;
        setPhase(g, 'sign');
      }
      return;
    }
    default:
      return;
  }
}

/**
 * A ThrowReleased from the tracker at game time `nowMs`. Takes the first valid one in `windup`:
 * aims it, scores it, and starts the flight as of the release time (capped by the latency rule).
 */
export function onThrow(
  g: GameState,
  cfg: PitchingConfig,
  nowMs: number,
  e: ThrowInput,
  throwingHand: Side,
  paused: boolean,
): ThrowOutcome {
  const ig = g.ignored;
  if (paused) {
    ig.paused++;
    return 'paused';
  }
  if (e.hand !== throwingHand) {
    ig.wrongHand++;
    return 'wrong-hand';
  }
  if (g.phase !== 'windup') {
    ig.phase++;
    return 'phase';
  }
  if (g.lockoutMs > 0) {
    ig.lockout++;
    return 'lockout';
  }
  if (e.speed < cfg.minThrowSpeed) {
    ig.slow++;
    return 'slow';
  }
  if (!cfg.acceptAnyStyle && e.style !== 'overarm') {
    ig.style++;
    return 'style';
  }
  aimPitch(cfg, e, throwingHand, g.kind, g.target, g.debug, g.aim, g.scratch);
  g.score = scorePitch(cfg, g.aim.x, g.aim.y, g.target, g.kind, g.aim.scoredKmh);
  g.flightMs = flightSeconds(cfg, g.aim.kmh) * 1000;
  g.flightElapsedMs = latencyProgress(cfg, nowMs, e.t, g.flightMs) * g.flightMs;
  g.balk = false;
  g.releaseSeq++;
  setPhase(g, 'flight');
  return 'taken';
}
