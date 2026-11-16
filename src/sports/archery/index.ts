import { mirrorUpperBody } from '../../core/avatarDrive';
import type { Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { Fog, Vector3 } from 'three/webgpu';
import {
  DampedValue,
  bowArmUp,
  otherSide,
  sideSign,
  swayAmplitude,
  swayOffset,
  wristDistanceRawException,
  wristMinVisibility,
  targetPitch,
  targetYaw,
} from './aim';
import type { Sway } from './aim';
import { asMouseControl } from '../../input/debug/mouseControl';
import { createArcheryBot } from './bot';
import type { TutorialProbe } from './bot';
import { createArcheryTutorial } from './tutorial';
import type { ArcheryTutorial } from './tutorial';
import { MouseDraw } from './mouseDraw';
import type { DrawState } from './mouseDraw';
import type { BotView } from './bot';
import { BowRig } from './bowRig';
import { archeryConfig, archeryRanges } from './config';
import { DrawMachine, StepEvent } from './draw';
import type { DrawSample, Hint, StepEventValue } from './draw';
import { Arrow, ArrowState, basePitch, hitOnPlane } from './flight';
import type { Hit } from './flight';
import { ArcheryRound } from './round';
import { ringScore } from './target';
import { createWorld } from './world';

export type ArcheryPhase = 'ready' | 'drawing' | 'flying' | 'showing' | 'finishing';

/** What tests and the bot may read from the live sport. */
export interface ArcherySport extends Sport {
  readonly phase: ArcheryPhase;
  readonly phaseLog: readonly string[];
  readonly draw: number;
  readonly arrowsShot: number;
  readonly arrowsTotal: number;
  readonly score: number;
  /** Where the arrow would land for the current aim, relative to the target centre, m. */
  readonly reticle: { x: number; y: number };
  readonly wind: number;
  /** 0 aiming camera .. 1 close view of the target. */
  readonly cameraBlend: number;
  readonly rings: readonly number[];
  readonly handedness: 'left' | 'right';
  /** Tutorial rounds: the current step (0-based), or -1 in a normal round. */
  readonly tutorialStep: number;
  /** Tutorial rounds: the number of steps, or 0 in a normal round. */
  readonly tutorialSteps: number;
}

const HINTS: Record<Hint, string> = {
  raise: 'Hold your bow arm out to the side',
  nock: 'Close your other fist next to it to nock',
  pull: 'Pull back to draw',
  aim: 'Aim with your bow arm, open your hand to release',
  lost: "I can't see your hands. Bring them back and keep drawing",
  further: 'Pull back further',
};

const MOUSE_HINTS: Record<Hint, string> = {
  raise: 'Hold the button to draw',
  nock: 'Hold the button to draw',
  pull: 'Keep holding to draw',
  aim: 'Let go to shoot',
  lost: 'Hold the button to draw',
  further: 'Hold a little longer',
};

const TAU = Math.PI * 2;
/** The fixed step the host runs, for interpolating the arrow. */
const STEP = 1 / 120;
/** Height of the archer's chest, m: the camera leans toward it so the archer stays in the picture. */
const ARCHER_CHEST = 1.2;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export const createArchery: SportFactory = (ctx: SportContext): ArcherySport => {
  const cfg = archeryConfig;
  const drawHand = ctx.calibration?.handedness ?? 'right';
  const bowHand = otherSide(drawHand);
  const bowSign = sideSign(bowHand);
  const unregister = ctx.tunables.register('archery', 'Archery', cfg, archeryRanges);
  const animator = new AvatarAnimator(ctx.avatar);

  // Scene: push the fog out so the target is crisp, build the range and the bow.
  const scene = ctx.stage.scene;
  if (scene.fog instanceof Fog) {
    scene.fog.near = 90;
    scene.fog.far = 420;
  }
  const camera = ctx.stage.camera;
  const world = createWorld(scene, cfg);
  const bow = new BowRig(
    ctx.avatar.mitts[bowHand],
    ctx.avatar.mitts[drawHand],
    world.arrowGeometry,
  );

  const machine = new DrawMachine(cfg);
  // Camera off: the mouse aims with the bow hand and the button draws. Null for tracked input.
  const mouse = asMouseControl(ctx.input);
  const mouseDraw = new MouseDraw(cfg, mouse?.pointerPresses ?? 0, mouse?.pointerReleases ?? 0);
  const dm: DrawState = mouse !== null ? mouseDraw : machine;
  const hints = mouse !== null ? MOUSE_HINTS : HINTS;
  const drawSign = sideSign(drawHand);
  let pausedSeen = false;
  let handsClosed = false;
  if (mouse !== null) {
    mouse.setManualMode(true);
    mouse.setPointerFollow(true);
    mouse.selectHand(bowHand);
  }
  // A tutorial has no arrow limit, no wind and no sway: nothing in it can be lost.
  const tut = ctx.tutorial;
  const round = new ArcheryRound(
    tut ? cfg.tutorialArrows : ctx.short ? cfg.shortArrows : cfg.arrows,
  );
  const base = basePitch(cfg);
  const backZ = -cfg.targetDistance - 1.45;
  const yawF = new DampedValue();
  const pitchF = new DampedValue();
  const camBlend = new DampedValue();
  const fovK = new DampedValue();
  const arrow = new Arrow();
  const hit: Hit = { x: 0, y: 0, t: 0 };
  const tutHit: Hit = { x: 0, y: 0, t: 0 };
  const sway: Sway = { x: 0, y: 0 };
  const sample: DrawSample = {
    valid: false,
    bowUp: false,
    dist: 0,
    minVis: 0,
    present: false,
    known: false,
    closed: false,
    yaw: 0,
    pitch: 0,
  };

  // Seeded per-round values: sway phases, and a crosswind per arrow (the first is always calm).
  const phases = new Float64Array(4);
  for (let i = 0; i < 4; i++) phases[i] = ctx.random() * TAU;
  const winds: number[] = [];
  for (let i = 0; i < round.total; i++) {
    const w = i === 0 ? 0 : Math.round((ctx.random() * 2 - 1) * cfg.maxWind * 10) / 10;
    winds.push(tut ? w * cfg.tutorialWindScale : w);
  }

  let phase: ArcheryPhase = 'ready';
  const phaseLog: string[] = ['ready'];
  let started = false;
  let finished = false;
  let simMs = 0;
  let clockOff = 0;
  let showT = 0;
  let finishIn = 0;
  let tick50 = false;
  let tick100 = false;
  let aimYaw = 0;
  let aimPitch = 0;
  let frozenYaw = 0;
  let frozenPitch = 0;
  let reticleX = 0;
  let reticleY = 0;
  let lastImpactX = 0;
  let lastImpactY = cfg.targetHeight;
  let shownScore = -1;
  let shownLeft = -1;
  let shownWind = Number.NaN;
  let shownHint: string | null = '';
  let meterOn = false;
  let flagWind = 0;
  // Tutorial: what the steps read.
  const probe: TutorialProbe = { hold: false };
  let tutorial: ArcheryTutorial | null = null;
  let trackedNow = false;
  let bowUpNow = false;
  let aimOff = 0;
  let launched = 0;

  const currentWind = (): number => winds[Math.min(round.taken, winds.length - 1)] ?? 0;

  const setPhase = (next: ArcheryPhase): void => {
    if (phase === next) return;
    phase = next;
    phaseLog.push(next);
  };

  const unsubClose = ctx.input.on('FistClosed', (e) => {
    if (e.hand === drawHand && !ctx.paused) machine.noteClosed();
  });
  const unsubOpen = ctx.input.on('FistOpened', (e) => {
    if (e.hand === drawHand && !ctx.paused) machine.noteOpened(e.t - clockOff);
  });

  const refreshHud = (): void => {
    const score = round.score;
    if (score !== shownScore) {
      shownScore = score;
      ctx.hud.setScore(`${score} pts`);
    }
    const wind = currentWind();
    const left = round.left;
    if (!tut && (left !== shownLeft || wind !== shownWind)) {
      shownLeft = left;
      shownWind = wind;
      const w =
        Math.abs(wind) < 0.05 ? 'calm' : `${Math.abs(wind).toFixed(1)} ${wind > 0 ? '→' : '←'}`;
      ctx.hud.setSubScore(`${left} ${left === 1 ? 'arrow' : 'arrows'} left · Wind ${w}`);
    }
    let hint: string | null = null;
    if (phase === 'ready' || phase === 'drawing') hint = hints[dm.hint];
    if (hint !== shownHint) {
      shownHint = hint;
      ctx.hud.setHint(hint);
    }
    const drawing = phase === 'drawing';
    if (drawing) {
      const lost = mouse === null && !machine.tracking;
      ctx.hud.setMeter(
        'draw',
        dm.draw,
        lost ? 'Draw (hold on)' : 'Draw',
        !lost && dm.draw >= cfg.minDraw ? 'good' : 'warn',
      );
      meterOn = true;
    } else if (meterOn) {
      meterOn = false;
      ctx.hud.setMeter('draw', null);
    }
  };

  const ringBanner = (ring: number): string =>
    ring === 10 ? '10!' : ring === 0 ? 'Miss' : String(ring);

  const onImpact = (): void => {
    world.hideFlying();
    const stuck = arrow.state === ArrowState.Stuck;
    let ring = 0;
    let r = Math.hypot(arrow.x, arrow.y - cfg.targetHeight, arrow.z + cfg.targetDistance);
    if (arrow.crossed) {
      r = Math.hypot(arrow.planeX, arrow.planeY - cfg.targetHeight);
      if (stuck) ring = ringScore(r, cfg.targetRadius, cfg.lineTolerance);
      lastImpactX = arrow.planeX;
      lastImpactY = arrow.planeY;
    } else {
      lastImpactX = arrow.x;
      lastImpactY = cfg.targetHeight;
    }
    round.record(ring, r);
    world.addStuck(arrow.x, arrow.y, arrow.z, arrow.vx, arrow.vy, arrow.vz);
    ctx.audio.play('thud');
    ctx.hud.setBanner(ringBanner(ring), 1200);
    if (ring === 10) {
      ctx.hud.flash('great');
      ctx.audio.play('great');
    } else if (ring >= 7) {
      ctx.hud.flash('good');
      ctx.audio.play('good');
    } else if (ring === 0 && !tut) {
      ctx.hud.flash('bad');
      ctx.audio.play('bad');
    }
    tutorial?.noteImpact(ring);
    showT = 0;
    setPhase('showing');
  };

  const launch = (): void => {
    const shot = dm.shot;
    arrow.launch(cfg, base, shot.draw, shot.yaw, shot.pitch, currentWind());
    ctx.audio.play('whoosh', { pitch: 0.8 + shot.draw * 0.5 });
    launched++;
    animator.play('bow-release', { side: drawHand });
    bow.twang();
    world.setReticle(false, 0, 0, 1);
    setPhase('flying');
  };

  const finishRound = (): void => {
    finished = true;
    const total = round.score;
    if (ctx.best === null || total > ctx.best) ctx.audio.play('cheer');
    ctx.finish({
      score: total,
      headline: `${total} pts`,
      lines: [`Rings: ${round.ringsText()}`, `Bullseyes: ${round.tens}`],
      detail: {
        arrows: round.total,
        total,
        tens: round.tens,
        misses: round.misses,
        bestRing: round.bestRing,
        meanErrorCm: Math.round(round.meanErrorCm * 10) / 10,
      },
    });
  };

  const fixedUpdate = (dt: number, nowMs: number): void => {
    if (!started || finished) return;
    simMs += dt * 1000;
    clockOff = nowMs - simMs;

    if (phase === 'flying') {
      if (arrow.step(dt, cfg, cfg.targetRadius + cfg.lineTolerance, backZ) !== ArrowState.Flying) {
        onImpact();
      }
    } else if (phase === 'showing') {
      showT += dt * 1000;
      if (showT >= cfg.showHitMs) {
        if (round.over) {
          setPhase('finishing');
          const good = round.score >= round.total * 5;
          animator.play(good ? 'celebrate' : 'slump');
          finishIn = cfg.finishDelayS;
          if (good) ctx.audio.play('cheer');
        } else {
          dm.unlock();
          setPhase('ready');
        }
      }
    } else if (phase === 'finishing') {
      finishIn -= dt;
      if (finishIn <= 0 && round.takeFinish()) finishRound();
      return;
    }

    // Read the player: bow arm, wrist distance, draw hand.
    const s = ctx.input.state;
    const bowArm = s.arms[bowHand];
    let ev: StepEventValue;
    if (mouse !== null) {
      // The pointer is the bow hand: it always aims, with no reach test and no sway.
      if (pausedSeen) {
        pausedSeen = false;
        if (phase === 'drawing' || phase === 'ready') {
          mouseDraw.cancel(mouse.pointerPresses, mouse.pointerReleases);
          setPhase('ready');
        }
      }
      frozenYaw = targetYaw(bowArm.wristX, bowHand, cfg);
      frozenPitch = targetPitch(bowArm.wristY, cfg);
      yawF.update(frozenYaw, dt, cfg.aimSmoothS);
      pitchF.update(frozenPitch, dt, cfg.aimSmoothS);
      sway.x = 0;
      sway.y = 0;
      aimYaw = yawF.value;
      aimPitch = pitchF.value;
      ev = mouseDraw.step(
        dt,
        mouse.pointerDown,
        mouse.pointerPresses,
        mouse.pointerReleases,
        aimYaw,
        aimPitch,
      );
    } else {
      const dh = s.hands[drawHand];
      const dist = wristDistanceRawException(
        s.pose,
        s.aspect,
        s.shoulderWidth,
        cfg.minWristVisibility,
      );
      const valid = s.hasPose && s.tracking && dist >= 0;
      const bowUp =
        valid && bowArmUp(bowArm.wristX, bowArm.wristY, cfg, machine.phase === 'drawing');
      if (bowUp) {
        frozenYaw = targetYaw(bowArm.wristX, bowHand, cfg);
        frozenPitch = targetPitch(bowArm.wristY, cfg);
      }
      // Hold the aim while the bow arm is not usable: never guess.
      yawF.update(frozenYaw, dt, cfg.aimSmoothS);
      pitchF.update(frozenPitch, dt, cfg.aimSmoothS);
      trackedNow = valid;
      bowUpNow = bowUp;
      if (machine.phase === 'drawing') {
        const amp = swayAmplitude(machine.holdFullS, cfg) * (tut ? cfg.tutorialSwayScale : 1);
        swayOffset(simMs / 1000, amp, phases, sway);
      } else {
        sway.x = 0;
        sway.y = 0;
      }
      aimYaw = yawF.value + sway.x;
      aimPitch = pitchF.value + sway.y;

      sample.valid = valid;
      sample.bowUp = bowUp;
      sample.dist = dist;
      sample.minVis = wristMinVisibility(s.pose);
      sample.present = dh.present;
      sample.known = dh.known;
      sample.closed = dh.closed;
      sample.yaw = aimYaw;
      sample.pitch = aimPitch;
      ev = machine.step(dt, simMs, sample);
    }
    if (tut) {
      // Where a full draw would land for this aim: the aim steps read it.
      hitOnPlane(cfg, base, 1, aimYaw, aimPitch, 0, tutHit);
      aimOff = Math.hypot(tutHit.x, tutHit.y - cfg.targetHeight);
    }

    if (ev === StepEvent.Nock || ev === StepEvent.AutoNock) {
      ctx.audio.play('grab');
      tick50 = false;
      tick100 = false;
      if (ev === StepEvent.AutoNock) ctx.hud.setBanner('Auto-nock', 900);
      setPhase('drawing');
    } else if (ev === StepEvent.Unnock || ev === StepEvent.Cancel) {
      setPhase('ready');
    } else if (ev === StepEvent.Shot) {
      launch();
    }

    if (phase === 'drawing') {
      if (!tick50 && dm.draw >= 0.5) {
        tick50 = true;
        ctx.audio.play('tick');
      }
      if (!tick100 && dm.draw >= 0.98) {
        tick100 = true;
        ctx.audio.play('tick', { pitch: 1.5 });
      }
      hitOnPlane(cfg, base, dm.draw, aimYaw, aimPitch, currentWind(), hit);
      reticleX = hit.x;
      reticleY = hit.y - cfg.targetHeight;
    } else {
      reticleX = 0;
      reticleY = 0;
    }
  };

  // Camera scratch.
  const basePos = new Vector3();
  const baseLook = new Vector3();
  const showPos = new Vector3(bowSign * 2.4, 1.55, -cfg.targetDistance + 4.8);
  const showLook = new Vector3();
  const look = new Vector3();
  const toArcher = new Vector3();
  let lastFov = 0;

  const updateCamera = (dt: number): void => {
    camBlend.update(phase === 'showing' ? 1 : 0, dt, 0.28);
    fovK.update(phase === 'drawing' ? dm.draw : 0, dt, 0.25);
    const b = camBlend.value;
    // Behind the archer on the bow side and above the line to the target, pitched down a little
    // so the archer fills the lower part of the picture and the target sits above the centre.
    basePos.set(bowSign * cfg.camSide, cfg.camHeight, cfg.camBack);
    baseLook.set(0, cfg.targetHeight, -cfg.targetDistance).sub(basePos).normalize();
    toArcher.set(0, ARCHER_CHEST, 0).sub(basePos).normalize();
    baseLook.lerp(toArcher, cfg.camLookArcher).normalize();
    baseLook.y -= Math.tan(cfg.camPitchDown);
    baseLook.multiplyScalar(10).add(basePos);
    showLook.set(lastImpactX * 0.6, lerp(cfg.targetHeight, lastImpactY, 0.5), -cfg.targetDistance);
    camera.position.set(
      lerp(basePos.x, showPos.x, b),
      lerp(basePos.y, showPos.y, b),
      lerp(basePos.z, showPos.z, b),
    );
    look.set(
      lerp(baseLook.x, showLook.x, b),
      lerp(baseLook.y, showLook.y, b),
      lerp(baseLook.z, showLook.z, b),
    );
    camera.lookAt(look);
    const fov = lerp(lerp(cfg.fovBase, cfg.fovDraw, fovK.value), cfg.fovShow, b);
    if (Math.abs(fov - lastFov) > 0.01) {
      lastFov = fov;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  const frame = (dt: number, nowMs: number, alpha: number): void => {
    if (tutorial !== null && !ctx.paused) tutorial.update(nowMs);
    if (mouse !== null) {
      if (ctx.paused) pausedSeen = true;
      // The draw hand pulls back from the bow hand in proportion to the draw.
      const drawing = phase === 'drawing';
      if (drawing !== handsClosed) {
        handsClosed = drawing;
        mouse.setHandClosed(drawHand, drawing);
      }
      const pull = drawing ? 0.04 + dm.draw * 0.14 : 0.03;
      const hx = mouse.pointerX + drawSign * pull;
      mouse.setHandTarget(drawHand, hx < 0.02 ? 0.02 : hx > 0.98 ? 0.98 : hx, mouse.pointerY);
    }
    if (!animator.busy) mirrorUpperBody(ctx.avatar, ctx.input.state, nowMs);
    animator.update(dt);
    bow.update(dt, phase === 'drawing', dm.draw);
    if (phase === 'drawing') {
      const radius = lerp(cfg.reticleMaxM, cfg.reticleMinM, dm.draw);
      world.setReticle(true, reticleX, reticleY + cfg.targetHeight, radius);
    }
    if (phase === 'flying') {
      const k = alpha * STEP;
      world.showFlying(
        arrow.x + arrow.vx * k,
        arrow.y + arrow.vy * k,
        arrow.z + arrow.vz * k,
        arrow.vx,
        arrow.vy,
        arrow.vz,
      );
    }
    // The flag leans with the wind of the arrow in play.
    flagWind += (currentWind() - flagWind) * Math.min(1, dt * 3);
    world.setFlag(flagWind, nowMs / 1000);
    updateCamera(dt);
    if (started) refreshHud();
  };

  const view: BotView = {
    get phase(): string {
      return phase;
    },
    get draw(): number {
      return dm.draw;
    },
    get hitX(): number {
      return reticleX;
    },
    get hitY(): number {
      return reticleY;
    },
    get arrowsShot(): number {
      return round.taken;
    },
  };

  const sport: ArcherySport = {
    start(): void {
      started = true;
      shownHint = '';
      shownLeft = -1;
      shownWind = Number.NaN;
      shownScore = -1;
      if (tut) {
        // The coach panel is the instruction line; no arrows-left count, wind or best.
        ctx.hud.setSubScore(null);
        tutorial = createArcheryTutorial({
          cfg,
          coach: ctx.coach,
          mouse: mouse !== null,
          probe,
          view: {
            tracked: () => trackedNow,
            bowUp: () => bowUpNow,
            phase: () => phase,
            draw: () => dm.draw,
            lost: () => phase === 'drawing' && mouse === null && !machine.tracking,
            aimOff: () => aimOff,
            launched: () => launched,
            impacts: () => round.taken,
          },
          onFinished: () => {
            ctx.audio.play('cheer');
            ctx.hud.flash('great');
            ctx.finishTutorial();
          },
        });
      }
      refreshHud();
    },
    fixedUpdate,
    frame,
    createBot(): SportBot {
      return createArcheryBot(view, cfg, drawHand, ctx.random, tut ? probe : undefined);
    },
    dispose(): void {
      tutorial?.dispose();
      unsubClose();
      unsubOpen();
      unregister();
      if (mouse !== null) {
        mouse.setHandClosed(drawHand, false);
        mouse.setManualMode(false);
      }
      animator.stop();
      bow.dispose();
      world.dispose();
      ctx.hud.clear();
    },
    get phase(): ArcheryPhase {
      return phase;
    },
    get phaseLog(): readonly string[] {
      return phaseLog;
    },
    get draw(): number {
      return dm.draw;
    },
    get arrowsShot(): number {
      return round.taken;
    },
    get arrowsTotal(): number {
      return round.total;
    },
    get score(): number {
      return round.score;
    },
    get reticle(): { x: number; y: number } {
      return { x: reticleX, y: reticleY };
    },
    get wind(): number {
      return currentWind();
    },
    get cameraBlend(): number {
      return camBlend.value;
    },
    get rings(): readonly number[] {
      return round.shots.map((s) => s.ring);
    },
    get handedness(): 'left' | 'right' {
      return drawHand;
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

export default createArchery;
