import { mirrorUpperBody } from '../../core/avatarDrive';
import type {
  MeterTone,
  RoundResult,
  Sport,
  SportBot,
  SportContext,
  SportFactory,
} from '../../core/sport';
import { asMouseControl } from '../../input/debug/mouseControl';
import { recognizerConfig } from '../../input/recognizers/config';
import type { GameEvent, Side } from '../../input/types';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { BlobShadow } from '../../render/style/blobShadow';
import { vertexColorToonMaterial } from '../../render/style/toon';
import { Color, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three/webgpu';
import type { Fog } from 'three/webgpu';
import { createJavelinBot } from './bot';
import type { TutorialProbe } from './bot';
import { javelinConfig, javelinRanges } from './config';
import { flightPitch } from './distance';
import { applyJavelinRecognizer } from './recognizer';
import {
  attemptLine,
  attemptsFor,
  createGame,
  distanceToLine,
  createMouseRun,
  stepMouseRun,
  onStep,
  onThrow,
  refusalWorthSaying,
  resetRun,
  shownDistance,
  showsRejection,
  stepGame,
} from './game';
import type { AttemptRecord, Phase } from './game';
import { createJavelinTutorial, holdBack } from './tutorial';
import type { JavelinTutorial } from './tutorial';
import {
  JAVELIN_TIP,
  buildJavelinGeometry,
  buildMarkerGeometry,
  buildSeatMarkGeometry,
  buildWorld,
} from './world';

/** What the browser tests and the debugging overlay read from `__game.sport`. */
export interface JavelinSport extends Sport {
  /** The rules' phase, or 'handover' while the next player steps in (pass-and-play). */
  readonly phase: Phase | 'handover';
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
  /** The last "why nothing happened" hint shown for a refused or missed throw ('' for none). */
  readonly notice: string;
  /** Tutorial rounds: the current step (0-based), or -1 in a normal round. */
  readonly tutorialStep: number;
  /** Tutorial rounds: the number of steps, or 0 in a normal round. */
  readonly tutorialSteps: number;
  /** Seat in front of the camera, and the number of seats (1 for a normal round). */
  readonly seat: number;
  readonly seatCount: number;
  /** The throwing hand of the seat in front of the camera. */
  readonly handedness: Side;
  /** Each seat's best distance so far, in seat order (0 for no mark). */
  readonly scores: readonly number[];
}

/** Where a seat's best-mark pennant stands, to the left of the runway, and how big it is. */
const MARK_X = -2.2;
const MARK_STEP = 1.1;
const MARK_SCALE = 0.8;

/** One seat's attempts, swapped into the shared rules state while that seat is up. */
interface SeatData {
  attempt: number;
  records: AttemptRecord[];
  best: number;
  bestIndex: number;
}

/** "31.2, foul, 34.2": a seat's attempts at a glance. */
function attemptList(records: readonly AttemptRecord[]): string {
  const parts: string[] = [];
  for (const r of records) parts.push(r.foul ? 'foul' : r.distance.toFixed(1));
  return parts.join(', ');
}

/** Pitch of the javelin when held, radians (nose up). */
const HOLD_PITCH = 0.22;
/** How fast the visual launch offset (mitt vs model release point) fades, 1/s. */
const OFFSET_FADE = 7;
/** The javelin is drawn a little oversized in the air and in the turf so it reads at distance. */
const FLIGHT_SCALE = 1.5;

const THROW_PROMPT = 'Throw!';
const LOST_TEXT = 'I lost your arm, step back a little';
/** What to say when the rules refuse a throw the recognizer did report. */
const REFUSAL_TEXT: Record<string, string> = {
  hand: 'Throw with your dominant hand',
  slow: 'Throw faster',
  low: 'Bring your hand up past your shoulder',
  short: 'Make a bigger throwing motion',
  up: 'Throw forward, not up',
};

/** `?botRun=slow|fast` picks a fixed step rate for the bot (to compare approach speeds). */
function botVariant(): 'slow' | 'fast' | null {
  const v = new URLSearchParams(globalThis.location?.search ?? '').get('botRun');
  return v === 'slow' || v === 'fast' ? v : null;
}

/** `?botStyle=jog` makes the bot jog with arms and torso as well as knees. */
function botStyle(): 'legs' | 'jog' {
  const v = new URLSearchParams(globalThis.location?.search ?? '').get('botStyle');
  return v === 'jog' ? 'jog' : 'legs';
}

export const createJavelin: SportFactory = (ctx: SportContext): JavelinSport => {
  const cfg = javelinConfig;
  // Pass-and-play: seats take turns one attempt at a time. The hand is the seat's, read again
  // after every handover.
  let hand: Side = ctx.calibration?.handedness ?? 'right';
  const tut = ctx.tutorial;
  const turns = ctx.turns;
  const multi = turns.count > 1 && !tut;
  const seatCount = multi ? turns.count : 1;
  let seat = 0;
  let handingOver = false;
  const seats: SeatData[] = [];
  for (let i = 0; i < seatCount; i++)
    seats.push({ attempt: 0, records: [], best: 0, bestIndex: -1 });
  // A tutorial has no attempt limit.
  const game = createGame(tut ? Number.MAX_SAFE_INTEGER : attemptsFor(cfg, ctx.short));
  const probe: TutorialProbe = { hold: false, standing: false };
  let tutorial: JavelinTutorial | null = null;
  const animator = new AvatarAnimator(ctx.avatar);
  const unregister = ctx.tunables.register('javelin', 'Javelin', cfg, javelinRanges);

  // Running bobs the shoulders and pumps the arms: let the throw recognizer tolerate that for the
  // length of the sport (the speed guard in the rules keeps pumping from throwing).
  const restoreRecognizer = applyJavelinRecognizer(cfg, recognizerConfig);

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
  // Each seat's best mark, as pennants in the seat's colour (one instanced draw call).
  const tmpM = new Matrix4();
  const tmpColor = new Color();
  let markGeometry: ReturnType<typeof buildSeatMarkGeometry> | null = null;
  let marks: InstancedMesh | null = null;
  if (multi) {
    markGeometry = buildSeatMarkGeometry();
    marks = new InstancedMesh(markGeometry, material, seatCount);
    marks.name = 'seat-marks';
    marks.frustumCulled = false;
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < seatCount; i++) {
      marks.setMatrixAt(i, tmpM);
      marks.setColorAt(i, tmpColor.setHex(turns.players[i]?.color ?? 0xffffff));
    }
    stage.scene.add(marks);
  }
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
  let speedFrac = 0;
  let stickPitch = 0;
  let stickPhi = 0;

  // Mouse (camera off): hold the button to run at a set speed, let go to throw. The mouse API is
  // null for camera input.
  const mouse = asMouseControl(ctx.input);
  let mouseRun = createMouseRun(0);
  let mouseCadenceSet = 0;
  if (mouse) {
    mouse.setManualMode(true);
    mouse.setPointerFollow(false);
    mouseRun = createMouseRun(mouse.pointerReleases);
  }

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
      case 'ThrowReleased':
        // Gestures made while the round is paused (player out of frame) do not count.
        if (!ctx.paused) pending.push(e);
        break;
      case 'Step':
        if (!ctx.paused) pending.push(e);
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

  const drain = (nowMs: number): void => {
    for (const e of pending) {
      if (e.type === 'Step') {
        onStep(game, cfg, e.t);
      } else if (e.type === 'ThrowReleased') {
        const seq = game.refusalSeq;
        const taken = onThrow(
          game,
          cfg,
          nowMs,
          {
            t: e.t,
            hand: e.hand,
            speed: e.speed,
            vy: e.vy,
            vx: e.vx,
            style: e.style,
            travel: e.travel,
            topY: e.topY,
          },
          hand,
        );
        note(
          `throw t=${e.t.toFixed(0)} now=${nowMs.toFixed(0)} speed=${e.speed.toFixed(1)} vy=${e.vy.toFixed(1)} ${e.style} top=${e.topY?.toFixed(2)} travel=${e.travel?.toFixed(2)} ${game.phase} pos=${game.position.toFixed(1)} v=${game.speed.toFixed(1)} taken=${taken}`,
        );
        if (!taken && game.refusalSeq !== seq && refusalWorthSaying(game, cfg)) {
          showNotice(REFUSAL_TEXT[game.refusal] ?? '', nowMs);
        }
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
  let shownSpeedPct = -1;
  let shownSpeedTenths = -1;
  let shownSpeedTone = '';
  let speedShown = false;
  let shownHint: string | null = '';

  // A short "why nothing happened" line (refused throw, arm lost) that stays over the usual hint.
  let noticeText = '';
  let noticeUntil = 0;
  let noticeYields = false;
  let seenRejected = ctx.input.state.rejected?.seq ?? 0;
  let hudNow = 0;
  const setHint = (text: string | null): void => {
    // The coach panel is the instruction line in a tutorial.
    if (tut) return;
    // The usual hints do not override a notice while it is up; clearing (null) always works.
    // A "noticed but not a throw" note gives way to the throw prompt.
    const yields = noticeYields && text === THROW_PROMPT;
    const shown = text !== null && hudNow < noticeUntil && !yields ? noticeText : text;
    if (shown === shownHint) return;
    shownHint = shown;
    ctx.hud.setHint(shown);
  };
  const showNotice = (text: string, nowMs: number, yieldsToPrompt = false): void => {
    if (text === '') return;
    noticeYields = yieldsToPrompt;
    noticeText = text;
    noticeUntil = nowMs + cfg.noticeMs;
    note(`notice: ${text}`);
    setHint(text);
  };
  // What the recognizer says about an arm motion it saw but did not make a throw of.
  const checkRejected = (nowMs: number): void => {
    const r = ctx.input.state.rejected;
    if (r === undefined || r.seq === seenRejected) return;
    seenRejected = r.seq;
    if (ctx.paused) return;
    if (tut && game.standing && game.phase === 'run' && !game.noThrow) {
      // The standing practice throw: the player is not running, so every motion of the throwing
      // arm that was noticed and refused is explained (not just the clear efforts).
      if (
        r.kind === 'throw' &&
        r.hand === hand &&
        nowMs >= game.lockoutUntilMs &&
        r.speed >= cfg.tutorialNoticeMinSpeed
      ) {
        showNotice(
          r.reason === 'lost'
            ? LOST_TEXT
            : r.reason === 'short'
              ? 'Throw smoother'
              : r.reason === 'steep'
                ? REFUSAL_TEXT.up!
                : 'Throw faster',
          nowMs,
          true,
        );
      }
      return;
    }
    if (!showsRejection(game, cfg, nowMs, r, hand)) return;
    showNotice(
      r.reason === 'lost' ? LOST_TEXT : r.reason === 'short' ? 'Throw smoother' : 'Throw faster',
      nowMs,
      true,
    );
  };

  const refreshHud = (): void => {
    const running = game.phase === 'run';
    // A tutorial has no try count and no best: it shows the meters of the step it is on.
    const lineOn = running && (!tut || tutorial?.showLine === true);
    const speedOn = running && (!tut || tutorial?.showSpeed === true);
    if (!tut) {
      const n = Math.min(game.attempt + 1, game.total);
      if (n !== shownThrow) {
        shownThrow = n;
        ctx.hud.setScore(`Try ${n}/${game.total}`);
      }
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
    }
    if (lineOn) {
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
    } else if (lineShown) {
      lineShown = false;
      shownLinePct = -1;
      shownLineRem = -1;
      shownLineTone = '';
      ctx.hud.setMeter('line', null);
    }
    if (running) {
      if (mouse) {
        if (distanceToLine(game, cfg) <= cfg.throwZone) setHint('Let go!');
        else if (game.speed < 0.5) setHint('Hold the button to run');
        else setHint('Let go just before the line');
      } else if (game.idleHint) setHint('Run on the spot: pump your arms and lift your knees');
      else if (distanceToLine(game, cfg) <= cfg.throwZone) setHint(THROW_PROMPT);
      else setHint('Run on the spot: faster is farther');
    }
    if (speedOn) {
      // Speed meter: fills with the run speed, so quicker feet are seen at once.
      const sf = Math.max(0, Math.min(1, game.speed / cfg.maxRunSpeed));
      const sPct = Math.round(sf * 50);
      const sTenths = Math.round(game.speed * 10);
      const sTone: MeterTone = sf < 0.4 ? 'warn' : 'good';
      if (sPct !== shownSpeedPct || sTenths !== shownSpeedTenths || sTone !== shownSpeedTone) {
        shownSpeedPct = sPct;
        shownSpeedTenths = sTenths;
        shownSpeedTone = sTone;
        speedShown = true;
        ctx.hud.setMeter('speed', sf, `Speed ${(sTenths / 10).toFixed(1)} m/s`, sTone);
      }
    } else if (speedShown) {
      speedShown = false;
      shownSpeedPct = -1;
      shownSpeedTenths = -1;
      shownSpeedTone = '';
      ctx.hud.setMeter('speed', null);
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
      if (!tut) {
        ctx.audio.play('select');
        ctx.hud.setBanner('Go!', 900);
      }
    }
    if (game.releaseSeq !== seenRelease) {
      seenRelease = game.releaseSeq;
      detachJavelin();
      setHint(null);
      if (game.dropped) {
        if (!tut) ctx.audio.play('bad');
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
      if (multi) turns.setStanding(seat, shownDistance(game.best), bestText(game.best));
      if (game.lastFoul) {
        // A foul is explained in a tutorial, not punished.
        if (!tut) {
          ctx.audio.play('bad');
          ctx.hud.flash('bad');
        }
        if (!game.dropped) ctx.hud.setBanner(tut ? 'You crossed the line' : 'Foul');
        if (!animator.busy || animator.current !== 'slump') animator.play('slump');
        setHint(game.dropped ? 'Throw before the line' : 'Released past the line');
      } else {
        const d = game.lastDistance;
        marker.visible = true;
        marker.position.set(1.3, 0, -f.x);
        if (multi && game.bestIndex === game.records.length - 1) placeMark(seat, d);
        marker.scale.setScalar(1 + d * 0.02);
        ctx.hud.setBanner(`${d.toFixed(2)} m`);
        ctx.audio.play('good');
        if (tut) ctx.hud.setSubScore(`Last throw ${d.toFixed(2)} m`);
        const isBest = !tut && d >= game.best && d > (ctx.best ?? 0);
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
    if (game.nextSeq !== seenNext && multi) {
      // The attempt is over and shown: the next player is up (the same seat never continues).
      seenNext = game.nextSeq;
      endTurn();
      return;
    }
    if (game.nextSeq !== seenNext) {
      seenNext = game.nextSeq;
      holdJavelin();
      snapCamera = true;
      animator.stop();
      ctx.hud.setBanner(tut ? null : 'Get ready');
      setHint(mouse ? 'Hold the button to run' : 'Run on the spot to build speed');
    }
    if (game.doneSeq !== seenDone) {
      seenDone = game.doneSeq;
      if (multi) endTurn();
      else finish();
    }
  };

  // ---- Pass-and-play ----
  const bestText = (best: number): string => (best > 0 ? `${best.toFixed(2)} m` : 'no mark');

  const stash = (): void => {
    const d = seats[seat]!;
    d.attempt = game.attempt;
    d.records = game.records;
    d.best = game.best;
    d.bestIndex = game.bestIndex;
  };

  /** A seat's best mark just changed: stand its pennant at the distance. */
  const placeMark = (at: number, distance: number): void => {
    if (marks === null) return;
    tmpM.makeScale(MARK_SCALE, MARK_SCALE, MARK_SCALE);
    tmpM.setPosition(MARK_X - at * MARK_STEP, 0, -(cfg.runwayLength + distance));
    marks.setMatrixAt(at, tmpM);
    marks.instanceMatrix.needsUpdate = true;
  };

  /** The attempt is over and shown: hand over to the next seat, or finish when all are done. */
  const endTurn = (): void => {
    stash();
    let allDone = true;
    for (const d of seats) if (d.records.length < game.total) allDone = false;
    if (allDone) {
      finishMulti();
      return;
    }
    const next = (seat + 1) % seatCount;
    handingOver = true;
    ctx.hud.setBanner(null);
    setHint(null);
    turns.handOver(next, () => switchSeat(next));
  };

  /** The next player is in place: their attempts, their hand, a clean run-up. */
  const switchSeat = (next: number): void => {
    seat = next;
    const d = seats[next]!;
    game.attempt = d.attempt;
    game.records = d.records;
    game.best = d.best;
    game.bestIndex = d.bestIndex;
    resetRun(game);
    // Handedness comes from this seat's calibration; the javelin follows the mitt each frame.
    hand = ctx.calibration?.handedness ?? 'right';
    // Nothing the last player did carries over.
    pending.length = 0;
    seenRejected = ctx.input.state.rejected?.seq ?? seenRejected;
    noticeText = '';
    noticeUntil = 0;
    if (mouse) {
      mouseRun = createMouseRun(mouse.pointerReleases);
      mouseCadenceSet = 0;
      mouse.setRunCadence(0);
    }
    speedFrac = 0;
    animator.stop();
    holdJavelin();
    snapCamera = true;
    shownThrow = -1;
    shownBestCm = -1;
    shownSpeed = -2;
    shownHint = '';
    handingOver = false;
    ctx.hud.setBanner('Get ready');
    setHint(mouse ? 'Hold the button to run' : 'Run on the spot to build speed');
    refreshHud();
  };

  const finishMulti = (): void => {
    if (finished) return;
    finished = true;
    const results: RoundResult[] = [];
    for (const d of seats) {
      let fouls = 0;
      for (const r of d.records) if (r.foul) fouls++;
      results.push({
        score: shownDistance(d.best),
        headline: d.best > 0 ? `${d.best.toFixed(2)} m` : 'No mark',
        lines: [attemptList(d.records)],
        detail: { attempts: d.records.length, best: d.best, fouls },
      });
    }
    ctx.finishMulti(results);
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
    // Speed feel: wider view and a longer chase distance the faster the athlete runs.
    const goalFrac = phase === 'run' ? Math.max(0, Math.min(1, game.speed / cfg.maxRunSpeed)) : 0;
    speedFrac += (goalFrac - speedFrac) * (1 - Math.exp(-6 * dt));
    const fov = cfg.cameraFov + speedFrac * cfg.cameraSpeedFov;
    if (Math.abs(fov - camera.fov) > 0.02) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (phase === 'flight' && !game.dropped) {
      camGoal.set(4.2, 2.4 + Math.min(flight.y, 10) * 0.25, -flight.x + 6.5);
      lookGoal.set(0, Math.max(1.2, flight.y), -flight.x - 4);
    } else if (phase === 'result' || phase === 'done' || (phase === 'flight' && game.dropped)) {
      const landZ = -flight.x;
      camGoal.set(game.lastFoul ? 0 : 5.5, 3.0, landZ + (game.lastFoul ? 8 : 11));
      lookGoal.set(0, 0.8, landZ - 1);
    } else {
      const z = -game.position;
      camGoal.set(0, cfg.cameraUp, z + cfg.cameraBack + speedFrac * cfg.cameraSpeedBack);
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
    get phase(): Phase | 'handover' {
      return handingOver ? 'handover' : game.phase;
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
    get notice(): string {
      return hudNow < noticeUntil ? noticeText : '';
    },

    get seat(): number {
      return seat;
    },

    get seatCount(): number {
      return seatCount;
    },

    get handedness(): Side {
      return hand;
    },

    get scores(): readonly number[] {
      const out: number[] = [];
      for (let i = 0; i < seatCount; i++) out.push(i === seat ? game.best : seats[i]!.best);
      return out;
    },

    get tutorialStep(): number {
      return tutorial === null ? -1 : tutorial.step;
    },

    get tutorialSteps(): number {
      return tutorial === null ? 0 : tutorial.stepCount;
    },

    start(): void {
      started = true;
      if (multi) for (let i = 0; i < seatCount; i++) turns.setStanding(i, 0, bestText(0));
      if (tut) {
        // The coach panel gives the instructions; no banner, hint, try count or best.
        ctx.hud.setScore('Practice');
        ctx.hud.setSubScore(null);
        tutorial = createJavelinTutorial({
          cfg,
          game,
          hand,
          coach: ctx.coach,
          mouse: mouse !== null,
          body: () => ctx.input.state,
          notice: () => (hudNow < noticeUntil ? noticeText : ''),
          probe,
          onFinished: () => {
            ctx.audio.play('cheer');
            ctx.hud.flash('great');
            ctx.finishTutorial();
          },
        });
      } else {
        ctx.hud.setBanner('Get ready');
        setHint(mouse ? 'Hold the button to run' : 'Run on the spot to build speed');
      }
      refreshHud();
    },

    fixedUpdate(dt: number, nowMs: number): void {
      if (finished || handingOver) return;
      hudNow = nowMs;
      drain(nowMs);
      checkRejected(nowMs);
      let runTarget = -1;
      if (mouse) {
        runTarget = stepMouseRun(
          mouseRun,
          game,
          cfg,
          nowMs,
          dt,
          mouse.pointerDown,
          mouse.pointerReleases,
          ctx.paused,
          hand,
        );
        const cadence = runTarget > 0 ? cfg.mouseCadence : 0;
        if (cadence !== mouseCadenceSet) {
          mouseCadenceSet = cadence;
          mouse.setRunCadence(cadence);
        }
      }
      stepGame(game, cfg, dt, nowMs, ctx.input.state.cadence.amplitude, runTarget);
      if (tutorial !== null && !tutorial.free) holdBack(game, cfg);
      react();
    },

    frame(dt: number, nowMs: number): void {
      hudNow = nowMs;
      if (tutorial !== null && !ctx.paused) tutorial.update(nowMs);
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
      return createJavelinBot(
        cfg,
        game,
        () => hand,
        ctx.random,
        botVariant(),
        botStyle(),
        tut ? probe : undefined,
      );
    },

    dispose(): void {
      tutorial?.dispose();
      onAny();
      if (mouse) {
        mouse.setRunCadence(0);
        mouse.setPointerFollow(true);
        mouse.setManualMode(false);
      }
      unregister();
      restoreRecognizer();
      world.dispose();
      javelin.removeFromParent();
      marker.removeFromParent();
      marks?.removeFromParent();
      marks?.dispose();
      markGeometry?.dispose();
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
