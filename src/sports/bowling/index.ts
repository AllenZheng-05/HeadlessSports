import { mirrorUpperBody } from '../../core/avatarDrive';
import type { RoundResult, Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import type { Side } from '../../input/types';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { asMouseControl } from '../../input/debug/mouseControl';
import { createBowlingBot } from './bot';
import { pointerAimAngle } from './mouseAim';
import { bowlingConfig, bowlingRanges } from './config';
import { BowlingGame, rollBanner } from './game';
import type { BowlPhase, GameEvents, RollOutcome } from './game';
import { createRapierBowling } from './physics';
import type { Release } from './release';
import { scorecardRows } from './scoring';
import { BowlingView } from './view';
import type { CameraMode } from './view';
import {
  countPickup,
  countRelease,
  countRoll,
  countThrow,
  countWindup,
  createBowlTutorial,
  createTutorialCounts,
} from './tutorial';
import type { BowlTutorial, TutorialProbe } from './tutorial';
import { buildAlley, rackSpot } from './world';

/** What Playwright and the debugging tools can read from `__game.sport`. */
export interface BowlingDebug {
  readonly phase: BowlPhase;
  readonly ballZ: number;
  readonly ballX: number;
  readonly bowlerX: number;
  /** Live aim, radians from straight; the indicator and the release both use it. */
  readonly aimAngle: number;
  /** Pins down by the most recent ball. */
  readonly pinsDown: number;
  readonly rolls: readonly number[];
  readonly releases: readonly Release[];
  readonly standing: number;
  /** The ball has touched the pins this roll. */
  readonly contacted: boolean;
  /** Tutorial rounds: the current step (0-based), or -1 in a normal round. */
  readonly tutorialStep: number;
  /** Tutorial rounds: the number of steps, or 0 in a normal round. */
  readonly tutorialSteps: number;
  /** Pass-and-play: the seat on the lane (0 with one player). */
  readonly seat: number;
  readonly seatCount: number;
  /** Each started seat's running total, in seat order. */
  readonly scores: readonly number[];
}

const CAMERA_FOR: Record<BowlPhase, CameraMode> = {
  pickup: 'behind',
  aim: 'behind',
  rolling: 'follow',
  settle: 'pins',
  reset: 'behind',
  done: 'pins',
  handover: 'behind',
};

export const createBowling: SportFactory = async (ctx: SportContext) => {
  const cfg = bowlingConfig;
  const tut = ctx.tutorial;
  // Pass-and-play: seats alternate frame by frame, each with their own scorecard. The lane is shared.
  const turns = ctx.turns;
  const multi = turns.count > 1 && !tut;
  const seatCount = multi ? turns.count : 1;
  // The bowling hand is the current seat's: read again at every handover.
  let hand: Side = ctx.calibration?.handedness ?? 'right';
  // A tutorial is a lane session: a whole game's frames, so it never runs out before the steps do.
  const frames = ctx.short && !tut ? cfg.shortFrames : cfg.frames;
  const counts = createTutorialCounts();
  const probe: TutorialProbe = { gate: 0 };
  let tutorial: BowlTutorial | null = null;

  // Rapier ships in this chunk only: it is imported here and nowhere on the title screen.
  const physics = await createRapierBowling(cfg);
  const animator = new AvatarAnimator(ctx.avatar);
  const unregister = ctx.tunables.register('bowling', 'Bowling', cfg, bowlingRanges);
  let disposeAlley = buildAlley(ctx.stage.scene, hand);
  const view = new BowlingView(ctx.stage.scene, ctx.stage.camera);
  let rack = rackSpot(hand);
  let mitt = ctx.avatar.mitts[hand];

  ctx.stage.camera.fov = cfg.cameraFov;
  ctx.stage.camera.updateProjectionMatrix();

  const releases: Release[] = [];
  let holding = false;
  let handCrops = true;
  let finished = false;
  let pinsDown = 0;
  let meterLeft = 0;
  let hintedFist = false;
  let rows = scorecardRows([], frames);
  let shownScore = -1;
  let shownSub = '';
  let launches = 0;
  let seat = 0;

  // Camera off: the mouse is the whole interface (see docs: one button, no keys).
  const mouse = asMouseControl(ctx.input);
  let seenPresses = 0;
  let seenReleases = 0;
  /** The arm hangs at the side; the cursor aims the arrows, it does not wave the arm about. */
  const seatMouseHand = (): void => {
    if (!mouse) return;
    mouse.selectHand(hand);
    mouse.setHandTarget(hand, 0.5 + (hand === 'right' ? 1 : -1) * 0.06, 0.85);
  };
  if (mouse) {
    mouse.setManualMode(true);
    mouse.setPointerFollow(false);
    seatMouseHand();
    seenPresses = mouse.pointerPresses;
    seenReleases = mouse.pointerReleases;
  }

  const setHandCrops = (on: boolean): void => {
    if (on === handCrops) return;
    handCrops = on;
    ctx.input.setNeeds({ pose: true, handCrops: on, fullFrameHands: false }).catch(() => undefined);
  };

  const refreshSub = (): void => {
    // No frame counter or best in a tutorial: the coach panel is the guide.
    if (tut) return;
    const n = game.next;
    const frame = Math.min(n.frame + 1, frames);
    const ball = Math.min(n.ball + 1, frame === frames ? 3 : 2);
    const best = ctx.best === null ? '' : ` · Best ${Math.round(ctx.best)}`;
    const who = multi ? `${playerName()} · ` : '';
    const text = `${who}Frame ${frame}, ball ${ball}${best}`;
    if (text === shownSub) return;
    shownSub = text;
    ctx.hud.setSubScore(text);
  };

  const playerName = (): string => turns.players[seat]?.name ?? `Player ${seat + 1}`;

  const refreshCard = (): void => {
    rows = scorecardRows(game.rolls, frames);
    if (multi) {
      // The player's name leads the card; the extra column shifts the highlight by one.
      rows[0]?.unshift(playerName());
      rows[1]?.unshift('');
      rows[2]?.unshift('');
    }
    ctx.hud.setTable(rows, Math.min(game.next.frame, frames - 1) + (multi ? 1 : 0));
    if (game.total !== shownScore) {
      shownScore = game.total;
      ctx.hud.setScore(String(shownScore));
    }
    refreshSub();
  };

  const onRolled = (o: RollOutcome): void => {
    pinsDown = o.pins;
    countRoll(counts, o.kind);
    ctx.hud.setHint(null);
    refreshCard();
    if (multi) turns.setStanding(seat, game.total, `${game.total} pts`);
    switch (o.kind) {
      case 'strike':
        ctx.hud.setBanner(rollBanner(o), 1600);
        ctx.audio.play('great');
        ctx.hud.flash('great');
        animator.play('celebrate');
        break;
      case 'spare':
        ctx.hud.setBanner(rollBanner(o), 1600);
        ctx.audio.play('good');
        ctx.hud.flash('good');
        animator.play('celebrate');
        break;
      case 'gutter':
        ctx.hud.setBanner(rollBanner(o), 1600);
        ctx.audio.play('bad');
        ctx.hud.flash('bad');
        break;
      case 'miss':
        ctx.hud.setBanner(rollBanner(o), 1600);
        ctx.audio.play('bad');
        break;
      default:
        ctx.hud.setBanner(rollBanner(o), 1600);
        if (o.pins >= 7) ctx.audio.play('good');
    }
  };

  const onPhase = (next: BowlPhase): void => {
    hintedFist = false;
    switch (next) {
      case 'pickup':
        setHandCrops(true);
        view.placeBall(rack.x, rack.y, rack.z);
        if (mouse) {
          ctx.hud.setBanner(null);
          ctx.hud.setHint('Move the mouse to aim the arrows. Hold the button, let go to bowl');
        } else {
          ctx.hud.setHint(null);
          // The coach panel says it in a tutorial.
          if (!tut) ctx.hud.setBanner('Close your fist to pick up the ball', 4000);
        }
        refreshSub();
        break;
      case 'aim':
        ctx.hud.setBanner(null);
        ctx.hud.setHint(
          mouse
            ? 'Let go of the button to bowl'
            : 'Step or move your hand to line up the arrows, then swing',
        );
        break;
      case 'rolling':
        ctx.hud.setHint(null);
        break;
      case 'reset':
        view.placeBall(rack.x, rack.y, rack.z);
        break;
      case 'done': {
        const total = game.total;
        ctx.hud.setHint(null);
        ctx.hud.setBanner(`Game over: ${total}`);
        if (!animator.busy) animator.play(total >= frames * 8 ? 'celebrate' : 'slump');
        break;
      }
      default:
        break;
    }
  };

  /** Everything the seats' games share: one lane, one set of callbacks. */
  const events: GameEvents = {
    phase: onPhase,
    pickedUp: () => {
      countPickup(counts);
      holding = true;
      view.attachBallTo(mitt);
      setHandCrops(false);
      ctx.audio.play('grab');
      ctx.avatar.squash(0.9);
    },
    released: (release) => {
      holding = false;
      launches++;
      countRelease(counts, release.hook);
      releases.push(release);
      view.setAim(false, 0, 0);
      animator.play('throw-under', { side: hand, strength: 0.4 + 0.6 * release.power });
      ctx.audio.play('whoosh', { pitch: 0.8 + 0.5 * release.power });
      ctx.hud.setMeter('power', release.power, `${release.ballSpeed.toFixed(1)} m/s`, 'good');
      meterLeft = cfg.powerMeterS;
      // Ends the input's wind-up so the arm swings through and the next press can start one.
      mouse?.releaseThrow(1, { lateral: 0, curvature: 0 });
    },
    pinsDown: (count) => {
      if (count > 0) ctx.hud.setHint(count === 1 ? '1 pin down' : `${count} pins down`);
    },
    contact: (speed) => {
      ctx.audio.play('clatter', { volume: Math.min(1, Math.max(0.35, speed / 8)) });
    },
    rolled: onRolled,
    finished: (total, rolls) => {
      // A tutorial ends through its own steps and saves nothing.
      if (finished || tut) return;
      finished = true;
      let pins = 0;
      for (const r of rolls) pins += r;
      ctx.finish({
        score: total,
        headline: String(total),
        lines: [
          `${game.strikes} strikes, ${game.spares} spares`,
          `${pins} pins in ${rolls.length} balls`,
        ],
        detail: {
          balls: rolls.length,
          strikes: game.strikes,
          spares: game.spares,
          pins,
          frames,
        },
      });
    },
    turnEnded: (complete) => {
      if (!multi || finished) return;
      // Everyone has bowled their last frame once the last seat in the order completes.
      if (complete && seat === seatCount - 1 && games.every((g) => g.next.done)) {
        finished = true;
        const results: RoundResult[] = [];
        for (const g of games) {
          results.push({
            score: g.total,
            headline: `${g.total} pts`,
            lines: [`${g.strikes} strikes, ${g.spares} spares`],
            detail: { strikes: g.strikes, spares: g.spares, balls: g.rolls.length, frames },
          });
        }
        ctx.finishMulti(results);
        return;
      }
      const next = (seat + 1) % seatCount;
      turns.handOver(next, () => switchSeat(next));
    },
  };

  const makeGame = (): BowlingGame =>
    new BowlingGame(physics, cfg, events, { hand, frames, mouse: mouse !== null, turns: multi });
  const games: BowlingGame[] = [makeGame()];
  let game: BowlingGame = games[0] as BowlingGame;

  /** The next seat is in place: its hand, its card, a fresh rack and a clean aim. */
  const switchSeat = (next: number): void => {
    seat = next;
    const h: Side = ctx.calibration?.handedness ?? 'right';
    if (h !== hand) {
      ctx.avatar.setMittCurl(hand, 0);
      hand = h;
      disposeAlley();
      disposeAlley = buildAlley(ctx.stage.scene, hand);
      rack = rackSpot(hand);
      mitt = ctx.avatar.mitts[hand];
      seatMouseHand();
    }
    holding = false;
    meterLeft = 0;
    ctx.hud.setMeter('power', null);
    view.setAim(false, 0, 0);
    // A press that confirmed the handover card is not a bowling press.
    if (mouse) {
      seenPresses = mouse.pointerPresses;
      seenReleases = mouse.pointerReleases;
    }
    let g = games[next];
    if (g === undefined) {
      g = makeGame();
      games[next] = g;
    }
    game = g;
    shownScore = -1;
    shownSub = '';
    refreshCard();
    // Back to a ready lane: a fresh rack, the aim reset, the pickup phase.
    game.start();
  };

  // Mouse play has no gestures: presses and releases are polled in fixedUpdate instead.
  const unsubscribers = mouse
    ? []
    : [
        ctx.input.on('FistClosed', (e) => {
          if (!ctx.paused) game.onFistClosed(e.hand);
        }),
        ctx.input.on('ThrowWindup', (e) => {
          if (ctx.paused) return;
          countWindup(counts, game.phase, hand, e.hand);
          game.onWindup(e.hand);
        }),
        ctx.input.on('ThrowReleased', (e) => {
          // Gestures made while the round is paused (player out of frame) do not count.
          if (ctx.paused) return;
          countThrow(counts, game.phase, hand, e.hand, game.onThrow(e));
        }),
      ];

  const botView = {
    get phase(): BowlPhase {
      return game.phase;
    },
    get launches(): number {
      return launches;
    },
  };

  const sport: Sport & BowlingDebug = {
    start(): void {
      refreshCard();
      game.start();
      ctx.hud.setScore('0');
      shownScore = 0;
      if (multi) for (let i = 0; i < seatCount; i++) turns.setStanding(i, 0, '0 pts');
      if (tut) {
        ctx.hud.setSubScore(null);
        const input = ctx.input;
        tutorial = createBowlTutorial({
          cfg,
          coach: ctx.coach,
          game,
          counts,
          mouse: mouse !== null,
          body:
            mouse !== null
              ? null
              : {
                  tracking: () => input.state.tracking,
                  problem: () => input.state.problem,
                  handPresent: () => input.state.hands[hand].present,
                  rejected: () => input.state.rejected,
                },
          probe,
          onFinished: () => {
            ctx.audio.play('cheer');
            ctx.hud.flash('great');
            ctx.finishTutorial();
          },
        });
      }
    },

    fixedUpdate(dt: number): void {
      if (finished) return;
      if (mouse) {
        // Counters, not button state: a button held through the reset does not bowl the next ball.
        const presses = mouse.pointerPresses;
        const releases = mouse.pointerReleases;
        if (presses !== seenPresses) {
          seenPresses = presses;
          if (!ctx.paused && game.mousePress()) mouse.startWindup(hand, 'underarm');
        }
        if (releases !== seenReleases) {
          seenReleases = releases;
          game.mouseRelease();
        }
      }
      game.fixedUpdate(dt, ctx.input.state);
    },

    frame(dt: number, nowMs: number, alpha: number): void {
      if (tutorial !== null && !ctx.paused) tutorial.update(nowMs);
      const phase = game.phase;
      if (!animator.busy) {
        mirrorUpperBody(ctx.avatar, ctx.input.state, nowMs, phase === 'aim' ? 1.3 : 1);
      }
      // The ball is in the throwing hand: keep the mitt closed around it, open it at release.
      ctx.avatar.setMittCurl(hand, holding ? 1 : 0);
      animator.update(dt);
      ctx.avatar.root.position.x = game.bowlerX;

      if (phase === 'rolling' || phase === 'settle' || phase === 'done') {
        if (physics.ballActive) view.drawBall(physics, alpha);
      }
      view.drawPins(physics, alpha);
      view.followBallShadow();
      view.updateCamera(
        dt,
        CAMERA_FOR[phase],
        game.bowlerX,
        physics.ballX,
        physics.ballZ,
        cfg.cameraHeight,
        cfg.cameraBack,
      );
      const aiming = phase === 'aim' || (mouse !== null && phase === 'pickup');
      if (mouse && aiming) {
        game.setMouseAim(
          pointerAimAngle(ctx.stage.camera, mouse.pointerX, mouse.pointerY, game.bowlerX, cfg),
        );
      }
      view.setAim(aiming, game.bowlerX, game.aimAngle);

      if (meterLeft > 0) {
        meterLeft -= dt;
        if (meterLeft <= 0) ctx.hud.setMeter('power', null);
      }
      if (
        !mouse &&
        phase === 'pickup' &&
        !hintedFist &&
        game.phaseTime * 1000 > cfg.fistHintMs &&
        !ctx.input.state.hands[hand].known
      ) {
        hintedFist = true;
        ctx.hud.setHint('Show your hand to the camera and close it, or hold still');
      }
    },

    createBot(): SportBot {
      return createBowlingBot(botView, () => hand, ctx.random, -0.14, tut ? probe : undefined);
    },

    dispose(): void {
      tutorial?.dispose();
      for (const off of unsubscribers) off();
      if (mouse) {
        mouse.setPointerFollow(true);
        mouse.setManualMode(false);
      }
      unregister();
      animator.stop();
      ctx.avatar.root.position.x = 0;
      view.dispose();
      disposeAlley();
      physics.dispose();
      ctx.hud.clear();
    },

    get phase(): BowlPhase {
      return game.phase;
    },
    get ballZ(): number {
      return physics.ballZ;
    },
    get ballX(): number {
      return physics.ballX;
    },
    get bowlerX(): number {
      return game.bowlerX;
    },
    get aimAngle(): number {
      return game.aimAngle;
    },
    get pinsDown(): number {
      return pinsDown;
    },
    get rolls(): readonly number[] {
      return game.rolls;
    },
    get releases(): readonly Release[] {
      return releases;
    },
    get contacted(): boolean {
      return physics.contacted;
    },
    get standing(): number {
      return physics.standingCount();
    },
    get seat(): number {
      return seat;
    },
    get seatCount(): number {
      return seatCount;
    },
    get scores(): readonly number[] {
      return games.map((g) => g.total);
    },
    get tutorialStep(): number {
      return tutorial === null ? -1 : tutorial.step;
    },
    get tutorialSteps(): number {
      return tutorial === null ? 0 : tutorial.stepCount;
    },
  };
  return sport;
};

export default createBowling;
