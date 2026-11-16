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
  /**
   * Wrist horizontal velocity, sw/s, positive toward screen right (when known). With it a release
   * that is mostly straight up (an arm lift, not a throw) is refused.
   */
  vx?: number;
  style: 'overarm' | 'underarm';
  /** Distance the wrist covered from the start of the throw to the peak, sw (when known). */
  travel?: number;
  /** Highest the wrist was above its shoulder in the 400 ms before the peak, sw (when known). */
  topY?: number;
}

/** Why the last `ThrowReleased` was not taken ('' for none). */
export type ThrowRefusal = '' | 'hand' | 'slow' | 'low' | 'short' | 'up';

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
  /** Why the last refused throw was refused, and a counter that rises with each (for a hint). */
  refusal: ThrowRefusal;
  refusalSeq: number;
  /** The current flight is a javelin dropped at the line (crossed without throwing). */
  dropped: boolean;
  /** Tutorial only: throws are not taken (a step that is only about running). */
  noThrow: boolean;
  /** Tutorial only: a throw is measured from where it was released, not from the foul line. */
  standing: boolean;
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
    refusal: '',
    refusalSeq: 0,
    dropped: false,
    noThrow: false,
    standing: false,
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
 * The throw a mouse release makes (mouse play): a fixed good wrist speed and a fixed loft. The
 * only skill is when the button is let go. The 2D release direction that maps to `mouseLoftDeg`
 * is the inverse of `releaseAngleDeg`.
 */
export function mouseThrow(cfg: JavelinConfig, t: number, hand: 'left' | 'right'): ThrowInput {
  const span = Math.max(1e-6, cfg.proxyHigh - cfg.proxyLow);
  const range = Math.max(1e-6, cfg.maxAngle - cfg.minAngle);
  const frac = Math.max(0, Math.min(1, (cfg.mouseLoftDeg - cfg.minAngle) / range));
  const s = cfg.proxyLow + span * Math.pow(frac, 1 / Math.max(1e-6, cfg.angleCurve));
  return { t, hand, speed: cfg.mouseThrowSpeed, vy: s * cfg.mouseThrowSpeed, style: 'overarm' };
}

/**
 * The button was let go: throw at once with the fixed mouse throw. The get-ready lockout does not
 * apply (a very short tap still throws). Returns true when the throw was taken.
 */
export function onMouseRelease(
  s: GameState,
  cfg: JavelinConfig,
  nowMs: number,
  hand: 'left' | 'right',
): boolean {
  if (s.phase !== 'run') return false;
  s.lockoutUntilMs = 0;
  return onThrow(s, cfg, nowMs, mouseThrow(cfg, nowMs, hand), hand);
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
  if (s.phase !== 'run' || s.noThrow) return false;
  const required = requiredThrowSpeed(s, cfg);
  if (ev.hand !== throwHand) {
    // The other arm pumping gives small releases all the time; only a real overarm throw is said.
    const locked = ev.t < s.lockoutUntilMs || nowMs < s.lockoutUntilMs;
    if (!locked && ev.speed >= required && ev.style === 'overarm') refuse(s, 'hand');
    return false;
  }
  if (ev.t < s.lockoutUntilMs || nowMs < s.lockoutUntilMs) {
    s.ignoredThrows++;
    return false;
  }
  // Overarm: the wrist above the shoulder at the peak, or at some moment just before it.
  const overarm = ev.style === 'overarm' || (ev.topY !== undefined && ev.topY >= cfg.minThrowTopY);
  if (ev.speed < required) {
    // Arm pump gives weak releases all the time and is not a throw attempt: only a movement that
    // went over the shoulder, and was not hopeless, is worth telling the player about.
    if (overarm && ev.speed >= HINT_FRACTION * required) refuse(s, 'slow');
    return false;
  }
  if (!cfg.acceptAnyStyle && !overarm) return refuse(s, 'low');
  if (ev.travel !== undefined && ev.travel < cfg.minThrowTravel) return refuse(s, 'short');
  if (isLift(cfg, ev)) return refuse(s, 'up');

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

/**
 * A brisk arm lift is not a throw: its peak velocity is mostly straight up (image y grows down;
 * `vy` here is positive up). A throw seen side-on moves along the image x axis and one seen
 * facing the camera moves down and sideways at its peak, so only the upward component counts.
 */
export function isLift(cfg: JavelinConfig, ev: ThrowInput): boolean {
  if (ev.vx === undefined || !(ev.vy > 0)) return false;
  return ev.vy > cfg.maxLiftRatio * Math.abs(ev.vx);
}

/**
 * Is a motion the recognizer noticed but did not report as a throw worth a hint? Only the
 * throwing arm, only a real effort (the free arm and the arm pump of running are slower), only
 * after the get-ready lockout, and never over the "Throw!" prompt. A 'slow' note (too weak, or
 * accelerating too gently) is what an arm pump looks like, even a sprint's, so it is not said: a
 * real weak throw is already answered by the rules ("Throw faster") when it is reported.
 */
export function showsRejection(
  s: GameState,
  cfg: JavelinConfig,
  nowMs: number,
  r: { kind: 'swing' | 'throw'; reason: string; hand?: 'left' | 'right'; speed: number },
  throwHand: 'left' | 'right',
): boolean {
  return (
    s.phase === 'run' &&
    nowMs >= s.lockoutUntilMs &&
    r.kind === 'throw' &&
    r.hand === throwHand &&
    r.reason !== 'slow' &&
    r.speed >= cfg.noticeMinSpeed &&
    distanceToLine(s, cfg) > cfg.throwZone
  );
}

/** A too-weak overarm movement is only called out above this fraction of the required speed. */
const HINT_FRACTION = 0.45;

/**
 * Should the last refusal be said to the player? "Bring your hand up past your shoulder" is not
 * while running: running pumps the arms, and a hard pump is as fast as a weak throw and never rises
 * past the shoulder. The throw is refused either way.
 */
export function refusalWorthSaying(s: GameState, cfg: JavelinConfig): boolean {
  return s.refusal !== 'low' || s.speed < cfg.lowHintMaxRunSpeed;
}

function refuse(s: GameState, why: ThrowRefusal): false {
  s.refusal = why;
  s.refusalSeq++;
  return false;
}

/** Mouse play: what the button has done so far this attempt. */
export interface MouseRun {
  seenReleases: number;
  /** Game ms spent running under the button (or finishing a short tap). */
  runMs: number;
  /** A release has been seen and its throw is waiting for `mouseMinRunMs`. */
  throwDue: boolean;
}

export function createMouseRun(releases: number): MouseRun {
  return { seenReleases: releases, runMs: 0, throwDue: false };
}

/**
 * Mouse play, once per fixed step before `stepGame`: hold runs at `mouseRunSpeed`, a release
 * throws (after a very short tap has run for `mouseMinRunMs`). A press that began in the ready beat
 * and is still held starts running the moment the run begins; a release before the run is ignored.
 * Returns the run speed to pass to `stepGame`.
 */
export function stepMouseRun(
  m: MouseRun,
  s: GameState,
  cfg: JavelinConfig,
  nowMs: number,
  dt: number,
  down: boolean,
  releases: number,
  paused: boolean,
  hand: 'left' | 'right',
): number {
  const run = s.phase === 'run' && !paused;
  if (!run) {
    m.runMs = 0;
    m.throwDue = false;
  }
  if (releases !== m.seenReleases) {
    m.seenReleases = releases;
    if (run) m.throwDue = true;
  }
  const running = run && (down || m.throwDue);
  if (running) m.runMs += dt * 1000;
  if (run && m.throwDue && m.runMs >= cfg.mouseMinRunMs) {
    m.throwDue = false;
    onMouseRelease(s, cfg, nowMs, hand);
  }
  return running && s.phase === 'run' ? cfg.mouseRunSpeed : 0;
}

function land(s: GameState, cfg: JavelinConfig): void {
  const foul = s.flightFoul;
  const measured = Math.max(0, s.flight.x - (s.standing ? s.release.x : cfg.runwayLength));
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

/**
 * Pass-and-play: a new player steps up. Back to the start of the runway in the ready beat, with
 * no run speed, cadence history, throw lockout, refusal or flight left over from the last player.
 * The seat's own attempts (`attempt`, `records`, `best`, `bestIndex`) are the sport's to swap in.
 */
export function resetRun(s: GameState): void {
  s.phase = 'ready';
  s.phaseT = 0;
  s.runT = 0;
  s.position = 0;
  s.speed = 0;
  s.cadence = 0;
  s.cadenceNow = 0;
  s.lastStepMs = -1e9;
  s.lockoutUntilMs = 0;
  s.idleHint = false;
  s.crossT = 0;
  s.flightFoul = false;
  s.dropped = false;
  s.lastDistance = 0;
  s.lastFoul = false;
  s.refusal = '';
}

/**
 * Tutorial only: start a fresh run-up at once (no get-ready beat, no attempt counted), from any
 * phase. The throw lockout starts now.
 */
export function restartAttempt(s: GameState, cfg: JavelinConfig, nowMs: number): void {
  s.position = 0;
  s.speed = 0;
  s.cadence = 0;
  s.cadenceNow = 0;
  s.lastStepMs = -1e9;
  s.dropped = false;
  s.flightFoul = false;
  s.nextSeq++;
  begin(s, cfg, nowMs);
}

/** Advance the rules by `dt` seconds. */
export function stepGame(
  s: GameState,
  cfg: JavelinConfig,
  dt: number,
  nowMs: number,
  amplitude: number,
  /** Mouse play: when 0 or more, the run speed to head for instead of the cadence's (m/s). */
  runTarget = -1,
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
      const target = runTarget >= 0 ? runTarget : targetRunSpeed(s.cadenceNow, amplitude, cfg);
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

/** A distance at the precision the table shows (2 decimals), so the score agrees with the headline. */
export function shownDistance(m: number): number {
  return Number(m.toFixed(2));
}
