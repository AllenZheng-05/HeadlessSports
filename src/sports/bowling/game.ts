import type { Side } from '../../input/types';
import type { BowlingConfig } from './config';
import type { BowlingPhysics } from './physics';
import { mapRelease, smoothBowlerX } from './release';
import type { Release } from './release';
import { nextBall, runningTotal } from './scoring';
import type { NextBall } from './scoring';

/** The explicit phases of a round. */
export type BowlPhase = 'pickup' | 'aim' | 'rolling' | 'settle' | 'reset' | 'done';

/** The slice of InputState the rules read. Structural, so tests can fake it. */
export interface PlayerView {
  lateral: number;
  hands: Record<Side, { present: boolean; known: boolean }>;
  /** `wristY` is relative to the same-side shoulder, sw, positive up. */
  arms: Record<Side, { speed: number; wristY: number }>;
}

export interface ThrowInfo {
  hand: Side;
  speed: number;
  lateral: number;
  curvature: number;
  style: 'overarm' | 'underarm';
}

export type RollKind = 'strike' | 'spare' | 'gutter' | 'miss' | 'count';

export interface RollOutcome {
  pins: number;
  kind: RollKind;
  /** 0-based frame and ball the roll counted for. */
  frame: number;
  ball: number;
  total: number;
}

/** The big banner for a counted ball. */
export function rollBanner(o: Pick<RollOutcome, 'kind' | 'pins'>): string {
  switch (o.kind) {
    case 'strike':
      return 'Strike!';
    case 'spare':
      return 'Spare!';
    case 'gutter':
      return 'Gutter';
    case 'miss':
      return 'Miss';
    default:
      return o.pins === 1 ? '1 pin' : `${o.pins} pins`;
  }
}

export interface GameEvents {
  phase?(next: BowlPhase, prev: BowlPhase): void;
  pickedUp?(): void;
  released?(release: Release): void;
  /** First pin contact; `speed` is the ball speed in m/s. */
  contact?(speed: number): void;
  rolled?(outcome: RollOutcome): void;
  finished?(total: number, rolls: readonly number[]): void;
}

export interface GameOptions {
  hand: Side;
  frames: number;
}

/**
 * The bowling phase machine: pickup, aim, rolling, settle, reset, done. Pure apart from the
 * physics object it drives (an interface, faked in tests). Time is accumulated from `dt`.
 */
export class BowlingGame {
  phase: BowlPhase = 'pickup';
  readonly rolls: number[] = [];
  readonly hand: Side;
  readonly frames: number;
  bowlerX = 0;
  strikes = 0;
  spares = 0;
  lastRelease: Release | null = null;
  /** Wall time spent in the current phase, seconds. */
  phaseTime = 0;
  /** What the next ball is. Updated after every roll. */
  next: NextBall;

  private readonly physics: BowlingPhysics;
  private readonly cfg: BowlingConfig;
  private readonly events: GameEvents;
  private holdMs = 0;
  private sinceRelease = 0;
  private sinceContact = 0;
  private restTimer = 0;
  private contactSeen = false;
  private finishedFired = false;
  private started = false;

  constructor(
    physics: BowlingPhysics,
    cfg: BowlingConfig,
    events: GameEvents,
    options: GameOptions,
  ) {
    this.physics = physics;
    this.cfg = cfg;
    this.events = events;
    this.hand = options.hand;
    this.frames = options.frames;
    this.next = nextBall(this.rolls, this.frames);
  }

  get total(): number {
    return runningTotal(this.rolls, this.frames);
  }

  start(): void {
    this.started = true;
    this.physics.rack(true);
    this.enter('pickup');
  }

  private enter(next: BowlPhase): void {
    const prev = this.phase;
    this.phase = next;
    this.phaseTime = 0;
    this.holdMs = 0;
    this.events.phase?.(next, prev);
  }

  /** FistClosed from the input. */
  onFistClosed(hand: Side): void {
    if (this.phase !== 'pickup' || hand !== this.hand) return;
    this.pickUp();
  }

  private pickUp(): void {
    this.enter('aim');
    this.events.pickedUp?.();
  }

  /** ThrowReleased from the input. Returns true when it launched the ball. */
  onThrow(info: ThrowInfo): boolean {
    if (this.phase !== 'aim' || info.hand !== this.hand) return false;
    if (!this.cfg.acceptAnyStyle && info.style !== 'underarm') return false;
    if (info.speed < this.cfg.minReleaseSpeed) return false;
    const release = mapRelease(info, this.cfg);
    this.lastRelease = release;
    this.physics.launch(this.bowlerX, release.ballSpeed, release.angle, release.hook);
    this.sinceRelease = 0;
    this.sinceContact = 0;
    this.restTimer = 0;
    this.contactSeen = false;
    this.enter('rolling');
    this.events.released?.(release);
    return true;
  }

  /** Run the rules for one fixed step. */
  fixedUpdate(dt: number, view: PlayerView): void {
    if (!this.started || (this.phase === 'done' && this.finishedFired)) return;
    this.phaseTime += dt;
    this.physics.step(dt);

    switch (this.phase) {
      case 'pickup':
        this.updatePickup(dt, view);
        break;
      case 'aim':
        this.bowlerX = smoothBowlerX(this.bowlerX, view.lateral, dt, this.cfg);
        break;
      case 'rolling':
        this.updateRolling(dt);
        break;
      case 'settle':
        if (this.phaseTime >= this.cfg.settleHoldS) this.endSettle();
        break;
      case 'reset':
        if (this.phaseTime >= this.cfg.resetS) this.enter('pickup');
        break;
      case 'done':
        if (this.phaseTime >= this.cfg.finishDelayS) {
          this.finishedFired = true;
          this.events.finished?.(this.total, this.rolls);
        }
        break;
    }
  }

  private updatePickup(dt: number, view: PlayerView): void {
    const hand = view.hands[this.hand];
    const arm = view.arms[this.hand];
    const fistUnknown = !hand.known || !hand.present;
    if (fistUnknown && arm.speed < this.cfg.pickupHoldSpeed && arm.wristY < 0) {
      this.holdMs += dt * 1000;
      if (this.holdMs >= this.cfg.pickupHoldMs) this.pickUp();
    } else {
      this.holdMs = 0;
    }
  }

  private updateRolling(dt: number): void {
    const cfg = this.cfg;
    const physics = this.physics;
    this.sinceRelease += dt;
    const contact = physics.takeContact();
    if (contact > 0) {
      this.contactSeen = true;
      this.sinceContact = 0;
      this.events.contact?.(contact);
    }
    if (this.contactSeen) this.sinceContact += dt;
    if (physics.ballDone() && physics.pinsAtRest()) this.restTimer += dt;
    else this.restTimer = 0;
    if (
      this.restTimer >= cfg.settleRestS ||
      (this.contactSeen && this.sinceContact >= cfg.settleTimeoutS) ||
      this.sinceRelease >= cfg.releaseTimeoutS
    ) {
      this.countRoll();
    }
  }

  private countRoll(): void {
    const before = this.next;
    const standing = this.physics.standingCount();
    let pins = before.pinsUp - standing;
    if (pins < 0) pins = 0;
    if (pins > before.pinsUp) pins = before.pinsUp;
    const frame = before.frame;
    const ball = before.ball;
    this.rolls.push(pins);
    let kind: RollKind = 'count';
    if (pins === before.pinsUp && pins > 0) {
      // A strike is clearing a fresh rack. Clearing all ten after a 0 on the first ball is a spare.
      if (before.freshRack && before.pinsUp === 10) {
        kind = 'strike';
        this.strikes++;
      } else {
        kind = 'spare';
        this.spares++;
      }
    } else if (pins === 0) {
      kind = this.physics.ballInGutter ? 'gutter' : 'miss';
    }
    this.next = nextBall(this.rolls, this.frames);
    this.enter('settle');
    this.events.rolled?.({ pins, kind, frame, ball, total: this.total });
  }

  private endSettle(): void {
    if (this.next.done) {
      this.physics.removeBall();
      this.enter('done');
      return;
    }
    this.physics.removeBall();
    this.physics.rack(this.next.freshRack);
    this.enter('reset');
  }
}
