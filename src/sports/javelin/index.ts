import { mirrorUpperBody } from '../../core/avatarDrive';
import type { MeterTone, Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import { recognizerConfig } from '../../input/recognizers/config';
import type { GameEvent, Side } from '../../input/types';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { BlobShadow } from '../../render/style/blobShadow';
import { vertexColorToonMaterial } from '../../render/style/toon';
import { Mesh, Vector3 } from 'three/webgpu';
import type { Fog } from 'three/webgpu';
import { createJavelinBot } from './bot';
import { javelinConfig, javelinRanges } from './config';
import { flightPitch } from './distance';
import {
  attemptLine,
  attemptsFor,
  createGame,
  distanceToLine,
  onArmLowered,
  onArmRaised,
  onFistClosed,
  onThrow,
  stepGame,
} from './game';
import type { AttemptRecord, FistKnowledge, Phase } from './game';
import { JAVELIN_TIP, buildJavelinGeometry, buildMarkerGeometry, buildWorld } from './world';

/** What the browser tests and the debugging overlay read from `__game.sport`. */
export interface JavelinSport extends Sport {
  readonly phase: Phase;
  /** Metres from the start of the runway. */
  readonly position: number;
  /** Metres left to the foul line. */
  readonly distanceToLine: number;
  /** Ground speed, m/s. */
  readonly speed: number;
  readonly attempt: number;
  readonly best: number;
  readonly records: readonly AttemptRecord[];
  readonly ignoredThrows: number;
  /** The last gesture events the sport saw and what it did with them (for debugging). */
  readonly log: readonly string[];
}

/** Pitch of the javelin when held, radians (nose up). */
const HOLD_PITCH = 0.22;
/** How fast the visual launch offset (mitt vs model release point) fades, 1/s. */
const OFFSET_FADE = 7;
/** The javelin is drawn a little oversized in the air and in the turf so it reads at distance. */
const FLIGHT_SCALE = 1.5;

export const createJavelin: SportFactory = (ctx: SportContext): JavelinSport => {
  const cfg = javelinConfig;
  const hand: Side = ctx.calibration?.handedness ?? 'right';
  const game = createGame(attemptsFor(cfg, ctx.short));
  const animator = new AvatarAnimator(ctx.avatar);
  const unregister = ctx.tunables.register('javelin', 'Javelin', cfg, javelinRanges);

  // Running makes the shoulders bob; optionally let the throw recognizer tolerate more of it.
  const savedBodySpeed = recognizerConfig.throw.maxBodySpeed;
  if (cfg.maxBodySpeedOverride > 0) recognizerConfig.throw.maxBodySpeed = cfg.maxBodySpeedOverride;

  // World.
  const stage = ctx.stage;
  const world = buildWorld(cfg);
  stage.scene.add(world.group);
  const groundWasVisible = stage.ground.visible;
  stage.ground.visible = false;
  const fog = stage.scene.fog as Fog | null;
  const fogNear = fog?.near ?? 0;
  const fogFar = fog?.far ?? 0;
  if (fog !== null) {
    fog.near = cfg.fogNear;
    fog.far = cfg.fogFar;
  }
  const camera = stage.camera;
  camera.fov = cfg.cameraFov;
  camera.updateProjectionMatrix();

  const material = vertexColorToonMaterial();
  const javelinGeometry = buildJavelinGeometry();
  const javelin = new Mesh(javelinGeometry, material);
  javelin.name = 'javelin';
  javelin.frustumCulled = false;
  stage.scene.add(javelin);
  const markerGeometry = buildMarkerGeometry();
  const marker = new Mesh(markerGeometry, material);
  marker.name = 'distance-marker';
  marker.visible = false;
  stage.scene.add(marker);
  const javelinShadow = new BlobShadow(0.6);
  stage.scene.add(javelinShadow.mesh);

  // Scratch values, so nothing allocates per frame.
  const tmp = new Vector3();
  const look = new Vector3(0, 1.2, -12);
  const camGoal = new Vector3();
  const lookGoal = new Vector3();
  let offX = 0;
  let offY = 0;
  let offZ = 0;
  /** 0 held, 1 flying, 2 stuck in the turf. */
  let javelinState = 0;
  let seenStart = 0;
  let seenRelease = 0;
  let seenLand = 0;
  let seenNext = 0;
  let seenDone = 0;
  let started = false;
  let finished = false;
  let snapCamera = true;
  let stickPitch = 0;
  let stickPhi = 0;

  // Events are queued by the input handlers and consumed in fixedUpdate, so every gesture is
  // processed against the same game clock as the rules.
  const pending: GameEvent[] = [];
  const log: string[] = [];
  const note = (text: string): void => {
    log.push(text);
    if (log.length > 60) log.shift();
  };
  const onAny = ctx.input.onAny((e) => {
    switch (e.type) {
      case 'ArmRaised':
      case 'ArmLowered':
      case 'FistClosed':
      case 'ThrowReleased':
        pending.push(e);
        break;
      case 'Step':
        if (game.phase === 'run' && started) {
          ctx.audio.play('tick', {
            pitch: 0.85 + (game.speed / cfg.maxRunSpeed) * 0.5,
            volume: 0.35,
          });
        }
        break;
      default:
        break;
    }
  });

  const fistOf = (): FistKnowledge => {
    const h = ctx.input.state.hands[hand];
    if (!h.present || !h.known) return 'unknown';
    return h.closed ? 'closed' : 'open';
  };

  const drain = (nowMs: number): void => {
    for (const e of pending) {
      if (e.type !== 'ThrowReleased') note(`${e.type} t=${e.t.toFixed(0)} ${game.phase}`);
      if (e.type === 'ArmRaised') {
        onArmRaised(game, cfg, nowMs, e.hand, e.both, fistOf(), hand);
      } else if (e.type === 'ArmLowered') {
        onArmLowered(game, cfg, nowMs, e.hand, hand);
      } else if (e.type === 'FistClosed') {
        onFistClosed(game, cfg, nowMs, e.hand, hand);
      } else if (e.type === 'ThrowReleased') {
        const taken = onThrow(
          game,
          cfg,
          nowMs,
          { t: e.t, hand: e.hand, speed: e.speed, vy: e.vy, style: e.style },
          hand,
        );
        note(
          `throw t=${e.t.toFixed(0)} now=${nowMs.toFixed(0)} speed=${e.speed.toFixed(1)} vy=${e.vy.toFixed(1)} ${e.style} ${game.phase} pos=${game.position.toFixed(1)} v=${game.speed.toFixed(1)} taken=${taken}`,
        );
      }
    }
    pending.length = 0;
  };

  // ---- HUD (strings are rebuilt only when the displayed value changes) ----
  let shownThrow = -1;
  let shownSpeed = -2;
  let shownBestCm = -1;
  let shownLinePct = -1;
  let shownLineRem = -1;
  let shownLineTone = '';
  let lineShown = false;
  let shownHint: string | null = '';

  const setHint = (text: string | null): void => {
    if (text === shownHint) return;
    shownHint = text;
    ctx.hud.setHint(text);
  };

  const refreshHud = (): void => {
    const n = Math.min(game.attempt + 1, game.total);
    if (n !== shownThrow) {
      shownThrow = n;
      ctx.hud.setScore(`Try ${n}/${game.total}`);
    }
    const running = game.phase === 'run';
    // Sub-score: the speed while running, the best mark otherwise.
    const speedTenths = running ? Math.round(game.speed * 10) : -1;
    const bestCm = running ? -1 : Math.round(game.best * 100);
    if (speedTenths !== shownSpeed || bestCm !== shownBestCm) {
      shownSpeed = speedTenths;
      shownBestCm = bestCm;
      if (running) ctx.hud.setSubScore(`${(speedTenths / 10).toFixed(1)} m/s`);
      else if (game.best > 0) ctx.hud.setSubScore(`Best ${game.best.toFixed(2)} m`);
      else ctx.hud.setSubScore(ctx.best === null ? null : `Record ${ctx.best.toFixed(2)} m`);
    }
    if (running) {
      const fill = Math.max(0, Math.min(1, game.position / cfg.runwayLength));
      const pct = Math.round(fill * 100);
      const rem = Math.max(0, Math.ceil(distanceToLine(game, cfg)));
      const tone: MeterTone = fill < 0.7 ? 'good' : fill < 0.92 ? 'warn' : 'bad';
      if (pct !== shownLinePct || rem !== shownLineRem || tone !== shownLineTone) {
        shownLinePct = pct;
        shownLineRem = rem;
        shownLineTone = tone;
        lineShown = true;
        ctx.hud.setMeter('line', fill, `Foul line ${rem} m`, tone);
      }
      if (game.idleHint) setHint('Lift your knees to run');
      else if (distanceToLine(game, cfg) <= cfg.throwZone) setHint('Throw!');
      else setHint('Run on the spot: lift your knees');
    } else if (lineShown) {
      lineShown = false;
      shownLinePct = -1;
      shownLineRem = -1;
      shownLineTone = '';
      ctx.hud.setMeter('line', null);
    }
  };

  // ---- Reactions to the rules ----
  const holdJavelin = (): void => {
    javelinState = 0;
    marker.visible = false;
  };

  const detachJavelin = (): void => {
    ctx.avatar.mitts[hand].getWorldPosition(tmp);
    offX = tmp.x;
    offY = tmp.y - game.flight.y;
    offZ = tmp.z + game.flight.x;
    javelinState = 1;
  };

  const react = (): void => {
    if (game.startSeq !== seenStart) {
      seenStart = game.startSeq;
      ctx.audio.play('select');
      ctx.hud.setBanner('Go!', 900);
      // Hand state is unusable during a sprint: stop paying for hand crops.
      void ctx.input
        .setNeeds({ pose: true, handCrops: false, fullFrameHands: false })
        .catch(() => undefined);
    }
    if (game.releaseSeq !== seenRelease) {
      seenRelease = game.releaseSeq;
      detachJavelin();
      setHint(null);
      if (game.dropped) {
        ctx.audio.play('bad');
        ctx.hud.setBanner('You crossed the line');
        animator.play('slump');
      } else {
        ctx.audio.play('whoosh');
        const power = Math.max(
          0,
          Math.min(
            1,
            (game.release.throwSpeed - cfg.throwFloor) / (cfg.throwCeil - cfg.throwFloor),
          ),
        );
        animator.play('throw-over', { side: hand, strength: 0.4 + 0.6 * power });
      }
    }
    if (game.landSeq !== seenLand) {
      seenLand = game.landSeq;
      javelinState = 2;
      ctx.audio.play('thud');
      const f = game.flight;
      const phi = Math.max(0.35, Math.min(1.25, Math.atan2(-f.vy, Math.max(1e-3, Math.abs(f.vx)))));
      stickPitch = -phi;
      stickPhi = phi;
      if (game.lastFoul) {
        ctx.audio.play('bad');
        ctx.hud.flash('bad');
        if (!game.dropped) ctx.hud.setBanner('Foul');
        if (!animator.busy || animator.current !== 'slump') animator.play('slump');
        setHint(game.dropped ? 'Throw before the line' : 'Released past the line');
      } else {
        const d = game.lastDistance;
        marker.visible = true;
        marker.position.set(1.3, 0, -f.x);
        marker.scale.setScalar(1 + d * 0.02);
        ctx.hud.setBanner(`${d.toFixed(2)} m`);
        ctx.audio.play('good');
        const isBest = d >= game.best && d > (ctx.best ?? 0);
        if (isBest) {
          ctx.audio.play('cheer');
          ctx.hud.flash('great');
          animator.play('celebrate');
        } else {
          ctx.hud.flash('good');
          animator.play('hop');
        }
        setHint(
          `Release ${Math.round(game.release.angleDeg)} degrees, ${game.release.lineGap.toFixed(1)} m before the line`,
        );
      }
    }
    if (game.nextSeq !== seenNext) {
      seenNext = game.nextSeq;
      holdJavelin();
      snapCamera = true;
      animator.stop();
      ctx.hud.setBanner('Raise a fist to start');
      setHint('Raise a fist above your head');
      void ctx.input
        .setNeeds({ pose: true, handCrops: true, fullFrameHands: false })
        .catch(() => undefined);
    }
    if (game.doneSeq !== seenDone) {
      seenDone = game.doneSeq;
      finish();
    }
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    const recs = game.records;
    const lines: string[] = [];
    let fouls = 0;
    for (let i = 0; i < recs.length; i++) {
      lines.push(attemptLine(i, recs[i]!));
      if (recs[i]!.foul) fouls++;
    }
    const bestRec = game.bestIndex >= 0 ? recs[game.bestIndex]! : null;
    if (bestRec !== null) {
      lines.push(
        `Best throw: ${Math.round(bestRec.angleDeg)} degrees, run ${bestRec.runSpeed.toFixed(1)} m/s, ${bestRec.lineGap.toFixed(1)} m before the line`,
      );
    }
    ctx.finish({
      score: game.best,
      headline: game.best > 0 ? `${game.best.toFixed(2)} m` : 'No mark',
      lines,
      detail: {
        attempts: recs.length,
        best: game.best,
        fouls,
        bestRunSpeed: bestRec?.runSpeed ?? 0,
        bestReleaseSpeed: bestRec?.throwSpeed ?? 0,
        bestAngleDeg: bestRec?.angleDeg ?? 0,
        bestLineGapM: bestRec?.lineGap ?? 0,
      },
    });
  };

  // ---- Camera ----
  const updateCamera = (dt: number): void => {
    const phase = game.phase;
    const flight = game.flight;
    if (phase === 'flight' && !game.dropped) {
      camGoal.set(4.2, 2.4 + Math.min(flight.y, 10) * 0.25, -flight.x + 6.5);
      lookGoal.set(0, Math.max(1.2, flight.y), -flight.x - 4);
    } else if (phase === 'result' || phase === 'done' || (phase === 'flight' && game.dropped)) {
      const landZ = -flight.x;
      camGoal.set(game.lastFoul ? 0 : 5.5, 3.0, landZ + (game.lastFoul ? 8 : 11));
      lookGoal.set(0, 0.8, landZ - 1);
    } else {
      const z = -game.position;
      camGoal.set(0, cfg.cameraUp, z + cfg.cameraBack);
      lookGoal.set(0, cfg.cameraLookY, z - cfg.cameraLookAhead);
    }
    if (snapCamera) {
      snapCamera = false;
      camera.position.copy(camGoal);
      look.copy(lookGoal);
    } else {
      const fast = phase === 'run' || phase === 'ready';
      const k = 1 - Math.exp(-(fast ? 14 : cfg.cameraSmooth) * dt);
      camera.position.x += (camGoal.x - camera.position.x) * k;
      camera.position.y += (camGoal.y - camera.position.y) * k;
      camera.position.z += (camGoal.z - camera.position.z) * k;
      const kl = 1 - Math.exp(-(fast ? 14 : 8) * dt);
      look.x += (lookGoal.x - look.x) * kl;
      look.y += (lookGoal.y - look.y) * kl;
      look.z += (lookGoal.z - look.z) * kl;
    }
    camera.lookAt(look);
  };

  const sport: JavelinSport = {
    get phase(): Phase {
      return game.phase;
    },
    get position(): number {
      return game.position;
    },
    get distanceToLine(): number {
      return distanceToLine(game, cfg);
    },
    get speed(): number {
      return game.speed;
    },
    get attempt(): number {
      return game.attempt;
    },
    get best(): number {
      return game.best;
    },
    get records(): readonly AttemptRecord[] {
      return game.records;
    },
    get log(): readonly string[] {
      return log;
    },
    get ignoredThrows(): number {
      return game.ignoredThrows;
    },

    start(): void {
      started = true;
      ctx.hud.setBanner('Raise a fist to start');
      setHint('Raise a fist above your head');
      refreshHud();
    },

    fixedUpdate(dt: number, nowMs: number): void {
      if (finished) return;
      drain(nowMs);
      const cad = ctx.input.state.cadence;
      stepGame(game, cfg, dt, nowMs, cad.stepsPerSecond, cad.amplitude);
      react();
    },

    frame(dt: number, nowMs: number): void {
      const phase = game.phase;
      // Athlete: the rig runs down the runway, the camera follows.
      ctx.avatar.root.position.set(0, 0, -game.position);
      if (!animator.busy) mirrorUpperBody(ctx.avatar, ctx.input.state, nowMs, 1.3);
      const moving = game.speed > 0.4;
      animator.setRun(
        moving ? (game.speed / cfg.maxRunSpeed) * cfg.fullCadence : 0,
        moving ? Math.min(1, 0.3 + (game.speed / cfg.maxRunSpeed) * 0.7) : 0,
      );
      animator.update(dt);

      // Javelin: in the hand, in the air, or stuck in the turf.
      if (javelinState === 0) {
        ctx.avatar.mitts[hand].getWorldPosition(tmp);
        javelin.position.copy(tmp);
        javelin.rotation.set(HOLD_PITCH, 0, 0);
        javelin.scale.setScalar(1);
      } else if (javelinState === 1) {
        const f = game.flight;
        const fade = Math.exp(-f.t * OFFSET_FADE);
        javelin.position.set(offX * fade, f.y + offY * fade, -f.x + offZ * fade);
        javelin.rotation.set(game.dropped ? -0.5 : flightPitch(f), 0, 0);
        javelin.scale.setScalar(FLIGHT_SCALE);
      } else {
        const f = game.flight;
        const s = Math.sin(stickPhi);
        const c = Math.cos(stickPhi);
        javelin.position.set(
          0,
          -0.12 + s * JAVELIN_TIP * FLIGHT_SCALE,
          -f.x + c * JAVELIN_TIP * FLIGHT_SCALE,
        );
        javelin.scale.setScalar(FLIGHT_SCALE);
        javelin.rotation.set(stickPitch, 0, 0);
      }
      javelinShadow.follow(javelin);
      updateCamera(dt);
      if (phase !== 'done') refreshHud();
    },

    createBot(): SportBot {
      return createJavelinBot(cfg, game, hand, ctx.random);
    },

    dispose(): void {
      onAny();
      unregister();
      recognizerConfig.throw.maxBodySpeed = savedBodySpeed;
      world.dispose();
      javelin.removeFromParent();
      marker.removeFromParent();
      javelinShadow.dispose();
      javelinGeometry.dispose();
      markerGeometry.dispose();
      stage.ground.visible = groundWasVisible;
      if (fog !== null) {
        fog.near = fogNear;
        fog.far = fogFar;
      }
      ctx.avatar.root.position.set(0, 0, 0);
      animator.reset();
      ctx.hud.clear();
    },
  };
  return sport;
};

export default createJavelin;
