import { mirrorUpperBody } from '../../core/avatarDrive';
import type { MeterTone, Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import { asMouseControl } from '../../input/debug/mouseControl';
import type { MouseControl } from '../../input/debug/mouseControl';
import type { GameEvent, Side } from '../../input/types';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { BlobShadow } from '../../render/style/blobShadow';
import { toonMaterial } from '../../render/style/toon';
import { Group, Mesh, SphereGeometry, Vector3 } from 'three/webgpu';
import type { Fog } from 'three/webgpu';
import {
  createAim,
  createLiveInput,
  gloveSide,
  mouseThrowSpeed,
  pointedAim,
  sideSign,
  trackedLive,
} from './aim';
import type { PitchKind } from './aim';
import { createPitchingBot } from './bot';
import { createBubble } from './bubble';
import { createPitchButtons } from './pitchButtons';
import { KIND_LABEL, callText, reactionText } from './call';
import { LiveAim } from './liveAim';
import { pitchingConfig, pitchingRanges } from './config';
import { ballAt } from './flight';
import type { Vec3 } from './flight';
import { canPick, createGame, onThrow, pickKind, pitchesFor, stepGame, totalIgnored } from './game';
import type { HandInput, Phase, Reading } from './game';
import { summarize } from './scoring';
import type { PitchRecord, Tier } from './scoring';
import { cellCentre } from './zone';
import type { Point } from './zone';
import { MOUND_HEIGHT, buildAimMarker, buildWorld, buildZone, drawX, drawY } from './world';

/** The catcher's shirt: a denim blue, clearly not the pitcher's coral mitts. */
const CATCHER_COLOR = 0x4a6fa5;
const CATCHER_BODY = 0xb9cbe8;
/** A warm cream, so the ball stands out from the putty athletes and the chalk. */
const BALL_COLOR = 0xfff0a8;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One pitch as the browser tests read it. */
export interface PitchProbe {
  index: number;
  kind: PitchKind;
  called: PitchKind;
  matched: boolean;
  target: number;
  balk: boolean;
  /** Where it crossed the plate plane, m (scored coordinates). */
  x: number;
  y: number;
  kmh: number;
  points: number;
  tier: Tier;
  cell: number;
}

/** What the browser tests and the debugging overlay read from `__game.sport`. */
export interface PitchingSport extends Sport {
  readonly phase: Phase;
  readonly index: number;
  readonly kind: PitchKind;
  /** The pitch the catcher called, and the words of the call. */
  readonly called: PitchKind;
  readonly callText: string;
  /** The speech bubble is showing, and what it says. */
  readonly bubble: { visible: boolean; text: string; sub: string };
  /** The live aim indicator: visible, and where it points (scored plane coordinates, m). */
  readonly aimMarker: { visible: boolean; x: number; y: number; locked: boolean };
  readonly reading: Reading;
  readonly target: number;
  readonly score: number;
  readonly pitches: readonly PitchProbe[];
  readonly ignoredThrows: number;
  readonly ignoredWrongHand: number;
  readonly usedFallback: boolean;
  /** The ball mesh: visibility and world position. */
  readonly ball: { visible: boolean; x: number; y: number; z: number };
  readonly log: readonly string[];
}

/** Static strings for the bubble's second line, so nothing is built per frame. */
const READING_SUB: Record<'none' | PitchKind, string> = {
  none: 'Show your dominant hand and hold it still',
  fastball: 'Fist: fastball',
  curve: 'Open hand: curve',
};
const LOCKED_SUB: Record<PitchKind, string> = {
  fastball: 'Locked in: fastball. Wind up when ready',
  curve: 'Locked in: curve. Wind up when ready',
};
const MOUSE_PICK_SUB = 'Pick a pitch, then hold to aim';
/** Mouse play: the bubble's second line. */
const MOUSE_SUB: Record<PitchKind, string> = {
  fastball: 'Fastball. Hold to aim, let go to throw',
  curve: 'Curveball. Hold to aim, let go to throw',
};

export const createPitching: SportFactory = (ctx: SportContext): PitchingSport => {
  const cfg = pitchingConfig;
  const hand: Side = ctx.calibration?.handedness ?? 'right';
  const sg = sideSign(hand);
  const gloveHand = gloveSide(hand);
  const isDebug = ctx.input.source === null;
  const mc = isDebug ? asMouseControl(ctx.input) : null;
  const mouse = mc !== null;
  const game = createGame(
    pitchesFor(cfg, ctx.short),
    ctx.random,
    isDebug,
    ctx.short ? cfg.shortGapScale : 1,
    cfg.firstPitchExtraMs,
    cfg.curveShare,
    mouse,
  );
  const unregister = ctx.tunables.register('pitching', 'Pitching', cfg, pitchingRanges);
  const animator = new AvatarAnimator(ctx.avatar);
  const stage = ctx.stage;
  const scene = stage.scene;
  const camera = stage.camera;
  const plateZ = -cfg.plateDistance;
  const S = cfg.zoneVisualScale;

  // ---- world ----
  const world = buildWorld(scene, cfg);
  const zone = buildZone(scene, cfg, game.total);
  const marker = buildAimMarker(scene, cfg);
  const bubble = createBubble();
  const liveAim = new LiveAim();
  const liveIn = createLiveInput();
  const liveRelease = createAim();
  const bubbleAnchor = new Vector3();
  let bubbleMain = '';
  let bubbleSub = '';
  let bubbleTone: 'call' | 'good' | 'bad' = 'call';
  let callLine = '';
  const buttons = createPitchButtons((kind) => {
    if (pickKind(game, kind)) note(`pick ${kind}`);
  });
  buttons.setShown(mouse);
  // Mouse play: the throw is a press (wind-up) and a release, in the fixed update.
  const rayNear = new Vector3();
  const rayDir = new Vector3();
  const ptScratch: Point = { x: 0, y: 0 };
  let winding = false;
  let pressArmed = false;
  let seenPresses = 0;
  const groundWasVisible = stage.ground.visible;
  stage.ground.visible = false;
  const fog = scene.fog as Fog | null;
  const fogNear = fog?.near ?? 0;
  const fogFar = fog?.far ?? 0;
  if (fog !== null) {
    fog.near = cfg.fogNear;
    fog.far = cfg.fogFar;
  }
  const savedFov = camera.fov;
  camera.fov = cfg.cameraFov;
  camera.updateProjectionMatrix();
  ctx.avatar.root.position.set(0, MOUND_HEIGHT, 0);

  // The catcher: a second headless athlete, crouched behind the plate, facing the pitcher.
  const catcher = new AvatarRig({ playerColor: CATCHER_COLOR, bodyColor: CATCHER_BODY });
  const catcherGroup = new Group();
  const catcherZ = plateZ - 0.6;
  /** The catcher's mitt sits just in front of the drawn zone, so the lit tile never hides it. */
  const mittZ = plateZ + 0.1;
  catcherGroup.position.set(0, 0, catcherZ);
  catcherGroup.rotation.y = Math.PI;
  catcherGroup.scale.setScalar(cfg.catcherScale);
  catcherGroup.add(catcher.root);
  scene.add(catcherGroup);
  catcher.setLeg('left', 1.45, 2.1);
  catcher.setLeg('right', 1.45, 2.1);
  catcher.setPelvisOffset(-0.43);
  const catcherShadow = new BlobShadow(0.6 * cfg.catcherScale);
  scene.add(catcherShadow.mesh);

  // The ball: in the pitcher's mitt while held, in the air, then in the catcher's mitt.
  const ballGeometry = new SphereGeometry(cfg.ballRadius, 16, 12);
  const ball = new Mesh(ballGeometry, toonMaterial(BALL_COLOR));
  ball.name = 'ball';
  ball.frustumCulled = false;
  const ballShadow = new BlobShadow(0.16);
  scene.add(ballShadow.mesh);
  const heldMitt = ctx.avatar.mitts[hand];
  heldMitt.add(ball);
  ball.position.set(0, 0.02, -0.03);
  /** 0 held in the pitcher's mitt, 1 in the air, 2 in the catcher's mitt (or past it). */
  let ballState = 0;

  // ---- scratch (nothing allocates per frame) ----
  const from: Vec3 = { x: 0, y: 0, z: 0 };
  const to: Vec3 = { x: 0, y: 0, z: 0 };
  const pos: Vec3 = { x: 0, y: 0, z: 0 };
  const cell: Point = { x: 0, y: 0 };
  const ballWorld = ball.position.clone();
  const liveScratch: Point = { x: 0, y: 0 };
  const hin: HandInput = { present: false, known: false, closed: false, speed: 0 };
  let breakX = 0;
  let breakY = 0;
  let lastCurvature = 0;
  let lastSpeed = 0;
  let mittX = 0;
  let mittY = 1;
  let lungeX = 0;
  let lungeGoal = 0;

  // ---- events: queued by the handler, taken in fixedUpdate against the game clock ----
  const pending: GameEvent[] = [];
  const log: string[] = [];
  const note = (text: string): void => {
    log.push(text);
    if (log.length > 40) log.shift();
  };
  const offThrow = ctx.input.on('ThrowReleased', (e) => {
    // Gestures made while the round is paused (player out of frame) do not count.
    if (!ctx.paused) pending.push(e);
    else game.ignored.paused++;
  });

  // ---- phase reactions ----
  let seenCall = 0;
  let seenReveal = 0;
  let seenSelect = 0;
  let seenWindup = 0;
  let seenRelease = 0;
  let seenResult = 0;
  let seenNext = 0;
  let seenDone = 0;
  let finished = false;
  let started = false;
  let handCrops = true;
  let runningScore = 0;

  const setCrops = (on: boolean): void => {
    if (on === handCrops) return;
    handCrops = on;
    void ctx.input
      .setNeeds({ pose: true, handCrops: on, fullFrameHands: false })
      .catch(() => undefined);
  };

  let shownHint: string | null = '';
  const setHint = (text: string | null): void => {
    if (text === shownHint) return;
    shownHint = text;
    ctx.hud.setHint(text);
  };
  let shownScore = '';
  let shownSub = '';
  let shownMeterPct = -2;
  let shownMeterLabel = '';
  let shownMeterTone = '';
  let kmhShown = 0;

  const refreshHud = (): void => {
    const score = `${runningScore} pts`;
    if (score !== shownScore) {
      shownScore = score;
      ctx.hud.setScore(score);
    }
    const n = Math.min(game.index + 1, game.total);
    const kind =
      game.phase === 'sign' || game.phase === 'call' ? '' : ` · ${KIND_LABEL[game.kind]}`;
    const speed = game.phase === 'flight' || game.phase === 'result' ? kmhShown : 0;
    const sub = `Pitch ${n} of ${game.total}${kind}${speed > 0 ? ` · ${speed} km/h` : ''}`;
    if (sub !== shownSub) {
      shownSub = sub;
      ctx.hud.setSubScore(sub);
    }
    // The sign meter: how far the still hold has got, with the live reading.
    let pct = -1;
    let label = '';
    let tone: MeterTone = 'neutral';
    if (game.phase === 'sign') {
      if (game.reading === 'none' && game.stillTotalMs > 0) {
        pct = Math.floor(clamp01(game.stillTotalMs / cfg.signFallbackMs) * 20);
        label = 'Hand not read: fastball';
        tone = 'warn';
      } else if (game.reading === 'none') {
        pct = 0;
        label = 'Show your hand';
        tone = 'neutral';
      } else {
        pct = Math.floor(clamp01(game.holdMs / cfg.signHoldMs) * 20);
        label = game.reading === 'fastball' ? 'Fastball' : 'Curve';
        tone = 'good';
      }
    }
    if (pct !== shownMeterPct || label !== shownMeterLabel || tone !== shownMeterTone) {
      shownMeterPct = pct;
      shownMeterLabel = label;
      shownMeterTone = tone;
      if (pct < 0) ctx.hud.setMeter('sign', null);
      else ctx.hud.setMeter('sign', pct / 20, label, tone);
    }
  };

  const heldBall = (): void => {
    if (ball.parent !== heldMitt) {
      ball.removeFromParent();
      heldMitt.add(ball);
    }
    ball.position.set(0, 0.02, -0.03);
    ballState = 0;
    ball.visible = true;
  };

  const drawn = (v: Vec3, x: number, y: number): void => {
    v.x = drawX(cfg, x);
    v.y = drawY(cfg, y);
    v.z = plateZ;
  };

  const record = (): PitchRecord => game.records[game.records.length - 1]!;

  const react = (): void => {
    if (game.callSeq !== seenCall) {
      seenCall = game.callSeq;
      // The catcher sets up: the mitt goes to the called spot; the call itself comes a beat later.
      cellCentre(cfg, game.target, cell);
      callLine = callText(game.called, game.target);
      zone.setLit(-1);
      liveAim.reset();
      lungeGoal = 0;
      note(`call ${game.called} target=${game.target}`);
    }
    if (game.revealSeq !== seenReveal) {
      seenReveal = game.revealSeq;
      zone.setLit(game.target);
      ctx.audio.play('tick');
      setHint('Take your time: read the call');
    }
    if (game.selectSeq !== seenSelect) {
      seenSelect = game.selectSeq;
      ctx.audio.play('select');
      setCrops(false);
      note(`select ${game.kind}${game.usedFallback ? ' (fallback)' : ''}`);
    }
    if (game.windupSeq !== seenWindup) {
      seenWindup = game.windupSeq;
      setHint(mouse ? 'Hold to aim, let go to throw' : 'Aim with your glove hand, then throw');
    }
    if (game.releaseSeq !== seenRelease) {
      seenRelease = game.releaseSeq;
      // The ball leaves the pitcher's mitt exactly where the mitt is now.
      heldMitt.getWorldPosition(ballWorld);
      from.x = ballWorld.x;
      from.y = ballWorld.y;
      from.z = ballWorld.z;
      drawn(to, game.aim.x, game.aim.y);
      const curve = game.kind === 'curve';
      breakX = curve ? (-sg * cfg.curveSide + lastCurvature * cfg.curvatureGain) * S : 0;
      breakY = curve ? -cfg.curveDrop * S : 0;
      ball.removeFromParent();
      scene.add(ball);
      ballState = 1;
      kmhShown = Math.round(game.aim.kmh);
      setHint(null);
      ctx.audio.play('whoosh');
      const power = clamp01((lastSpeed - cfg.speedFloor) / (cfg.speedCeil - cfg.speedFloor));
      animator.play('throw-over', { side: hand, strength: 0.4 + 0.6 * power });
      lungeGoal = 0;
    }
    if (game.resultSeq !== seenResult) {
      seenResult = game.resultSeq;
      const r = record();
      bubbleTone = r.balk || !r.score.matched ? 'bad' : 'good';
      bubbleMain = r.balk ? 'Balk' : `${r.score.label} +${r.score.points}`;
      bubbleSub = reactionText(r.score.matched, r.balk, r.score.tier !== 'wild');
      if (r.balk) {
        ctx.audio.play('bad');
        ctx.hud.flash('bad');
        setHint('No pitch. Next call coming');
        animator.play('slump');
        zone.setLit(-1);
        heldBall();
      } else {
        runningScore += r.score.points;
        drawn(to, r.x, r.y);
        ballState = 2;
        ball.position.set(to.x, to.y, plateZ + 0.05);
        zone.addDot(r.x, r.y);
        const pts = r.score.points;
        if (r.score.tier === 'wild' || r.score.tier === 'near') {
          // The catcher lunges and misses.
          ctx.audio.play('thud', { pitch: 0.8, volume: 0.5 });
          lungeGoal = Math.max(-0.7, Math.min(0.7, to.x * 0.5));
          if (pts === 0) ctx.audio.play('bad');
          else ctx.audio.play('tick');
        } else {
          ctx.audio.play('thud');
          catcher.squash(0.12);
          if (pts >= 10) ctx.audio.play('great');
          else if (pts >= 5) ctx.audio.play('good');
          else ctx.audio.play('tick');
        }
        if (r.score.tier === 'bullseye') {
          ctx.hud.flash('great');
          animator.play('celebrate');
        } else if (pts === 0) {
          ctx.hud.flash('bad');
          animator.play('slump');
        } else {
          ctx.hud.flash('good');
        }
        setHint(`${r.kmh.toFixed(0)} km/h`);
      }
      note(
        `result #${r.index} ${r.kind} called=${r.called} target=${r.target} balk=${r.balk} x=${r.x.toFixed(2)} y=${r.y.toFixed(2)} ${r.score.tier} +${r.score.points}`,
      );
    }
    if (game.nextSeq !== seenNext) {
      seenNext = game.nextSeq;
      zone.setLit(-1);
      heldBall();
      lungeGoal = 0;
      if (animator.busy) animator.stop();
      setCrops(true);
      setHint('The catcher is calling the next pitch');
    }
    if (game.doneSeq !== seenDone) {
      seenDone = game.doneSeq;
      finish();
    }
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    const s = summarize(game.records);
    if (s.score > (ctx.best ?? 0)) {
      ctx.audio.play('cheer');
      animator.play('celebrate');
    }
    const lines = [
      `${s.strikes} of ${s.pitches} pitches in the zone`,
      s.bullseyes === 1 ? '1 pitch on the target' : `${s.bullseyes} pitches on the target`,
      `${s.asCalled} of ${s.pitches} thrown as called`,
      s.bestKmh > 0 ? `Fastest pitch ${s.bestKmh} km/h` : 'No pitch thrown',
    ];
    ctx.finish({
      score: s.score,
      headline: `${s.score} pts`,
      lines,
      detail: {
        pitches: s.pitches,
        strikes: s.strikes,
        bullseyes: s.bullseyes,
        balks: s.balks,
        fastballs: s.fastballs,
        curves: s.curves,
        asCalled: s.asCalled,
        bestKmh: s.bestKmh,
        meanMissCm: s.meanMissCm,
      },
    });
  };

  // Lazily built list for the probe (rebuilt only when a pitch is added).
  let probeCount = -1;
  let probeList: PitchProbe[] = [];
  const probe = (): readonly PitchProbe[] => {
    if (probeCount !== game.records.length) {
      probeCount = game.records.length;
      probeList = game.records.map((r) => ({
        index: r.index,
        kind: r.kind,
        called: r.called,
        matched: r.score.matched,
        target: r.target,
        balk: r.balk,
        x: r.x,
        y: r.y,
        kmh: r.kmh,
        points: r.score.points,
        tier: r.score.tier,
        cell: r.score.cell,
      }));
    }
    return probeList;
  };

  // ---- live aim ----
  let liveVisible = false;
  /** Mouse play: the ring is under the cursor while the button is held (pointer ray on the zone plane). */
  const updateMouseLive = (m: MouseControl, nowMs: number): void => {
    liveVisible = false;
    if (!m.pointerDown) return;
    camera.updateMatrixWorld();
    rayNear.set(m.pointerX * 2 - 1, 1 - m.pointerY * 2, 0.5).unproject(camera);
    rayDir.copy(rayNear).sub(camera.position);
    if (rayDir.z >= -1e-6) return;
    const u = (plateZ - camera.position.z) / rayDir.z;
    pointedAim(cfg, camera.position.x + rayDir.x * u, camera.position.y + rayDir.y * u, ptScratch);
    liveAim.setDirect(nowMs, ptScratch.x, ptScratch.y);
    liveVisible = true;
  };

  const updateLive = (): void => {
    const st = ctx.input.state;
    if (!st.tracking || !st.hasPose) {
      liveVisible = false;
      return;
    }
    // The glove hand places the ring. It counts as tracked while its wrist is visible.
    const wristIdx = gloveHand === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST;
    const gloveSeen = st.pose[wristIdx * POSE_STRIDE + 3]! >= cfg.gloveMinVisibility;
    trackedLive(cfg, st.arms[gloveHand], st.arms[hand].speed, hand, gloveSeen, liveIn, liveScratch);
    const t = st.t;
    // Before the pitch is picked the indicator follows the hand's own reading, else the call.
    let kind: PitchKind = game.kind;
    if (game.phase === 'call' || game.phase === 'sign') {
      kind = game.reading === 'none' ? game.called : game.reading;
    }
    liveAim.update(cfg, t, liveIn, hand, kind, game.target, liveScratch);
    liveVisible = true;
  };

  /**
   * Mouse play: a press during the wind-up window starts the throw, the release throws it. A press
   * made while the call is still being read waits (the ring already follows it) and starts the
   * moment the window opens. Never allocates.
   */
  const driveMouseThrow = (m: MouseControl): void => {
    if (m.pointerPresses !== seenPresses) {
      seenPresses = m.pointerPresses;
      pressArmed = game.phase === 'call' || game.phase === 'windup';
    }
    if (!winding && pressArmed && game.phase === 'windup' && !ctx.paused) {
      pressArmed = false;
      winding = true;
      m.startWindup(hand);
    }
    if (!m.pointerDown) {
      if (winding) {
        winding = false;
        m.releaseThrow();
      }
      pressArmed = false;
    }
  };

  // ---- catcher and camera (called every frame) ----
  const placeCamera = (): void => {
    camera.position.set(-sg * cfg.cameraSide, cfg.cameraUp, cfg.cameraBack);
    camera.lookAt(0, cfg.cameraLookY, plateZ);
  };

  const driveCatcher = (dt: number): void => {
    // Where the mitt should be: on the lit cell during the wind-up and flight, on the ball after.
    let gx = 0;
    let gy = cfg.zoneDrawCentreY * 0.9;
    if (
      game.phase === 'call' ||
      game.phase === 'sign' ||
      game.phase === 'windup' ||
      game.phase === 'flight'
    ) {
      gx = drawX(cfg, cell.x);
      gy = drawY(cfg, cell.y);
    } else if (ballState === 2 && (game.phase === 'result' || game.phase === 'done')) {
      gx = ball.position.x;
      gy = ball.position.y;
    }
    gy = Math.max(0.4, Math.min(2.6, gy));
    gx = Math.max(-1.4, Math.min(1.4, gx));
    const k = 1 - Math.exp(-14 * dt);
    mittX += (gx - mittX) * k;
    mittY += (gy - mittY) * k;
    lungeX += (lungeGoal - lungeX) * (1 - Math.exp(-9 * dt));
    catcherGroup.position.x = lungeX;
    // Glove arm (the catcher's left, which is on screen right when it faces the pitcher): the
    // target is in the rig's own frame, which faces the pitcher after the half turn.
    const gz = mittZ - catcherZ;
    catcher.setArmTarget(
      'left',
      -(mittX - lungeX) / cfg.catcherScale,
      mittY / cfg.catcherScale,
      -gz / cfg.catcherScale,
      -0.35,
      0.2,
      0.5,
    );
    catcher.update(dt);
    catcherShadow.follow(catcher.root, 0);
  };

  const driveCallUi = (): void => {
    // The aim marker: from the reveal of the call until the release.
    const aiming = game.bubbleOn && liveVisible && liveAim.ready && !finished;
    if (aiming && (game.phase === 'call' || game.phase === 'sign' || game.phase === 'windup')) {
      marker.show(liveAim.aim.x, liveAim.aim.y);
    } else {
      marker.hide();
    }
    // The bubble: the call from the reveal until the release, then the catcher's reaction.
    const reaction = game.phase === 'result';
    const show = !finished && game.phase !== 'done' && (game.bubbleOn || reaction);
    if (show) {
      if (reaction) {
        bubble.setText(bubbleMain, bubbleSub, bubbleTone);
      } else {
        let sub: string;
        if (mouse) sub = game.phase === 'windup' ? MOUSE_SUB[game.kind] : MOUSE_PICK_SUB;
        else if (game.phase === 'sign') sub = READING_SUB[game.reading];
        else if (game.phase === 'windup') sub = LOCKED_SUB[game.kind];
        else sub = 'Read the call. Take your time';
        bubbleMain = callLine;
        bubbleSub = sub;
        bubble.setText(callLine, sub, 'call');
      }
      bubbleAnchor.set(catcherGroup.position.x, cfg.bubbleHeight, catcherZ);
      bubbleAnchor.project(camera);
      bubble.place(
        (bubbleAnchor.x * 0.5 + 0.5) * window.innerWidth,
        (0.5 - bubbleAnchor.y * 0.5) * window.innerHeight,
      );
    }
    bubble.setVisible(show);
  };

  const sport: PitchingSport = {
    get phase(): Phase {
      return game.phase;
    },
    get index(): number {
      return game.index;
    },
    get kind(): PitchKind {
      return game.kind;
    },
    get called(): PitchKind {
      return game.called;
    },
    get callText(): string {
      return callLine;
    },
    get bubble(): { visible: boolean; text: string; sub: string } {
      return { visible: bubble.visible, text: bubbleMain, sub: bubbleSub };
    },
    get aimMarker(): { visible: boolean; x: number; y: number; locked: boolean } {
      return {
        visible: marker.visible,
        x: liveAim.aim.x,
        y: liveAim.aim.y,
        locked: liveAim.locked,
      };
    },
    get reading(): Reading {
      return game.reading;
    },
    get target(): number {
      return game.target;
    },
    get score(): number {
      return runningScore;
    },
    get pitches(): readonly PitchProbe[] {
      return probe();
    },
    get ignoredThrows(): number {
      return totalIgnored(game);
    },
    get ignoredWrongHand(): number {
      return game.ignored.wrongHand;
    },
    get usedFallback(): boolean {
      return game.usedFallback;
    },
    get ball(): { visible: boolean; x: number; y: number; z: number } {
      ball.getWorldPosition(ballWorld);
      return { visible: ball.visible, x: ballWorld.x, y: ballWorld.y, z: ballWorld.z };
    },
    get log(): readonly string[] {
      return log;
    },

    start(): void {
      started = true;
      if (mc !== null) {
        // The button is the sport's: no built-in fist close; the mouse moves the throwing hand.
        mc.setManualMode(true);
        mc.selectHand(hand);
      }
      placeCamera();
      setHint('The catcher is calling the first pitch');
      refreshHud();
    },

    fixedUpdate(dt: number, nowMs: number): void {
      if (finished || !started) return;
      if (mc !== null) {
        updateMouseLive(mc, nowMs);
        driveMouseThrow(mc);
      } else {
        updateLive();
      }
      for (const e of pending) {
        if (e.type !== 'ThrowReleased') continue;
        // Mouse play has no power: a fixed good speed per pitch type.
        const speed = mouse ? mouseThrowSpeed(cfg, game.kind) : e.speed;
        const haveLive = liveAim.ready && liveAim.forRelease(cfg, e.t, !isDebug, liveRelease);
        const out = onThrow(
          game,
          cfg,
          nowMs,
          {
            t: e.t,
            hand: e.hand,
            speed,
            vy: e.vy,
            lateral: e.lateral,
            curvature: e.curvature,
            style: e.style,
          },
          hand,
          ctx.paused,
          haveLive ? liveRelease : null,
        );
        if (out === 'taken') {
          lastCurvature = e.curvature;
          lastSpeed = speed;
        }
        note(
          `throw ${e.hand} t=${e.t.toFixed(0)} now=${nowMs.toFixed(0)} speed=${speed.toFixed(1)} vy=${e.vy.toFixed(1)} lat=${e.lateral.toFixed(2)} ${out}`,
        );
      }
      pending.length = 0;
      const h = ctx.input.state.hands[hand];
      hin.present = h.present;
      hin.known = h.known;
      hin.closed = h.closed;
      hin.speed = ctx.input.state.arms[hand].speed;
      stepGame(game, cfg, dt, hin, ctx.paused);
      react();
    },

    frame(dt: number, nowMs: number): void {
      // The pitcher: the mirrored arms, a little extrapolated for the fast throw.
      if (!animator.busy) mirrorUpperBody(ctx.avatar, ctx.input.state, nowMs, 1.3);
      if (game.phase === 'windup' || game.phase === 'flight') {
        ctx.avatar.setMittCurl(hand, game.kind === 'fastball' ? 1 : 0.5);
      }
      animator.update(dt);

      // The ball.
      if (ballState === 1) {
        const u = game.flightMs > 0 ? game.flightElapsedMs / game.flightMs : 1;
        ballAt(cfg, from, to, u, game.kind === 'curve', breakX, breakY, pos);
        ball.position.set(pos.x, pos.y, pos.z);
        ballShadow.follow(ball, 0);
      } else if (ballState === 2) {
        ballShadow.mesh.visible = false;
      } else {
        ballShadow.mesh.visible = false;
      }
      ball.visible = game.phase !== 'done' || ballState === 2;

      zone.pulse(nowMs);
      driveCatcher(dt);
      placeCamera();
      driveCallUi();
      if (mouse) buttons.update(game.kind, canPick(game));
      if (!finished) refreshHud();
    },

    createBot(): SportBot {
      return createPitchingBot(cfg, game, hand, ctx.random);
    },

    dispose(): void {
      offThrow();
      unregister();
      buttons.dispose();
      mc?.setManualMode(false);
      bubble.dispose();
      marker.dispose();
      ball.removeFromParent();
      ballShadow.dispose();
      ballGeometry.dispose();
      catcherShadow.dispose();
      catcher.dispose();
      catcherGroup.removeFromParent();
      zone.dispose();
      world.dispose();
      stage.ground.visible = groundWasVisible;
      if (fog !== null) {
        fog.near = fogNear;
        fog.far = fogFar;
      }
      camera.fov = savedFov;
      camera.updateProjectionMatrix();
      ctx.avatar.root.position.set(0, 0, 0);
      ctx.avatar.setMittCurl(hand, 0);
      animator.reset();
      ctx.hud.clear();
    },
  };
  return sport;
};

export default createPitching;
