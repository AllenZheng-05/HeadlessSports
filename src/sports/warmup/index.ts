import { mirrorUpperBody } from '../../core/avatarDrive';
import type { Sport, SportBot, SportContext, SportFactory } from '../../core/sport';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { PALETTE } from '../../render/style/palette';
import { toonMaterial } from '../../render/style/toon';
import { closeFist, idle, openFist } from '../../tracking/synthetic/scripts/moves';
import { CapsuleGeometry, Mesh } from 'three/webgpu';
import { warmupConfig } from './config';
import { createWarmupState, isWon, onFist, tick } from './rules';

/**
 * Reference sport. The shape every sport follows:
 *  1. Build scene props from shared geometry; keep them in a list so dispose() can remove them.
 *  2. Subscribe to input events (never raw landmarks); keep the unsubscribe functions.
 *  3. fixedUpdate = rules at 120 Hz. frame = drive the avatar and HUD, once per rendered frame.
 *  4. Call ctx.finish() exactly once. Keep rendering afterwards; the host stops fixedUpdate.
 *  5. createBot() returns a closed-loop synthetic player; dispose() undoes everything.
 * Nothing allocates per frame: strings are rebuilt only when the displayed value changes.
 */
const PEG_COUNT = 5;

export const createWarmup: SportFactory = (ctx: SportContext): Sport => {
  const cfg = warmupConfig;
  const state = createWarmupState();
  const animator = new AvatarAnimator(ctx.avatar);
  const unregister = ctx.tunables.register('warmup', 'Warm-up', cfg);

  // Props: a row of pegs behind the athlete. Geometry is shared, only the material swaps.
  const geometry = new CapsuleGeometry(0.17, 0.3, 4, 12);
  const pegs: Mesh[] = [];
  for (let i = 0; i < PEG_COUNT; i++) {
    const peg = new Mesh(geometry, toonMaterial(PALETTE.chalk));
    peg.position.set((i - (PEG_COUNT - 1) / 2) * 0.7, 0.32, -1.6);
    ctx.stage.scene.add(peg);
    pegs.push(peg);
  }

  let started = false;
  let finished = false;
  let finishIn = 0;
  let shownTenths = -1;

  const refreshScore = (): void => {
    const tenths = Math.floor(state.elapsed * 10);
    if (tenths === shownTenths) return;
    shownTenths = tenths;
    ctx.hud.setScore(`${(tenths / 10).toFixed(1)} s`);
  };

  const onFistClosed = (): void => {
    if (!started || state.done) return;
    onFist(state, cfg);
    ctx.audio.play('grab');
    ctx.avatar.squash(0.88);
    const lit = Math.min(state.count, PEG_COUNT);
    for (let i = 0; i < lit; i++) pegs[i]!.material = toonMaterial(PALETTE.whistle);
    ctx.hud.setBanner(`${state.count} of ${cfg.fistsToWin}`, 700);
    if (state.done) {
      ctx.audio.play('great');
      animator.play('celebrate');
      finishIn = cfg.finishDelayS;
    }
  };
  const unsubscribe = ctx.input.on('FistClosed', onFistClosed);

  return {
    start(): void {
      started = true;
      ctx.hud.setHint('Close your fist, open it, repeat');
      ctx.hud.setSubScore(ctx.best === null ? null : `Best ${ctx.best.toFixed(1)} s`);
      refreshScore();
    },

    fixedUpdate(dt: number): void {
      if (finished) return;
      tick(state, dt, cfg);
      if (state.done && finishIn === 0) {
        // Time ran out before the fifth fist.
        animator.play(isWon(state, cfg) ? 'celebrate' : 'slump');
        finishIn = cfg.finishDelayS;
      }
      if (finishIn > 0) {
        finishIn -= dt;
        if (finishIn <= 0) {
          finished = true;
          const won = isWon(state, cfg);
          const score = state.elapsed;
          ctx.finish({
            score,
            headline: won ? `${score.toFixed(1)} s` : "Time's up",
            lines: [`${state.count} of ${cfg.fistsToWin} fists`],
            detail: { fists: state.count, seconds: score },
            // A timed-out round is not a time to beat (lower is better).
            saveScore: won,
          });
        }
      }
    },

    frame(dt: number, nowMs: number): void {
      if (!animator.busy) mirrorUpperBody(ctx.avatar, ctx.input.state, nowMs);
      animator.update(dt);
      refreshScore();
    },

    createBot(): SportBot {
      return {
        next(enqueue): void {
          enqueue([...closeFist('right'), ...idle(250), ...openFist('right'), ...idle(250)]);
        },
      };
    },

    dispose(): void {
      unsubscribe();
      unregister();
      for (const peg of pegs) peg.removeFromParent();
      geometry.dispose();
      ctx.hud.clear();
    },
  };
};

export default createWarmup;
