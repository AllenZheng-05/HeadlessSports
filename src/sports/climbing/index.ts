import type { Sport, SportContext, SportFactory } from '../../core/sport';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { Group, Vector3 } from 'three/webgpu';
import { createClimbBot } from './bot';
import type { TutorialProbe } from './bot';
import { climbingConfig, climbingRanges } from './config';
import { Layout, mulberry32 } from './layout';
import { chooseHold } from './plan';
import {
  createPointerControl,
  pointerPress,
  pointerRelease,
  pointerStep,
  pointerTarget,
} from './pointer';
import { asMouseControl } from '../../input/debug/mouseControl';
import { wallToHand } from './reach';
import type { Vec2 } from './reach';
import { createScreenMap, updateScreenMap, wallToScreen } from './screenMap';
import {
  RIG_SHOULDER_HEIGHT,
  createClimbState,
  createStepInput,
  heightOf,
  shoulderDrop,
  step,
} from './rules';
import type { HandSlot } from './rules';
import { createClimbTutorial, keepSafe } from './tutorial';
import type { ClimbTutorial } from './tutorial';
import { WallScene } from './wallScene';

/** What the browser tests and the debugging overlay read from `__game.sport`. */
export interface ClimbingSport extends Sport {
  /** Height of the climber's feet above the start, metres. */
  readonly height: number;
  readonly best: number;
  readonly grabs: number;
  readonly stamina: number;
  readonly status: string;
  readonly holding: { left: boolean; right: boolean };
  readonly layoutChecksum: number;
  /** Mouse play only: the hand the mouse controls right now, else null. */
  readonly pointerHand: 'left' | 'right' | null;
  /** Mouse play only: true from a press that grabbed a hold until the button is released. */
  readonly pointerDragging: boolean;
  /** Mouse play only: the hold a click at this image position would take for the mouse hand, or -1. */
  pointerHoldAt(x: number, y: number): number;
  /** Image position (mirrored normalised) where this hand should go to take the next hold. */
  aimImage(side: 'left' | 'right'): { x: number; y: number } | null;
  /** Hold index each hand is on, -1 when free. */
  readonly holdIndex: { left: number; right: number };
  /** Screen position (0..1 over the window, y down) where a hold is drawn, as the camera is now. */
  holdScreen(index: number): { x: number; y: number };
  /** The hold a bot would take next with this hand, or -1. */
  nextHold(side: 'left' | 'right'): number;
  /** Tutorial rounds: the current step (0-based), or -1 in a normal round. */
  readonly tutorialStep: number;
  /** Tutorial rounds: the number of steps, or 0 in a normal round. */
  readonly tutorialSteps: number;
}

const SHOULDER_X = 0.2;
/** Longest the visible arm may stretch (rig metres), a little short of straight. */
const ARM_MAX = 0.5;

function smoothDamp(
  cur: number,
  target: number,
  vel: Float64Array,
  smoothTime: number,
  dt: number,
): number {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel[0]! + omega * change) * dt;
  vel[0] = (vel[0]! - omega * temp) * e;
  return target + (change + temp) * e;
}

export const createClimbing: SportFactory = (ctx: SportContext): ClimbingSport => {
  const cfg = climbingConfig;
  const rng = mulberry32(Math.floor(ctx.random() * 4294967296));
  const layout = new Layout(rng, cfg);
  const tut = ctx.tutorial;
  // A tutorial has no timer.
  const roundSeconds = tut
    ? Number.POSITIVE_INFINITY
    : ctx.short
      ? cfg.shortRoundSeconds
      : cfg.roundSeconds;
  const state = createClimbState(cfg, roundSeconds);
  const input = createStepInput();
  const animator = new AvatarAnimator(ctx.avatar);
  animator.setBreathing(false);
  const unregister = ctx.tunables.register('climbing', 'Rock climbing', cfg, climbingRanges);

  const wall = new WallScene(ctx.stage.scene, cfg, layout);
  const drop = shoulderDrop(cfg);
  // The tutorial ends at a low flag a few metres up.
  if (tut) wall.addFinishFlag(cfg.tutorialTopM + drop + 0.55);
  const group = new Group();
  group.name = 'climber';
  group.scale.setScalar(cfg.avatarScale);
  group.add(ctx.avatar.root);
  ctx.stage.scene.add(group);

  const camera = ctx.stage.camera;
  camera.fov = cfg.cameraFov;
  camera.rotation.set(0, 0, 0);
  camera.updateProjectionMatrix();
  const camVel = new Float64Array(1);
  let camY = state.y + (cfg.cameraAboveM - cfg.cameraBelowM) / 2;
  let camAnchor = state.y;

  const cursor: Vec2 = { x: 0, y: 0 };
  const map = createScreenMap();
  const holdPlaneZ = cfg.wallZ + 0.07;
  /** Camera distance so the vertical span fits below + above the focus. */
  const camDist = (): number =>
    (cfg.cameraBelowM + cfg.cameraAboveM) / 2 / Math.tan((cfg.cameraFov * Math.PI) / 360);
  /** Point the screen map at the camera as it is now (what the player sees). */
  const syncMap = (): void => {
    updateScreenMap(
      map,
      camera.position.x,
      camera.position.y,
      camera.position.z,
      holdPlaneZ,
      camera.fov,
      camera.aspect,
    );
  };
  // Mouse play (camera-off input only): press and hold a hold to grab it, drag to pull, release to
  // pass control to the other hand. The sport places the hands itself; no keys are read.
  const ptr = asMouseControl(ctx.input);
  const pointer = createPointerControl();
  if (ptr) {
    ptr.setManualMode(true);
    ptr.setPointerFollow(false);
    pointer.seenPresses = ptr.pointerPresses;
    pointer.seenReleases = ptr.pointerReleases;
    pointer.map = map;
    // One grip at a time while pulling: the one-hand drain is eased so a round can still be climbed.
    state.oneHandDrainMult = cfg.mouseOneHandDrainMult;
    ptr.selectHand('right');
    camera.position.set(state.x * 0.3, camY, cfg.wallZ + camDist());
    syncMap();
  }
  let shownActive = -1;
  let shownDragging = false;
  let started = false;
  let finished = false;
  let finishIn = 0;
  let seenGrab = 0;
  let seenRelease = 0;
  let milestone = 0;
  let ledgeShown = 0;
  let cheered = false;
  let climbBlend = 0;
  let endHandled = false;

  // HUD caches: strings are rebuilt only when the displayed value changes.
  let shownTenths = -1;
  let shownSecs = -1;
  let shownStamina = -1;
  let shownTone = '';
  let meterShown = !tut;
  const probe: TutorialProbe = { rest: false };
  let tutorial: ClimbTutorial | null = null;

  const refreshHud = (): void => {
    const h = Math.max(0, heightOf(state, cfg));
    const tenths = Math.floor(h * 10);
    if (tenths !== shownTenths) {
      shownTenths = tenths;
      ctx.hud.setScore(`${(tenths / 10).toFixed(1)} m`);
    }
    const secs = Math.max(0, Math.ceil(state.roundSeconds - state.elapsed));
    if (!tut && secs !== shownSecs) {
      shownSecs = secs;
      ctx.hud.setSubScore(
        ctx.best === null ? `${secs} s left` : `${secs} s left · Best ${ctx.best.toFixed(1)} m`,
      );
    }
    // In a tutorial the stamina bar appears with the step that explains it.
    if (tut && !meterShown) {
      if (tutorial === null || !tutorial.showStamina) return;
      meterShown = true;
      shownStamina = -1;
    }
    const pct = Math.round(state.stamina * 100);
    const tone =
      state.stamina < cfg.staminaBad ? 'bad' : state.stamina < cfg.staminaWarn ? 'warn' : 'good';
    if (pct !== shownStamina || tone !== shownTone) {
      shownStamina = pct;
      shownTone = tone;
      ctx.hud.setMeter('stamina', state.stamina, 'Stamina', tone);
    }
  };

  const handleEvents = (): void => {
    if (state.grabSeq !== seenGrab) {
      seenGrab = state.grabSeq;
      ctx.audio.play('grab');
      ctx.avatar.squash(0.9);
      if (!started || tut) return;
      if (state.grabs === 1) {
        ctx.hud.setBanner(null);
        if (!ptr) ctx.hud.setHint('Pull the closed hand down. Reach up with the other.');
      }
    }
    if (state.releaseSeq !== seenRelease) {
      seenRelease = state.releaseSeq;
      ctx.audio.play('release');
    }
    if (tut) return;
    const best = state.best;
    const m = Math.floor(best / cfg.milestoneEveryM);
    if (m > milestone) {
      milestone = m;
      ctx.audio.play('good');
      ctx.hud.setBanner(`${m * cfg.milestoneEveryM} m!`, 1200);
    }
    if (!cheered && ctx.best !== null && best > ctx.best) {
      cheered = true;
      ctx.audio.play('cheer');
      ctx.hud.setBanner('New best!', 1500);
    }
    if (state.standing && state.status === 'climbing') {
      const k = Math.round((state.y - drop) / cfg.ledgeEveryM);
      if (k > ledgeShown) {
        ledgeShown = k;
        ctx.hud.setBanner('Rest ledge', 1500);
        ctx.hud.flash('good');
      }
    }
  };

  const handleEnd = (): void => {
    if (endHandled || (state.status !== 'fell' && state.status !== 'timeout')) return;
    endHandled = true;
    finishIn = cfg.finishDelayS;
    if (state.status === 'fell') {
      animator.play('slump');
      ctx.audio.play('bad');
      ctx.hud.flash('bad');
      ctx.hud.setBanner(state.endReason === 'stamina' ? 'Out of stamina' : 'Slipped!');
    } else {
      animator.play('celebrate');
      ctx.audio.play('great');
      ctx.hud.setBanner("Time's up");
    }
  };

  const finish = (): void => {
    finished = true;
    const best = state.best;
    const reason =
      state.endReason === 'time'
        ? 'Timed out'
        : state.endReason === 'stamina'
          ? 'Out of stamina'
          : 'Slipped';
    ctx.finish({
      score: best,
      headline: `${best.toFixed(1)} m`,
      lines: [`${state.grabs} grabs`, reason],
      detail: {
        height: best,
        grabs: state.grabs,
        seconds: state.elapsed,
        crimps: state.crimpGrabs,
        falls: state.falls,
      },
    });
  };

  /** Arm target in rig-local space for one hand. */
  const driveArm = (side: 'left' | 'right', slot: HandSlot): void => {
    const sign = side === 'left' ? -1 : 1;
    const s = cfg.avatarScale;
    let wx: number;
    let wy: number;
    let lz: number;
    if (slot.holding) {
      wx = layout.holdX(slot.hold);
      wy = layout.holdY(slot.hold);
      lz = cfg.mittHoldZ;
    } else {
      wx = state.x + slot.cursorX;
      wy = state.y + slot.cursorY;
      lz = cfg.mittHoverZ;
    }
    let tx = (wx - state.x) / s;
    let ty = RIG_SHOULDER_HEIGHT + (wy - state.y) / s;
    const sx = sign * SHOULDER_X;
    let dx = tx - sx;
    let dy = ty - RIG_SHOULDER_HEIGHT;
    const len = Math.sqrt(dx * dx + dy * dy + lz * lz);
    if (len > ARM_MAX) {
      const k = ARM_MAX / len;
      dx *= k;
      dy *= k;
      lz *= k;
      tx = sx + dx;
      ty = RIG_SHOULDER_HEIGHT + dy;
    }
    ctx.avatar.setArmTarget(side, tx, ty, lz, sx + sign * 0.3, RIG_SHOULDER_HEIGHT - 0.4, 0.12);
    ctx.avatar.setMittCurl(side, slot.closed ? 1 : 0);
  };

  const sport: ClimbingSport = {
    get height(): number {
      return heightOf(state, cfg);
    },
    get best(): number {
      return state.best;
    },
    get grabs(): number {
      return state.grabs;
    },
    get stamina(): number {
      return state.stamina;
    },
    get status(): string {
      return state.status;
    },
    holding: {
      get left(): boolean {
        return state.left.holding;
      },
      get right(): boolean {
        return state.right.holding;
      },
    },
    layoutChecksum: layout.checksum,
    get pointerHand(): 'left' | 'right' | null {
      return ptr ? (pointer.active === 0 ? 'left' : 'right') : null;
    },

    get pointerDragging(): boolean {
      return pointer.dragging;
    },

    pointerHoldAt(x, y): number {
      return pointerTarget(pointer, state, cfg, layout, x, y);
    },

    aimImage(side): { x: number; y: number } | null {
      const idx = side === 'right' ? 1 : 0;
      const other = idx === 1 ? state.left : state.right;
      const i = chooseHold(layout, cfg, state.x, state.y, idx, other.hold);
      if (i < 0) return null;
      if (ptr) {
        syncMap();
        const s = wallToScreen(map, layout.holdX(i), layout.holdY(i), cursor);
        return { x: s.x, y: s.y };
      }
      const p = wallToHand(cfg, layout.holdX(i) - state.x, layout.holdY(i) - state.y, cursor);
      return { x: p.x, y: p.y };
    },

    holdIndex: {
      get left(): number {
        return state.left.hold;
      },
      get right(): number {
        return state.right.hold;
      },
    },

    // Test hook, called on demand. Deliberately independent of the screen map: it projects the
    // hold through the real render camera, so a map that disagrees with the picture is caught.
    holdScreen(index): { x: number; y: number } {
      camera.updateMatrixWorld(true);
      const v = new Vector3(layout.holdX(index), layout.holdY(index), holdPlaneZ).project(camera);
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    },

    nextHold(side): number {
      const idx = side === 'right' ? 1 : 0;
      const other = idx === 1 ? state.left : state.right;
      return chooseHold(layout, cfg, state.x, state.y, idx, other.hold);
    },

    get tutorialStep(): number {
      return tutorial === null ? -1 : tutorial.step;
    },

    get tutorialSteps(): number {
      return tutorial === null ? 0 : tutorial.stepCount;
    },

    start(): void {
      started = true;
      if (tut) {
        // The coach panel gives the instructions; no banner, hint, timer or best.
        ctx.hud.setSubScore(null);
        tutorial = createClimbTutorial({
          cfg,
          state,
          field: layout,
          coach: ctx.coach,
          hands: () => ctx.input.state.hands,
          mouse: ptr
            ? {
                dragging: () => pointer.dragging,
                aimable: () =>
                  pointerTarget(pointer, state, cfg, layout, ptr.pointerX, ptr.pointerY) >= 0,
              }
            : null,
          probe,
          onFinished: () => {
            ctx.audio.play('cheer');
            ctx.hud.flash('great');
            ctx.finishTutorial();
          },
        });
      } else {
        ctx.hud.setBanner(
          ptr ? 'Press and hold a hold to start' : 'Close a hand on a hold to start',
        );
        if (!ptr) ctx.hud.setHint('Grab, pull down, reach with the other hand');
      }
      wall.update(camY);
      refreshHud();
    },

    fixedUpdate(dt: number): void {
      // Grab and release come from hand state read here, so nothing changes while paused.
      if (finished || ctx.paused) {
        if (ptr) {
          pointer.seenPresses = ptr.pointerPresses;
          pointer.seenReleases = ptr.pointerReleases;
        }
        return;
      }
      const hands = ctx.input.state.hands;
      input.left.present = hands.left.present;
      input.left.closed = hands.left.closed;
      input.left.x = hands.left.x;
      input.left.y = hands.left.y;
      input.right.present = hands.right.present;
      input.right.closed = hands.right.closed;
      input.right.x = hands.right.x;
      input.right.y = hands.right.y;
      layout.ensure(state.y + cfg.cameraAboveM + 4);
      if (ptr) {
        // The pointer is read against the camera the player is looking through right now.
        syncMap();
        // Take each new press and release in order, then drive both hands from the mouse.
        while (
          pointer.seenPresses < ptr.pointerPresses ||
          pointer.seenReleases < ptr.pointerReleases
        ) {
          if (pointer.seenPresses < ptr.pointerPresses) {
            pointer.seenPresses++;
            if (state.status !== 'fell') {
              pointerPress(pointer, state, cfg, layout, ptr.pointerX, ptr.pointerY);
            }
          }
          if (
            pointer.seenReleases < ptr.pointerReleases &&
            pointer.seenReleases < pointer.seenPresses
          ) {
            pointer.seenReleases++;
            pointerRelease(pointer);
          }
        }
        const want = pointer.active === 0 ? 'left' : 'right';
        if (ptr.selectedHand !== want) ptr.selectHand(want);
        pointerStep(pointer, state, cfg, layout, input, ptr.pointerX, ptr.pointerY, dt);
      }
      step(state, cfg, layout, input, dt);
      if (tut) keepSafe(state, cfg);
      handleEvents();
      handleEnd();
      if (finishIn > 0) {
        finishIn -= dt;
        if (finishIn <= 0) finish();
      }
    },

    frame(dt: number, nowMs: number): void {
      if (tutorial !== null && !ctx.paused) tutorial.update(nowMs);
      // Camera follows the climber's shoulders, critically damped; frozen once they fall.
      if (state.status !== 'fell') camAnchor = state.y;
      const target = camAnchor + (cfg.cameraAboveM - cfg.cameraBelowM) / 2;
      camY = smoothDamp(camY, target, camVel, cfg.cameraSmoothS, Math.min(dt, 0.1));
      camera.position.set(state.x * 0.3, camY, cfg.wallZ + camDist());
      if (ptr) syncMap();
      wall.update(camY);

      // Which holds light up: the one each free hand would grab, and the ones held.
      const l = state.left;
      const r = state.right;
      const hoverL = l.holding
        ? -1
        : layout.findNearest(state.x + l.cursorX, state.y + l.cursorY, r.hold, -1);
      const hoverR = r.holding
        ? -1
        : layout.findNearest(state.x + r.cursorX, state.y + r.cursorY, l.hold, hoverL);
      if (ptr) {
        // The selected hand lights the hold a press would take, even while it is gripping another;
        // the cursor is the ghost of that hand and closes while the button is down.
        const t = pointer.dragging
          ? -1
          : pointerTarget(pointer, state, cfg, layout, ptr.pointerX, ptr.pointerY);
        if (pointer.active === 0) wall.setLit(t, -1, l.hold, r.hold);
        else wall.setLit(-1, t, l.hold, r.hold);
        ctx.hud.setCursor('pointer', ptr.pointerX, ptr.pointerY, pointer.dragging);
        if (!tut && (shownActive !== pointer.active || shownDragging !== pointer.dragging)) {
          shownActive = pointer.active;
          shownDragging = pointer.dragging;
          const who = pointer.active === 0 ? 'Left' : 'Right';
          ctx.hud.setHint(
            pointer.dragging
              ? `${who} hand: drag down to pull up, release to switch hands`
              : `${who} hand: press and hold a hold, then drag`,
          );
        }
      } else wall.setLit(hoverL, hoverR, l.hold, r.hold);

      // Climber.
      const feet = state.y - drop;
      group.position.set(state.x, feet, cfg.climberZ);
      const target01 = state.standing || state.status === 'fell' ? 0 : 1;
      climbBlend += (target01 - climbBlend) * (1 - Math.exp(-6 * Math.min(dt, 0.1)));
      if (!animator.busy) {
        driveArm('left', l);
        driveArm('right', r);
        const phase = feet * 2.4;
        const sw = Math.sin(phase) * 0.22;
        ctx.avatar.setLeg('left', climbBlend * (0.5 + sw), climbBlend * (0.8 + sw * 0.6));
        ctx.avatar.setLeg('right', climbBlend * (0.5 - sw), climbBlend * (0.8 - sw * 0.6));
        let lean = 0;
        if (l.holding || r.holding) {
          const useRight =
            r.holding && (!l.holding || layout.holdY(r.hold) >= layout.holdY(l.hold));
          const hx = layout.holdX(useRight ? r.hold : l.hold) - state.x;
          lean = Math.max(-0.25, Math.min(0.25, hx * 0.3));
        }
        ctx.avatar.setTorso(lean, 0);
      }
      animator.update(dt);
      refreshHud();
    },

    createBot() {
      return createClimbBot(cfg, state, layout, tut ? probe : undefined);
    },

    dispose(): void {
      tutorial?.dispose();
      unregister();
      if (ptr) {
        ptr.setManualMode(false);
        ptr.setPointerFollow(true);
        ctx.hud.setCursor('pointer', null, 0);
      }
      wall.dispose();
      group.removeFromParent();
      ctx.stage.scene.add(ctx.avatar.root);
      ctx.avatar.root.position.set(0, 0, 0);
      ctx.hud.clear();
    },
  };
  return sport;
};

export default createClimbing;
