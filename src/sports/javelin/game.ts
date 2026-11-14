import type { JavelinConfig } from './config';
import {
  createFlight,
  releaseAngleDeg,
  releaseSpeed,
  startDrop,
  startFlight,
  stepFlight,
} from './distance';
import type { Flight } from './distance';
import { approachSpeed, effectiveCadence, targetRunSpeed } from './runSpeed';

/**
 * The javelin round as an explicit state machine. Pure: no three.js, no DOM, no input provider.
 * The sport feeds it step and throw events and reads back counters to react to. There is no start
 * gesture and no hand state: the javelin is always in the throwing hand, the run starts by itself
 * after a short get-ready beat, and one big arm motion releases it.
 *
 *   ready -> run -> flight -> result -> (ready | done)
 */
export type Phase = 'ready' | 'run' | 'flight' | 'result' | 'done';

export interface AttemptRecord {
  foul: boolean;
  /** Metres from the line (0 for a foul). */
  distance: number;
  /** Run speed at the release, m/s. */
  runSpeed: number;
  /** Wrist speed at the release, sw/s. */
  throwSpeed: number;
  angleDeg: number;
  /** Metres between the release point and the line (negative past it). */
  lineGap: number;
  why: 'throw' | 'crossed';
}

export interface ThrowInput {
  /** Game ms of the release itself (the event arrives later). */
  t: number;
  hand: 'left' | 'right';
  /** Wrist speed, sw/s. */
  speed: number;
  /** Wrist vertical velocity, sw/s, positive up. */
  vy: number;
  style: 'overarm' | 'underarm';
}

export interface GameState {
  phase: Phase;
  /** Number of attempts started so far minus one: the current attempt, 0-based. */
  attempt: number;
  total: number;
  /** Metres from the start of the runway. */
  position: number;
  /** Ground speed, m/s. */
  speed: number;
  /** Seconds in the current phase. */
  phaseT: number;
  /** Seconds since the run started. */
  runT: number;
  /** Game ms the run started, and until when throws are ignored. */
  startMs: number;
  lockoutUntilMs: number;
  /** Instantaneous step rate from the last few step events, steps/s (0 when not running). */
  cadence: number;
  /** The cadence after the decay since the last step: what drives the run speed, steps/s. */
  cadenceNow: number;
  /** Game ms of the last step event. */
  lastStepMs: number;
  idleHint: boolean;
  /** Seconds spent beyond the line plus overrun without a throw. */
  crossT: number;
  flight: Flight;
  /** The current flight is a foul (thrown past the line, or dropped). */
  flightFoul: boolean;
  /** Where the current flight was released from, and how it was thrown. */
  release: { x: number; runSpeed: number; throwSpeed: number; angleDeg: number; lineGap: number };
  records: AttemptRecord[];
  /** Best valid distance, 0 when there is none yet. */
  best: number;
  bestIndex: number;
  /** Distance of the attempt that just landed (0 for a foul). */
  lastDistance: number;
  lastFoul: boolean;
  // Event counters: the sport compares them with what it has already handled.
  startSeq: number;
  releaseSeq: number;
  landSeq: number;
  nextSeq: number;
  doneSeq: number;
  ignoredThrows: number;
  /** The current flight is a javelin dropped at the line (crossed without throwing). */
  dropped: boolean;
}

export function createGame(attempts: number): GameState {
  return {
    phase: 'ready',
    attempt: 0,
    total: Math.max(1, attempts),
    position: 0,
    speed: 0,
    phaseT: 0,
    runT: 0,
    startMs: 0,
    lockoutUntilMs: 0,
    cadence: 0,
    cadenceNow: 0,
    lastStepMs: -1e9,
    idleHint: false,
    crossT: 0,
    flight: createFlight(),
    flightFoul: false,
    release: { x: 0, runSpeed: 0, throwSpeed: 0, angleDeg: 0, lineGap: 0 },
    records: [],
    best: 0,
    bestIndex: -1,
    lastDistance: 0,
    lastFoul: false,
    startSeq: 0,
    releaseSeq: 0,
    landSeq: 0,
    nextSeq: 0,
    doneSeq: 0,
    ignoredThrows: 0,
    dropped: false,
  };
}

export function attemptsFor(cfg: JavelinConfig, short: boolean): number {
  return short ? cfg.shortAttempts : cfg.attempts;
}

export function distanceToLine(s: GameState, cfg: JavelinConfig): number {
  return cfg.runwayLength - s.position;
}

function begin(s: GameState, cfg: JavelinConfig, nowMs: number): void {
  s.phase = 'run';
  s.phaseT = 0;
  s.runT = 0;
  s.crossT = 0;
  s.startMs = nowMs;
  s.lockoutUntilMs = nowMs + cfg.throwLockoutMs;
  s.idleHint = false;
  s.startSeq++;
}

/**
 * A `Step` event. The step rate is the reciprocal of the interval to the previous step, blended
 * with the running value, so one faster step already raises the target speed. A long gap starts
 * the average afresh.
 */
export function onStep(s: GameState, cfg: JavelinConfig, t: number): void {
  const dt = t - s.lastStepMs;
  if (dt < cfg.stepMinMs) return;
  if (dt <= cfg.stepMaxMs) {
    const inst = Math.min(cfg.maxCadence, 1000 / dt);
    s.cadence = s.cadence > 0 ? s.cadence + (inst - s.cadence) * cfg.cadenceBlend : inst;
  } else {
    s.cadence = 0;
  }
  s.lastStepMs = t;
}

/**
 * Wrist speed a throw needs, sw/s. It rises with the run speed, so the arms pumping in time with
 * the steps stay clearly below it while a deliberate overhand throw clears it.
 */
export function requiredThrowSpeed(s: GameState, cfg: JavelinConfig): number {
  const f = Math.max(0, Math.min(1, s.speed / cfg.maxRunSpeed));
  return cfg.minThrowSpeed + cfg.pumpMargin * f;
}

/**
 * The throw a mouse click makes (keyboard and mouse play): a fixed good wrist speed, with the loft
 * from the pointer height (top of the screen throws high), like the T key's mouse loft.
 */
export function clickThrow(
  cfg: JavelinConfig,
  t: number,
  hand: 'left' | 'right',
  pointerY: number,
): ThrowInput {
  const loft = Math.max(0, Math.min(1.4, (0.5 - pointerY) * 1.6 + 0.6));
  return {
    t,
    hand,
    speed: cfg.clickThrowSpeed,
    vy: cfg.clickThrowSpeed * Math.sin(loft),
    style: 'overarm',
  };
}

/**
 * A `ThrowReleased` arrived. `nowMs` is the time it is processed; the athlete's release point is
 * stepped back by speed * (nowMs - event.t) so latency costs neither distance nor a false foul.
 * Returns true when the throw was taken.
 */
export function onThrow(
  s: GameState,
  cfg: JavelinConfig,
  nowMs: number,
  ev: ThrowInput,
  throwHand: 'left' | 'right',
): boolean {
  if (s.phase !== 'run' || ev.hand !== throwHand) return false;
  if (ev.t < s.lockoutUntilMs || nowMs < s.lockoutUntilMs) {
    s.ignoredThrows++;
    return false;
  }
  if (ev.speed < requiredThrowSpeed(s, cfg)) return false;
  if (!cfg.acceptAnyStyle && ev.style !== 'overarm') return false;

  const delay = Math.max(0, Math.min(cfg.maxLatencyS, (nowMs - ev.t) / 1000));
  const x0 = Math.max(0, s.position - s.speed * delay);
  const angle = releaseAngleDeg(cfg, ev.vy, ev.speed);
  const v = releaseSpeed(cfg, s.speed, ev.speed);
  const gap = cfg.runwayLength - x0;
  s.release.x = x0;
  s.release.runSpeed = s.speed;
  s.release.throwSpeed = ev.speed;
  s.release.angleDeg = angle;
  s.release.lineGap = gap;
  s.flightFoul = gap < 0;
  s.dropped = false;
  startFlight(s.flight, cfg, x0, v, angle);
  s.phase = 'flight';
  s.phaseT = 0;
  s.releaseSeq++;
  return true;
}

function land(s: GameState, cfg: JavelinConfig): void {
  const foul = s.flightFoul;
  const measured = Math.max(0, s.flight.x - cfg.runwayLength);
  const rec: AttemptRecord = {
    foul,
    distance: foul ? 0 : measured,
    runSpeed: s.release.runSpeed,
    throwSpeed: s.release.throwSpeed,
    angleDeg: s.release.angleDeg,
    lineGap: s.release.lineGap,
    why: s.dropped ? 'crossed' : 'throw',
  };
  s.records.push(rec);
  if (!foul && rec.distance > s.best) {
    s.best = rec.distance;
    s.bestIndex = s.records.length - 1;
  }
  s.lastDistance = rec.distance;
  s.lastFoul = foul;
  s.phase = 'result';
  s.phaseT = 0;
  s.landSeq++;
}

function nextAttempt(s: GameState): void {
  s.attempt++;
  s.phase = 'ready';
  s.phaseT = 0;
  s.runT = 0;
  s.position = 0;
  s.speed = 0;
  s.cadence = 0;
  s.cadenceNow = 0;
  s.lastStepMs = -1e9;
  s.idleHint = false;
  s.nextSeq++;
}

/** Advance the rules by `dt` seconds. */
export function stepGame(
  s: GameState,
  cfg: JavelinConfig,
  dt: number,
  nowMs: number,
  amplitude: number,
): void {
  s.phaseT += dt;
  s.cadenceNow = effectiveCadence(s.cadence, nowMs - s.lastStepMs, cfg);
  switch (s.phase) {
    case 'ready':
      // No gesture to start: a short get-ready beat, then the run begins.
      if (s.phaseT * 1000 >= cfg.readyMs) begin(s, cfg, nowMs);
      break;
    case 'run': {
      s.runT += dt;
      const target = targetRunSpeed(s.cadenceNow, amplitude, cfg);
      s.speed = approachSpeed(s.speed, target, dt, cfg);
      s.position += s.speed * dt;
      s.idleHint = s.runT > cfg.idleTimeoutS && s.position < cfg.idleMoveM;
      if (s.position >= cfg.runwayLength + cfg.overrun) s.crossT += dt;
      if (s.crossT >= cfg.crossGraceS && s.position >= cfg.runwayLength + cfg.overrun) {
        // Crossed the line without throwing: foul, the javelin drops from the hand.
        s.release.x = s.position;
        s.release.runSpeed = s.speed;
        s.release.throwSpeed = 0;
        s.release.angleDeg = 0;
        s.release.lineGap = cfg.runwayLength - s.position;
        s.flightFoul = true;
        s.dropped = true;
        startDrop(s.flight, s.position, 1.5, 2);
        s.phase = 'flight';
        s.phaseT = 0;
        s.releaseSeq++;
      }
      break;
    }
    case 'flight':
      plant(s, cfg, dt);
      stepFlight(s.flight, cfg, dt);
      if (s.flight.landed) land(s, cfg);
      break;
    case 'result': {
      plant(s, cfg, dt);
      const last = s.attempt + 1 >= s.total;
      const ms = last ? cfg.finishDelayMs : cfg.betweenAttemptsMs;
      if (s.phaseT * 1000 >= ms) {
        if (last) {
          s.phase = 'done';
          s.phaseT = 0;
          s.doneSeq++;
        } else {
          nextAttempt(s);
        }
      }
      break;
    }
    case 'done':
      break;
  }
}

function plant(s: GameState, cfg: JavelinConfig, dt: number): void {
  if (s.speed <= 0) return;
  s.speed = Math.max(0, s.speed - cfg.plantDecel * dt);
  s.position += s.speed * dt;
}

/** Tidy per-attempt lines for the results screen. */
export function attemptLine(i: number, r: AttemptRecord): string {
  if (r.foul) return `${i + 1}: Foul`;
  return `${i + 1}: ${r.distance.toFixed(2)} m`;
}
