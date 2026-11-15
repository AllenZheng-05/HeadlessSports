import type { HandState, InputProvider } from '../input/types';
import { POSE_STRIDE } from '../tracking/types';
import { h } from './dom';

export type MirrorMode = 'hidden' | 'corner' | 'large';

const MAX_FPS = 30;
const MIN_FRAME_MS = 1000 / MAX_FPS - 1;
const VISIBLE = 0.4;
const CANVAS_W = 640;

/** Skeleton segments as pairs of pose indices (shoulders, arms, torso, legs). */
const BONES = new Uint8Array([
  11, 12, 11, 13, 13, 15, 12, 14, 14, 16, 11, 23, 12, 24, 23, 24, 23, 25, 25, 27, 24, 26, 26, 28,
]);

/**
 * The camera preview with the skeleton and palm markers drawn over it. The camera element is
 * mirrored with CSS; the pose is already mirrored, so the canvas is never flipped.
 */
export class Mirror {
  readonly el: HTMLElement;
  private readonly slot: HTMLElement;
  private readonly guideSlot: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private input: InputProvider | null = null;
  private video: HTMLVideoElement | null = null;
  private mode: MirrorMode = 'hidden';
  private aspect = 16 / 9;
  private lastDraw = -Infinity;

  constructor(private readonly onAspect?: (aspect: number) => void) {
    this.el = h('div', 'mirror');
    this.el.hidden = true;
    this.slot = h('div', 'mirror-video');
    this.canvas = h('canvas', 'mirror-canvas');
    this.guideSlot = h('div', 'mirror-guide');
    this.el.append(this.slot, this.canvas, this.guideSlot);
    this.setAspect(16 / 9);
    this.ctx = this.getContext2d();
  }

  private getContext2d(): CanvasRenderingContext2D | null {
    try {
      return this.canvas.getContext('2d');
    } catch {
      return null;
    }
  }

  private setAspect(aspect: number): void {
    this.aspect = aspect;
    this.el.style.setProperty('--aspect', String(aspect));
    this.onAspect?.(aspect);
    this.canvas.width = CANVAS_W;
    this.canvas.height = Math.round(CANVAS_W / aspect);
  }

  setMode(mode: MirrorMode): void {
    this.mode = mode;
    this.el.hidden = mode === 'hidden';
    this.el.dataset.mode = mode;
    if (mode !== 'hidden') this.syncVideo();
  }

  /** Put (or clear) a silhouette guide over the preview. */
  setGuide(guide: Element | null): void {
    this.guideSlot.replaceChildren();
    if (guide) this.guideSlot.append(guide);
  }

  setInput(input: InputProvider | null): void {
    this.input = input;
    this.syncVideo();
    this.lastDraw = -Infinity;
  }

  private syncVideo(): void {
    const v = this.input?.source?.video ?? null;
    if (v === this.video) {
      this.el.classList.toggle('has-video', v !== null);
      return;
    }
    if (this.video && this.video.parentElement === this.slot) this.slot.removeChild(this.video);
    this.video = v;
    if (v) {
      v.classList.add('mirror-video-el');
      v.muted = true;
      v.setAttribute('playsinline', '');
      this.slot.append(v);
    }
    this.el.classList.toggle('has-video', v !== null);
  }

  /** Redraws at most 30 times a second. Allocation free. */
  update(nowMs: number): void {
    if (this.mode === 'hidden' || !this.ctx || !this.input) return;
    if (nowMs - this.lastDraw < MIN_FRAME_MS) return;
    this.lastDraw = nowMs;
    const state = this.input.state;
    if (state.aspect > 0 && Math.abs(state.aspect - this.aspect) > 0.01)
      this.setAspect(state.aspect);
    const ctx = this.ctx;
    const w = this.canvas.width;
    const hh = this.canvas.height;
    ctx.clearRect(0, 0, w, hh);
    const u = w / 160;
    if (state.hasPose) {
      const pose = state.pose;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.6 * u;
      ctx.strokeStyle = '#fbf8f1';
      ctx.beginPath();
      for (let i = 0; i < BONES.length; i += 2) {
        const a = (BONES[i] as number) * POSE_STRIDE;
        const b = (BONES[i + 1] as number) * POSE_STRIDE;
        if ((pose[a + 3] as number) < VISIBLE || (pose[b + 3] as number) < VISIBLE) continue;
        ctx.moveTo((pose[a] as number) * w, (pose[a + 1] as number) * hh);
        ctx.lineTo((pose[b] as number) * w, (pose[b + 1] as number) * hh);
      }
      ctx.stroke();
    }
    this.drawPalm(state.hands.left, w, hh, u);
    this.drawPalm(state.hands.right, w, hh, u);
  }

  private drawPalm(hand: HandState, w: number, hh: number, u: number): void {
    if (!hand.present || !this.ctx) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(hand.x * w, hand.y * hh, (hand.closed ? 5 : 6.5) * u, 0, Math.PI * 2);
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = '#27364a';
    if (hand.closed) {
      ctx.fillStyle = '#ff7a59';
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.stroke();
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = '#ff7a59';
      ctx.stroke();
    }
  }

  dispose(): void {
    this.setInput(null);
    this.el.remove();
  }
}

/** "Camera on" pill with a one-click "Turn camera off". */
export class CameraIndicator {
  readonly el: HTMLElement;
  readonly offButton: HTMLButtonElement;
  private readonly pill: HTMLElement;
  private readonly label: HTMLElement;
  private active = false;

  constructor(onOff: () => void) {
    this.el = h('div', 'camera-indicator');
    this.el.setAttribute('data-ui', '');
    this.el.hidden = true;
    this.pill = h('div', 'camera-pill');
    const dot = h('span', 'camera-dot');
    dot.setAttribute('aria-hidden', 'true');
    this.label = h('span', '', 'Camera off');
    this.pill.append(dot, this.label);
    this.offButton = h('button', 'camera-off', 'Turn camera off');
    this.offButton.type = 'button';
    this.offButton.setAttribute('data-select', '');
    this.offButton.addEventListener('click', onOff);
    this.el.append(this.pill, this.offButton);
    this.setActive(false);
  }

  setActive(active: boolean): void {
    this.active = active;
    this.pill.classList.toggle('on', active);
    this.label.textContent = active ? 'Camera on' : 'Camera off';
    this.offButton.hidden = !active;
  }

  get isActive(): boolean {
    return this.active;
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }
}
