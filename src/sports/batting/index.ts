import type { Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import type { Side } from '../../input/types';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { BlobShadow } from '../../render/style/blobShadow';
import { PALETTE } from '../../render/style/palette';
import { toonMaterial } from '../../render/style/toon';
import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { createBattingBot } from './bot';
import { battingConfig, battingRanges } from './config';
import { hitWorldPosition } from './flight';
import { batHeightM } from './judge';
import type { Judgement, SwingInput } from './judge';
import { ballPosition } from './pitch';
import type { Pitch, Vec3 } from './pitch';
import { BattingRound } from './round';
import type { PitchResult, RoundSummary } from './round';
import { BatterPose, batterX, batterYaw, batterZ } from './stance';
import { buildWorld } from './world';

/** The pitcher's shirt: a teal from the sky and turf family, clearly not the batter's coral. */
const PITCHER_COLOR = 0x4fb6c2;
const BAT_COLOR = 0xe6c58d;
/** A warm cream, so the ball stands out from the putty athletes and the chalk lines. */
const BALL_COLOR = 0xfff0a8;
/** The throw-over clip is 550 ms long and its hand comes over at about 78% of it. */
const THROW_CLIP_MS = 550;
const THROW_RELEASE_AT = 0.78;
const THROW_LEAD_MS = THROW_CLIP_MS * THROW_RELEASE_AT;
const MAX_QUEUED = 8;
const UP = new Vector3(0, 1, 0);

const smooth = (v: number): number => {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c * c * (3 - 2 * c);
};

/** Debug view of the sport for the browser tests (`window.__game.sport`). */
export interface BattingProbe {
  /** The sport's game clock, ms. */
  readonly clockMs: number;
  /** Arrival of the pitch that can still be swung at (from the start of its wind-up), or -1. */
  readonly arrivalMs: number;
  /** Height (m) where the current pitch crosses the plate, or -1. */
  readonly targetHeightM: number;
  /** The ball mesh: visibility and world position. */
  readonly ball: { visible: boolean; x: number; y: number; z: number };
  readonly pitchIndex: number;
  readonly phase: string;
  /** Where in the pitch cycle: result, reset, set, windup, flight (or ending, done, waiting). */
  readonly stage: string;
  /** Batter placement: world x and z of the feet, and the stance yaw of the rig (rad). */
  readonly batter: { x: number; z: number; yaw: number };
  /** Pitches resolved so far, in order. */
  readonly results: readonly {
    index: number;
    kind: string;
    label: string;
    distance: number;
    timingError: number | null;
    homer: boolean;
  }[];
}

export const createBatting: SportFactory = (ctx: SportContext): Sport & BattingProbe => {
  const cfg = battingConfig;
  const unregister = ctx.tunables.register('batting', 'Batting', cfg, battingRanges);
  const handedness = (): Side => ctx.calibration?.handedness ?? 'right';
  const sg = handedness() === 'right' ? 1 : -1;
  const sourceKind = ctx.input.source?.kind;
  const realtime = sourceKind !== 'synthetic' && sourceKind !== 'replay';
  const scene = ctx.stage.scene;
  const camera = ctx.stage.camera;
  const animator = new AvatarAnimator(ctx.avatar);

  // ---- props ----
  // Side-on in the box: a right-hander on the screen-left of the plate, chest toward it.
  const hand = handedness();
  const standX = batterX(hand, cfg);
  const stanceYaw = batterYaw(hand);
  ctx.avatar.root.position.set(standX, 0, batterZ(cfg));
  ctx.avatar.root.rotation.y = stanceYaw;
  ctx.avatar.setMittCurl('left', 1);
  ctx.avatar.setMittCurl('right', 1);
  const pose = new BatterPose(cfg, hand);
  const world = buildWorld(scene, cfg, standX);
  ctx.stage.ground.visible = false;

  const ballGeo = new SphereGeometry(cfg.ballRadius, 16, 12);
  const ball = new Mesh(ballGeo, toonMaterial(BALL_COLOR));
  ball.visible = false;
  scene.add(ball);
  const ballShadow = new BlobShadow(0.17);
  ballShadow.mesh.visible = false;
  scene.add(ballShadow.mesh);

  // The bat: a light-wood capsule whose origin sits at the grip. Placed between the mitts.
  const batGeo = new CapsuleGeometry(0.036, 0.8, 4, 10);
  batGeo.translate(0, 0.31, 0);
  const bat = new Mesh(batGeo, toonMaterial(BAT_COLOR));
  scene.add(bat);

  // Arrival cue on the plate: a ring that shrinks onto the plate as the ball arrives.
  const ringGeo = new RingGeometry(0.8, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new MeshBasicMaterial({
    color: PALETTE.whistle,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  const ring = new Mesh(ringGeo, ringMat);
  ring.position.set(0, 0.05, cfg.plateZ + 0.2);
  ring.visible = false;
  ring.renderOrder = 2;
  scene.add(ring);

  // The pitcher: a second headless athlete in teal, facing the plate.
  const pitcher = new AvatarRig({ playerColor: PITCHER_COLOR });
  // Drawn a little larger than life so the wind-up and the ball in his hand read at 14 m. The rig's
  // own root scale is used for squash and stretch, so the enlargement sits on a parent group.
  const pitcherGroup = new Group();
  pitcherGroup.position.set(0, 0.2, -cfg.moundDistance);
  pitcherGroup.rotation.y = Math.PI;
  pitcherGroup.scale.setScalar(cfg.pitcherScale);
  pitcherGroup.add(pitcher.root);
  scene.add(pitcherGroup);
  const pitcherAnimator = new AvatarAnimator(pitcher);
  const pitcherShadow = new BlobShadow(0.5);
  scene.add(pitcherShadow.mesh);

  // ---- camera ----
  const camBase = new Vector3(cfg.cameraSide * sg, cfg.cameraHeight, cfg.cameraBack);
  const lookBase = new Vector3(0, 0, -6);
  const lookNow = new Vector3();
  camera.position.copy(camBase);
  camera.lookAt(lookBase);
  let follow = 0;

  // ---- state ----
  let round: BattingRound | null = null;
  let started = false;
  let clock = 0;
  let pitcherClipPlayed = false;
  let batContactMs = -1e9;
  let batHeight = 1;
  let over = false;
  let waggle = 0;
  let celebrateAtMs = -1;
  let shownScore = -1;
  const results: BattingProbe['results'][number][] = [];
  const queue = {
    n: 0,
    kind: new Uint8Array(MAX_QUEUED),
    t: new Float64Array(MAX_QUEUED),
    speed: new Float64Array(MAX_QUEUED),
    height: new Float64Array(MAX_QUEUED),
  };
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  const vA = new Vector3();
  const dir = new Vector3();

  // ---- input: queue the events, apply them in fixedUpdate with the game clock ----
  const push = (kind: number, t: number, speed: number, height: number): void => {
    if (ctx.paused || queue.n >= MAX_QUEUED) return;
    const i = queue.n++;
    queue.kind[i] = kind;
    queue.t[i] = t;
    queue.speed[i] = speed;
    queue.height[i] = height;
  };
  const offStart = ctx.input.on('SwingStarted', (e) => push(0, e.t, e.speed, e.height));
  const offPeak = ctx.input.on('SwingPeak', (e) => push(1, e.t, e.speed, e.height));

  // ---- round hooks ----
  const refreshScore = (s: RoundSummary): void => {
    if (s.score === shownScore) return;
    shownScore = s.score;
    ctx.hud.setScore(`${s.score} m`);
  };

  const timingText = (j: Judgement): string => {
    const abs = Math.round(Math.abs(j.timingError));
    if (abs < 4) return 'Right on time';
    return `${abs} ms ${j.timingError < 0 ? 'early' : 'late'}`;
  };

  const onReset = (index: number, total: number): void => {
    ctx.hud.setBanner(null);
    ctx.hud.setHint(
      index === 1
        ? 'Get ready. Hold both hands together like a bat.'
        : `Get ready. Pitch ${index} of ${total}`,
    );
  };

  const onSet = (p: Pitch): void => {
    pitcherClipPlayed = false;
    ctx.hud.setHint(`Pitch ${p.index} of ${round?.total ?? cfg.pitches}`);
  };

  const onWindup = (_p: Pitch): void => {
    ctx.audio.play('tick');
  };

  const onRelease = (p: Pitch): void => {
    // Release from where the pitcher's hand really is, so the ball leaves the hand.
    pitcher.mitts.right.getWorldPosition(vA);
    const sane =
      vA.y > 1 && vA.y < 2.4 && Math.abs(vA.z + cfg.moundDistance) < 1.5 && Math.abs(vA.x) < 1;
    if (sane) {
      p.rx = vA.x;
      p.ry = vA.y;
      p.rz = vA.z;
    }
  };

  const onSwing = (_p: Pitch, swing: SwingInput): void => {
    ctx.audio.play('whoosh');
    // The batter starts the swing now: the contact time and bat height are known from the event.
    batContactMs = swing.t + cfg.batTravelMs;
    batHeight = batHeightM(swing.height, cfg);
  };

  const onJudged = (_p: Pitch, j: Judgement): void => {
    batContactMs = j.contactMs;
    batHeight = j.batHeight;
    ctx.hud.setSubScore(timingText(j));
  };

  const onResolved = (r: PitchResult, s: RoundSummary): void => {
    refreshScore(s);
    const j = r.judgement;
    results.push({
      index: r.pitch.index,
      kind: r.kind,
      label: r.label,
      distance: r.distance,
      timingError: j === null ? null : j.timingError,
      homer: r.homer,
    });
    if (r.kind === 'hit') {
      const q = j!.quality;
      ctx.audio.play('thud', { pitch: q === 'perfect' ? 1.15 : q === 'good' ? 1 : 0.8 });
      ctx.hud.setBanner(`${r.label} ${r.distance} m`, 1800);
      if (r.homer) {
        ctx.audio.play('cheer');
        ctx.hud.flash('great');
        celebrateAtMs = clock + 500;
      } else if (q === 'perfect') {
        ctx.audio.play('good');
        ctx.hud.flash('good');
      }
    } else if (r.kind === 'foul') {
      ctx.audio.play('thud', { pitch: 0.9, volume: 0.6 });
      ctx.hud.setBanner(r.label, 1400);
    } else {
      ctx.audio.play('bad');
      ctx.hud.flash('bad');
      ctx.hud.setBanner(r.label, 1400);
      if (r.kind === 'strike') ctx.hud.setSubScore('No swing');
    }
  };

  const onEnding = (s: RoundSummary): void => {
    const good = s.hits * 2 >= s.pitches;
    // Turn to face the camera for the celebration, hands open, bat down.
    over = true;
    bat.visible = false;
    ctx.avatar.setMittCurl('left', 0);
    ctx.avatar.setMittCurl('right', 0);
    animator.play(good ? 'celebrate' : 'slump');
    celebrateAtMs = -1;
  };

  const onFinish = (s: RoundSummary): void => {
    const lines = [`${s.hits} of ${s.pitches} pitches hit`, `Longest hit ${s.best} m`];
    lines.push(s.homers === 1 ? '1 home run' : `${s.homers} home runs`);
    ctx.finish({
      score: s.score,
      headline: `${s.score} m`,
      lines,
      detail: {
        pitches: s.pitches,
        hits: s.hits,
        homers: s.homers,
        fouls: s.fouls,
        misses: s.misses,
        best: s.best,
        totalTimingErrorMs: Math.round(s.totalTimingErrorMs),
      },
    });
  };

  const makeRound = (startMs: number): BattingRound =>
    new BattingRound({
      cfg,
      short: ctx.short,
      startMs,
      random: ctx.random,
      handedness,
      realtime,
      hooks: {
        reset: onReset,
        set: onSet,
        windup: onWindup,
        release: onRelease,
        swing: onSwing,
        judged: onJudged,
        resolved: onResolved,
        ending: onEnding,
        finish: onFinish,
        shifted: (by) => {
          batContactMs += by;
          if (celebrateAtMs > 0) celebrateAtMs += by;
        },
      },
    });

  // ---- per-frame visuals (no allocation) ----
  const updatePitcher = (nowMs: number): void => {
    const p = round === null ? null : round.pitch;
    if (p === null || pitcherClipPlayed || nowMs < p.setStartMs) return;
    if (nowMs >= p.releaseMs - THROW_LEAD_MS) {
      pitcherClipPlayed = true;
      pitcherAnimator.play('throw-over', { side: 'right' });
      return;
    }
    // Set: hands together at the chest, holding still (blended in from the rest pose).
    const enter = smooth((nowMs - p.setStartMs) / 200);
    // Wind-up: the glove arm reaches out, the throwing arm cocks back behind the shoulder and the
    // front leg lifts.
    const u = smooth((nowMs - p.windupStartMs) / Math.max(1, cfg.windupMs - THROW_LEAD_MS));
    const rx = 0.28 + (0.06 - 0.28) * enter + (0.34 - 0.06) * u;
    const ry = 0.8 + (1.12 - 0.8) * enter + (1.56 - 1.12) * u;
    const rz = -0.3 * enter + (0.32 + 0.3) * u;
    pitcher.setArmTarget('right', rx, ry, rz, 0.5 + 0.1 * u, 1.0 + 0.4 * u, 0.1 + 0.2 * u);
    const lx = -0.28 + (-0.06 + 0.28) * enter + (-0.25 + 0.06) * u;
    const ly = 0.8 + (1.12 - 0.8) * enter + (1.3 - 1.12) * u;
    const lz = -0.3 * enter + (-0.5 + 0.3) * u;
    pitcher.setArmTarget('left', lx, ly, lz, -0.3, 1.0, -0.1);
    const lift = smooth(u / 0.5) * (1 - 0.8 * smooth((u - 0.7) / 0.3));
    pitcher.setLeg('left', 1.0 * lift, 1.3 * lift);
  };

  const updateBat = (): void => {
    if (over) return;
    const b = pose.bat;
    bat.position.set(b.x, b.y, b.z);
    dir.set(b.dx, b.dy, b.dz);
    bat.quaternion.setFromUnitVectors(UP, dir);
  };

  const updateBall = (nowMs: number, dt: number): void => {
    const r = round;
    let visible = false;
    let flying = false;
    let hitDist = 0;
    if (r !== null) {
      const res = r.result;
      const p = r.pitch;
      if (res !== null && res.trajectory !== null && nowMs >= res.contactMs) {
        // The hit ball, placed by the time since contact: a hit resolved late starts where it would be.
        hitWorldPosition(res.trajectory, res.headingDeg, cfg.plateZ, nowMs - res.contactMs, tmp);
        ball.position.set(tmp.x, tmp.y, tmp.z);
        visible = true;
        flying = true;
        hitDist = Math.hypot(tmp.x, tmp.z - cfg.plateZ);
        if (res.trajectory.total < cfg.cameraFollowFrom) hitDist = 0;
      } else if (p !== null && r.phase !== 'ending' && r.phase !== 'done') {
        if (nowMs >= p.setStartMs && nowMs < p.releaseMs) {
          pitcher.mitts.right.getWorldPosition(vA);
          ball.position.set(vA.x, vA.y + 0.02, vA.z);
          visible = true;
        } else if (nowMs >= p.releaseMs) {
          ballPosition(p, nowMs, tmp);
          const j = r.judgement;
          const struck = j !== null && j.quality !== 'miss' && nowMs >= j.contactMs;
          // Past the plate the ball is gone into the backstop net.
          if (tmp.z < cfg.plateZ + 0.3 && !struck) {
            ball.position.set(tmp.x, tmp.y, tmp.z);
            visible = true;
          }
        }
      }
    }
    ball.visible = visible;
    if (visible && (flying || nowMs >= (r?.pitch?.releaseMs ?? Infinity))) {
      ballShadow.follow(ball, 0);
    } else {
      ballShadow.mesh.visible = false;
    }
    // Camera: steady for the pitch and short hits, a gentle follow on long flies.
    const want =
      flying && hitDist > 0 ? cfg.cameraFollowWeight * Math.min(1, 0.3 + hitDist / 40) : 0;
    follow += (want - follow) * (1 - Math.exp(-Math.min(0.1, dt) * (want > follow ? 3 : 1.5)));
    if (follow > 1e-3 && visible) {
      lookNow.set(
        lookBase.x + (ball.position.x - lookBase.x) * follow,
        lookBase.y + (ball.position.y - lookBase.y) * follow,
        lookBase.z + (ball.position.z - lookBase.z) * follow,
      );
      camera.lookAt(lookNow);
    } else {
      camera.lookAt(lookBase);
    }
  };

  const updateRing = (nowMs: number): void => {
    const p = round === null ? null : round.pitch;
    if (p === null || nowMs < p.releaseMs || nowMs > p.arrivalMs + 120) {
      ring.visible = false;
      return;
    }
    const f = Math.min(1, (nowMs - p.releaseMs) / p.flightMs);
    // Grows from a dot to the size of the plate, so it is full size exactly on arrival.
    const s = 0.12 + 0.34 * f * f;
    ring.scale.set(s, 1, s);
    ring.visible = true;
  };

  return {
    start(): void {
      started = true;
      ctx.hud.setScore('0 m');
      ctx.hud.setSubScore(ctx.best === null ? null : `Best ${ctx.best} m`);
      ctx.hud.setHint('Hold both hands together like a bat. Swing as the ball arrives.');
    },

    fixedUpdate(_dt: number, nowMs: number): void {
      clock = nowMs;
      if (!started) return;
      if (round === null) round = makeRound(nowMs);
      for (let i = 0; i < queue.n; i++) {
        if (queue.kind[i] === 0) {
          round.onSwingStarted(
            { t: queue.t[i]!, speed: queue.speed[i]!, height: queue.height[i]! },
            nowMs,
          );
        } else {
          round.onSwingPeak({ speed: queue.speed[i]! }, nowMs);
        }
      }
      queue.n = 0;
      round.update(nowMs);
    },

    frame(dt: number, nowMs: number): void {
      clock = nowMs;
      if (celebrateAtMs > 0 && nowMs >= celebrateAtMs) {
        celebrateAtMs = -1;
        animator.play('celebrate');
      }
      // A celebration turns the batter to face the camera; the stance turns back to the plate.
      const yawTarget = over || animator.current === 'celebrate' ? 0 : stanceYaw;
      const root = ctx.avatar.root;
      root.rotation.y +=
        (yawTarget - root.rotation.y) * (1 - Math.exp(-Math.min(0.1, dt) * cfg.turnRate));
      animator.update(dt);
      // The player's mirrored pose is not used here: the batter is side-on, so the arms are placed
      // from the swing's timing (see stance.ts).
      if (!animator.busy && !over) {
        const st = round === null ? 'result' : round.stage(nowMs);
        const want = st === 'set' || st === 'windup' ? 1 : 0;
        waggle += (want - waggle) * (1 - Math.exp(-Math.min(0.1, dt) * 6));
        pose.update(ctx.avatar, nowMs, dt, batContactMs, batHeight, waggle);
      }
      updatePitcher(nowMs);
      pitcherAnimator.update(dt);
      pitcher.update(dt);
      pitcherShadow.follow(pitcher.root, 0.2);
      updateBat();
      updateBall(nowMs, dt);
      updateRing(nowMs);
    },

    createBot(): SportBot {
      return createBattingBot({
        cfg,
        random: ctx.random,
        view: {
          pitch: () =>
            round !== null && round.phase === 'pitch' && !round.resolved && round.swingT < 0
              ? round.pitch
              : null,
          over: () => round !== null && (round.phase === 'ending' || round.phase === 'done'),
          frameT: () => ctx.input.state.t,
        },
      });
    },

    dispose(): void {
      offStart();
      offPeak();
      unregister();
      round?.stop();
      ball.removeFromParent();
      bat.removeFromParent();
      ring.removeFromParent();
      ballShadow.dispose();
      pitcherShadow.dispose();
      pitcher.dispose();
      pitcherGroup.removeFromParent();
      world.dispose();
      ctx.stage.ground.visible = true;
      ballGeo.dispose();
      batGeo.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      ctx.hud.clear();
    },

    get clockMs(): number {
      return clock;
    },
    get arrivalMs(): number {
      const r = round;
      if (r === null || r.pitch === null || r.phase !== 'pitch' || r.resolved) return -1;
      return r.pitch.arrivalMs;
    },
    get targetHeightM(): number {
      const r = round;
      if (r === null || r.pitch === null || r.phase !== 'pitch' || r.resolved) return -1;
      return r.pitch.ty;
    },
    get ball(): { visible: boolean; x: number; y: number; z: number } {
      return { visible: ball.visible, x: ball.position.x, y: ball.position.y, z: ball.position.z };
    },
    get pitchIndex(): number {
      return round === null ? 0 : round.started;
    },
    get phase(): string {
      return round === null ? 'waiting' : round.phase;
    },
    get stage(): string {
      return round === null ? 'waiting' : round.stage(clock);
    },
    get batter(): { x: number; z: number; yaw: number } {
      const p = ctx.avatar.root.position;
      return { x: p.x, z: p.z, yaw: stanceYaw };
    },
    results,
  };
};

export default createBatting;
