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
 *   call    the catcher sets up, then the call appears (pitch type and spot); nothing is accepted
 *           until the player has had time to read it
 *   sign    hold the throwing hand still: closed = fastball, open = curve (no clock to beat)
 *   windup  the called cell is lit; the first valid throw is the pitch (or a balk after the clock)
 *   flight  the ball travels to the plate
 *   result  the points are shown, then the next call
 */
export type Phase = 'call' | 'sign' | 'windup' | 'flight' | 'result' | 'done';
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
  /** The pitch the player picked for this pitch (fastball until one is picked). */
  kind: PitchKind;
  /** The pitch the catcher called. */
  called: PitchKind;
  /** The call is showing (from the reveal until the release). */
  bubbleOn: boolean;
  /** Multiplier on the timing gaps (the short round shortens them). */
  readonly gapScale: number;
  /** Extra setup time before this call, ms (the first pitch gets a longer beat). */
  extraMs: number;
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
  callSeq: number;
  revealSeq: number;
  selectSeq: number;
  windupSeq: number;
  releaseSeq: number;
  resultSeq: number;
  nextSeq: number;
  doneSeq: number;
  readonly debug: boolean;
  /** Mouse play: no sign step; the pitch is picked with buttons and thrown with press and release. */
  readonly mouse: boolean;
  readonly random: () => number;
  /** Scratch, so nothing allocates per step. */
  readonly scratch: Point;
}

export const pitchesFor = (cfg: PitchingConfig, short: boolean): number =>
  Math.max(1, Math.round(short ? cfg.shortPitches : cfg.pitches));

export function createGame(
  total: number,
  random: () => number,
  debug = false,
  gapScale = 1,
  firstExtraMs = 0,
  curveShare = 0.45,
  mouse = false,
): GameState {
  const g: GameState = {
    phase: 'call',
    index: 0,
    total: Math.max(1, total),
    kind: 'fastball',
    called: 'fastball',
    bubbleOn: false,
    gapScale,
    extraMs: firstExtraMs * gapScale,
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
    callSeq: 0,
    revealSeq: 0,
    selectSeq: 0,
    windupSeq: 0,
    releaseSeq: 0,
    resultSeq: 0,
    nextSeq: 0,
    doneSeq: 0,
    debug,
    mouse,
    random,
    scratch: { x: 0, y: 0 },
  };
  startCall(g, curveShare);
  return g;
}

/** The catcher picks the next pitch and spot (seeded, so a seed always gives the same calls). */
export function startCall(g: GameState, curveShare: number): void {
  g.called = g.random() < curveShare ? 'curve' : 'fastball';
  g.target = pickTarget(g.random, g.lastTarget);
  g.lastTarget = g.target;
  g.bubbleOn = false;
  // Mouse play: fastball unless the player clicks the curveball.
  if (g.mouse) g.kind = 'fastball';
  g.callSeq++;
  setPhase(g, 'call');
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
    called: g.called,
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

/** Whether the mouse pitch buttons work now: from when the call appears until the release. */
export const canPick = (g: GameState): boolean =>
  g.mouse && ((g.phase === 'call' && g.bubbleOn) || g.phase === 'windup');

/** Mouse play: pick the pitch type. Ignored outside the call and the wind-up. */
export function pickKind(g: GameState, kind: PitchKind): boolean {
  if (!canPick(g)) return false;
  g.kind = kind;
  return true;
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
    case 'call': {
      const reveal = cfg.callSetupMs * g.gapScale + g.extraMs;
      if (!g.bubbleOn && g.phaseMs >= reveal) {
        g.bubbleOn = true;
        g.revealSeq++;
      }
      if (g.mouse) {
        // No sign step: the wind-up opens a short beat after the call appears, with the
        // currently picked pitch (the buttons keep working until the release).
        if (g.bubbleOn && g.phaseMs >= reveal + cfg.mouseReactMs * g.gapScale) {
          select(g, cfg, g.kind, false);
          g.lockoutMs = 0;
        }
        return;
      }
      if (g.bubbleOn && g.phaseMs >= reveal + cfg.callReactMs * g.gapScale) {
        g.reading = 'none';
        g.holdMs = 0;
        g.stillTotalMs = 0;
        setPhase(g, 'sign');
      }
      return;
    }
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
      if (g.phaseMs < cfg.betweenPitchesMs * g.gapScale) return;
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
        g.extraMs = 0;
        g.nextSeq++;
        startCall(g, cfg.curveShare);
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
  live: Aim | null = null,
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
  if (live !== null) {
    // The pitch goes where the aim indicator was pointing at the release time.
    const dx = g.kind === 'curve' ? e.curvature * cfg.curvatureGain : 0;
    g.aim.rawX = live.rawX + dx;
    g.aim.rawY = live.rawY;
    g.aim.x = live.x + dx * (1 - cfg.assist);
    g.aim.y = live.y;
  }
  g.score = scorePitch(cfg, g.aim.x, g.aim.y, g.target, g.kind, g.aim.scoredKmh, g.called);
  g.flightMs = flightSeconds(cfg, g.aim.kmh) * 1000;
  g.flightElapsedMs = latencyProgress(cfg, nowMs, e.t, g.flightMs) * g.flightMs;
  g.balk = false;
  g.releaseSeq++;
  g.bubbleOn = false;
  setPhase(g, 'flight');
  return 'taken';
}
