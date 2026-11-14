import type { Side } from '../../input/types';
import type { BattingConfig } from './config';
import { simulateHit } from './flight';
import type { Trajectory } from './flight';
import { judgeSwing, noSwingResolveMs, swingInWindow } from './judge';
import type { Judgement, SwingInput } from './judge';
import { planPitch } from './pitch';
import type { Pitch } from './pitch';

export type ResultKind = 'hit' | 'foul' | 'miss' | 'strike';

/** The outcome of one pitch. */
export interface PitchResult {
  pitch: Pitch;
  kind: ResultKind;
  /** The swing's judgement; null when the batter did not swing. */
  judgement: Judgement | null;
  /** Banner text. */
  label: string;
  /** Scored metres (rounded), 0 unless it was a hit. Excludes the home-run bonus. */
  distance: number;
  homer: boolean;
  /** Game ms the ball left the bat (hits and fouls). */
  contactMs: number;
  /** Heading of the hit, degrees, positive toward screen right. */
  headingDeg: number;
  /** The hit ball's path (hits and fouls), else null. */
  trajectory: Trajectory | null;
}

export interface RoundSummary {
  pitches: number;
  hits: number;
  homers: number;
  fouls: number;
  misses: number;
  best: number;
  totalTimingErrorMs: number;
  score: number;
}

/** Callbacks into the sport. All optional, all fired from `update` or the swing handlers. */
export interface RoundHooks {
  windup?(pitch: Pitch): void;
  release?(pitch: Pitch): void;
  /** A swing was accepted for the current pitch (before it is judged). */
  swing?(pitch: Pitch, swing: SwingInput): void;
  /** The swing has been judged (the power is known); contact may still be in the future. */
  judged?(pitch: Pitch, judgement: Judgement): void;
  /** The pitch is resolved: show the banner, add the score, launch the hit ball. */
  resolved?(result: PitchResult, summary: RoundSummary): void;
  /** The last pitch resolved and the pause is over: play the celebrate or slump clip. */
  ending?(summary: RoundSummary): void;
  /** Call ctx.finish here. Fires exactly once. */
  finish?(summary: RoundSummary): void;
}

export type RoundPhase = 'idle' | 'pitch' | 'ending' | 'done';

const FOUL_EXIT = 24;
const FOUL_LAUNCH = 38;

/**
 * The batting round as a pure state machine over game time. It never reads the wall clock: every
 * decision uses the timestamps it is given, so a swing that the tracker reports 150 ms late is
 * judged exactly as a prompt one.
 *
 * Latency compensation: a swing is judged by its own timestamp (`contactMs = swing.t +
 * batTravelMs`), not by the time the event arrived. The event may arrive after the ball has already
 * crossed the plate, so the pitch is resolved when the event arrives (hit balls launch from the plate at
 * `contactMs`; the sport positions them `clock - contactMs` into their flight, so a late hit starts
 * where it would be, never teleporting back) or, with no swing, only after the swing window and an
 * event-delay allowance have passed.
 */
export class BattingRound {
  phase: RoundPhase = 'idle';
  /** The current or most recent pitch; null before the first wind-up. */
  pitch: Pitch | null = null;
  /** The current pitch has been released. */
  released = false;
  /** The current pitch has been resolved (the ball may still be flying). */
  resolved = false;
  /** Result of the current pitch once resolved. */
  result: PitchResult | null = null;
  /** The judgement of the current pitch's swing (set before the result is applied). */
  judgement: Judgement | null = null;
  /** Game ms of the current pitch's accepted swing start, or -1. */
  swingT = -1;
  /** Pitches started so far. */
  started = 0;
  readonly total: number;
  readonly summary: RoundSummary = {
    pitches: 0,
    hits: 0,
    homers: 0,
    fouls: 0,
    misses: 0,
    best: 0,
    totalTimingErrorMs: 0,
    score: 0,
  };

  private readonly cfg: BattingConfig;
  private readonly random: () => number;
  private readonly hand: () => Side;
  private readonly hooks: RoundHooks;
  private readonly realtime: boolean;
  private nextPitchAtMs: number;
  private lastClock = -1;
  // Swing handling.
  private swing: SwingInput | null = null;
  private swingPending = false;
  private swingArrivedClock = 0;
  // A judged outcome waiting for its moment.
  private pendingResult: PitchResult | null = null;
  private applyAtMs = 0;
  private endAtMs = 0;
  private endingFired = false;
  private finishFired = false;

  constructor(options: {
    cfg: BattingConfig;
    short: boolean;
    startMs: number;
    random: () => number;
    handedness: () => Side;
    hooks?: RoundHooks;
    /** True for the camera and debug input: a long gap between updates is a pause, not game time. */
    realtime?: boolean;
  }) {
    this.cfg = options.cfg;
    this.total = options.short ? options.cfg.shortPitches : options.cfg.pitches;
    this.random = options.random;
    this.hand = options.handedness;
    this.hooks = options.hooks ?? {};
    this.realtime = options.realtime ?? false;
    this.nextPitchAtMs = options.startMs + options.cfg.firstPitchDelayMs;
  }

  /** Game ms the next wind-up starts (valid while idle). */
  get nextWindupMs(): number {
    return this.nextPitchAtMs;
  }

  /** Advance to game time `clock`. Allocation-free except when an event fires. */
  update(clock: number): void {
    if (this.realtime && this.lastClock >= 0 && clock - this.lastClock > this.cfg.pauseGapMs) {
      this.shift(clock - this.lastClock);
    }
    this.lastClock = clock;
    const cfg = this.cfg;
    if (this.phase === 'idle') {
      if (clock >= this.nextPitchAtMs) this.startPitch();
      else return;
    }
    if (this.phase === 'pitch') {
      const p = this.pitch!;
      if (!this.released && clock >= p.releaseMs) {
        this.released = true;
        this.hooks.release?.(p);
      }
      if (this.swingPending && clock >= this.swingArrivedClock + cfg.peakWaitMs) {
        this.judgeNow(null, clock);
      }
      if (this.pendingResult !== null) {
        if (clock >= this.applyAtMs) this.apply(this.pendingResult, clock);
      } else if (this.swing === null && clock >= noSwingResolveMs(p, cfg)) {
        this.apply(this.makeResult('strike', null, 'Strike', p.arrivalMs), clock);
      }
    }
    if (this.phase === 'ending') {
      if (!this.endingFired && clock >= this.endAtMs) {
        this.endingFired = true;
        this.hooks.ending?.(this.summary);
      }
      if (this.endingFired && !this.finishFired && clock >= this.endAtMs + cfg.finishDelayMs) {
        this.finishFired = true;
        this.phase = 'done';
        this.hooks.finish?.(this.summary);
      }
    }
  }

  /** A SwingStarted event arrived while the game clock read `clock`. */
  onSwingStarted(ev: { t: number; speed: number; height: number }, clock: number): void {
    if (this.phase !== 'pitch' || this.resolved || this.swing !== null) return;
    const p = this.pitch!;
    if (!swingInWindow(p, ev.t, this.cfg)) return;
    this.swing = { t: ev.t, startSpeed: ev.speed, height: ev.height, peakSpeed: null };
    this.swingT = ev.t;
    this.swingPending = true;
    this.swingArrivedClock = clock;
    this.hooks.swing?.(p, this.swing);
  }

  /** A SwingPeak event arrived while the game clock read `clock`. */
  onSwingPeak(ev: { speed: number }, clock: number): void {
    if (!this.swingPending || this.swing === null) return;
    if (clock - this.swingArrivedClock > this.cfg.peakWaitMs) return;
    this.judgeNow(ev.speed, clock);
  }

  /** Quit early or tear down: no further hooks fire. */
  stop(): void {
    this.phase = 'done';
    this.finishFired = true;
  }

  // ---- internals ----

  private startPitch(): void {
    this.started++;
    const p = planPitch(this.started, this.nextPitchAtMs, this.random, this.cfg);
    this.pitch = p;
    this.phase = 'pitch';
    this.released = false;
    this.resolved = false;
    this.result = null;
    this.judgement = null;
    this.swing = null;
    this.swingT = -1;
    this.swingPending = false;
    this.pendingResult = null;
    this.hooks.windup?.(p);
  }

  private judgeNow(peakSpeed: number | null, clock: number): void {
    const swing = this.swing!;
    swing.peakSpeed = peakSpeed;
    this.swingPending = false;
    const p = this.pitch!;
    const j = judgeSwing(this.cfg, p, swing, this.hand());
    this.judgement = j;
    this.summary.totalTimingErrorMs += Math.abs(j.timingError);
    this.hooks.judged?.(p, j);
    let result: PitchResult;
    if (j.quality === 'miss') {
      result = this.makeResult('miss', j, j.label, p.arrivalMs);
      this.applyAtMs = Math.max(clock, p.arrivalMs);
    } else if (j.quality === 'foul') {
      result = this.makeResult('foul', j, j.label, j.contactMs);
      result.trajectory = simulateHit(FOUL_EXIT, FOUL_LAUNCH, this.cfg);
      result.headingDeg = j.sprayDeg;
      this.applyAtMs = Math.max(clock, j.contactMs);
    } else {
      result = this.makeResult('hit', j, j.label, j.contactMs);
      const tr = simulateHit(j.exitSpeed, j.launchDeg, this.cfg);
      result.trajectory = tr;
      result.headingDeg = j.sprayDeg;
      result.distance = Math.round(tr.total);
      result.homer = tr.homer;
      if (tr.homer) result.label = 'Home run!';
      this.applyAtMs = Math.max(clock, j.contactMs);
    }
    this.pendingResult = result;
  }

  private makeResult(
    kind: ResultKind,
    j: Judgement | null,
    label: string,
    contactMs: number,
  ): PitchResult {
    return {
      pitch: this.pitch!,
      kind,
      judgement: j,
      label,
      distance: 0,
      homer: false,
      contactMs,
      headingDeg: 0,
      trajectory: null,
    };
  }

  private apply(result: PitchResult, clock: number): void {
    const s = this.summary;
    const cfg = this.cfg;
    this.pendingResult = null;
    this.resolved = true;
    this.result = result;
    s.pitches++;
    let pause = cfg.betweenPitchesMs;
    if (result.kind === 'hit') {
      s.hits++;
      s.score += result.distance;
      if (result.distance > s.best) s.best = result.distance;
      if (result.homer) {
        s.homers++;
        s.score += cfg.homerBonus;
      }
      const air = result.trajectory === null ? 0 : result.trajectory.airS * 1000;
      pause = Math.max(pause, air + 400);
    } else if (result.kind === 'foul') {
      s.fouls++;
    } else {
      s.misses++;
    }
    pause = Math.min(pause, cfg.maxBetweenPitchesMs);
    this.hooks.resolved?.(result, s);
    if (this.started >= this.total) {
      this.phase = 'ending';
      this.endAtMs = clock + cfg.endPauseMs;
    } else {
      this.phase = 'idle';
      this.nextPitchAtMs = clock + pause;
    }
  }

  /** The game clock jumped (camera problem pause): move the whole timeline with it. */
  private shift(by: number): void {
    this.nextPitchAtMs += by;
    this.swingArrivedClock += by;
    this.applyAtMs += by;
    this.endAtMs += by;
    const p = this.pitch;
    if (p !== null && !this.resolved) {
      p.windupStartMs += by;
      p.releaseMs += by;
      p.arrivalMs += by;
    }
    if (this.swing !== null && !this.resolved) this.swing.t += by;
    const r = this.pendingResult;
    if (r !== null) r.contactMs += by;
  }
}
