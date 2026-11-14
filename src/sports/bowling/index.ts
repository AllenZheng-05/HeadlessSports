import { mirrorUpperBody } from '../../core/avatarDrive';
import type { Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { createBowlingBot } from './bot';
import { bowlingConfig, bowlingRanges } from './config';
import { BowlingGame, rollBanner } from './game';
import type { BowlPhase, RollOutcome } from './game';
import { createRapierBowling } from './physics';
import type { Release } from './release';
import { scorecardRows } from './scoring';
import { BowlingView } from './view';
import type { CameraMode } from './view';
import { buildAlley, rackSpot } from './world';

/** What Playwright and the debugging tools can read from `__game.sport`. */
export interface BowlingDebug {
  readonly phase: BowlPhase;
  readonly ballZ: number;
  readonly ballX: number;
  readonly bowlerX: number;
  /** Pins down by the most recent ball. */
  readonly pinsDown: number;
  readonly rolls: readonly number[];
  readonly releases: readonly Release[];
  readonly standing: number;
  /** The ball has touched the pins this roll. */
  readonly contacted: boolean;
}

const CAMERA_FOR: Record<BowlPhase, CameraMode> = {
  pickup: 'behind',
  aim: 'behind',
  rolling: 'follow',
  settle: 'pins',
  reset: 'behind',
  done: 'pins',
};

export const createBowling: SportFactory = async (ctx: SportContext) => {
  const cfg = bowlingConfig;
  const hand = ctx.calibration?.handedness ?? 'right';
  const frames = ctx.short ? cfg.shortFrames : cfg.frames;

  // Rapier ships in this chunk only: it is imported here and nowhere on the title screen.
  const physics = await createRapierBowling(cfg);
  const animator = new AvatarAnimator(ctx.avatar);
  const unregister = ctx.tunables.register('bowling', 'Bowling', cfg, bowlingRanges);
  const disposeAlley = buildAlley(ctx.stage.scene, hand);
  const view = new BowlingView(ctx.stage.scene, ctx.stage.camera);
  const rack = rackSpot(hand);
  const mitt = ctx.avatar.mitts[hand];

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

  const setHandCrops = (on: boolean): void => {
    if (on === handCrops) return;
    handCrops = on;
    ctx.input.setNeeds({ pose: true, handCrops: on, fullFrameHands: false }).catch(() => undefined);
  };

  const refreshSub = (): void => {
    const n = game.next;
    const frame = Math.min(n.frame + 1, frames);
    const ball = Math.min(n.ball + 1, frame === frames ? 3 : 2);
    const best = ctx.best === null ? '' : ` · Best ${Math.round(ctx.best)}`;
    const text = `Frame ${frame}, ball ${ball}${best}`;
    if (text === shownSub) return;
    shownSub = text;
    ctx.hud.setSubScore(text);
  };

  const refreshCard = (): void => {
    rows = scorecardRows(game.rolls, frames);
    ctx.hud.setTable(rows, Math.min(game.next.frame, frames - 1));
    if (game.total !== shownScore) {
      shownScore = game.total;
      ctx.hud.setScore(String(shownScore));
    }
    refreshSub();
  };

  const onRolled = (o: RollOutcome): void => {
    pinsDown = o.pins;
    refreshCard();
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
        ctx.hud.setHint(null);
        ctx.hud.setBanner('Close your fist to pick up the ball', 4000);
        refreshSub();
        break;
      case 'aim':
        ctx.hud.setBanner(null);
        ctx.hud.setHint('Step left or right to aim, then swing');
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

  const game: BowlingGame = new BowlingGame(
    physics,
    cfg,
    {
      phase: onPhase,
      pickedUp: () => {
        holding = true;
        view.attachBallTo(mitt);
        setHandCrops(false);
        ctx.audio.play('grab');
        ctx.avatar.squash(0.9);
      },
      released: (release) => {
        holding = false;
        launches++;
        releases.push(release);
        view.setAim(false, 0);
        animator.play('throw-under', { side: hand, strength: 0.4 + 0.6 * release.power });
        ctx.audio.play('whoosh', { pitch: 0.8 + 0.5 * release.power });
        ctx.hud.setMeter('power', release.power, `${release.ballSpeed.toFixed(1)} m/s`, 'good');
        meterLeft = cfg.powerMeterS;
      },
      contact: (speed) => {
        ctx.audio.play('clatter', { volume: Math.min(1, Math.max(0.35, speed / 8)) });
      },
      rolled: onRolled,
      finished: (total, rolls) => {
        if (finished) return;
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
    },
    { hand, frames },
  );

  const unsubscribers = [
    ctx.input.on('FistClosed', (e) => {
      if (!ctx.paused) game.onFistClosed(e.hand);
    }),
    ctx.input.on('ThrowReleased', (e) => {
      // Gestures made while the round is paused (player out of frame) do not count.
      if (!ctx.paused) game.onThrow(e);
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
    },

    fixedUpdate(dt: number): void {
      if (finished) return;
      game.fixedUpdate(dt, ctx.input.state);
    },

    frame(dt: number, nowMs: number, alpha: number): void {
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
      view.setAim(phase === 'aim', game.bowlerX);
      view.updateCamera(
        dt,
        CAMERA_FOR[phase],
        game.bowlerX,
        physics.ballX,
        physics.ballZ,
        cfg.cameraHeight,
        cfg.cameraBack,
      );

      if (meterLeft > 0) {
        meterLeft -= dt;
        if (meterLeft <= 0) ctx.hud.setMeter('power', null);
      }
      if (
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
      return createBowlingBot(botView, hand, ctx.random, -0.14);
    },

    dispose(): void {
      for (const off of unsubscribers) off();
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
  };
  return sport;
};

export default createBowling;
