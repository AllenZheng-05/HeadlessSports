import type { SportMeta, Stance } from '../../core/sport';
import type { Side } from '../../input/types';
import { h, selectButton, svgEl } from '../dom';
import { PCT_INT } from '../format';
import type { CalibrationScreen, CalibrationStep, CalibrationView } from '../types';
import type { ScreenHost, ScreenSpec } from './shared';
import { screenShell } from './shared';

const ALL_STEPS: readonly CalibrationStep[] = ['position', 'lighting', 'handedness', 'hold-still'];
const ALL_LABELS: readonly string[] = ['Position', 'Light', 'Hand', 'Hold still'];
const RING_R = 52;
const RING_LEN = 2 * Math.PI * RING_R;

interface Shape {
  tag: 'rect';
  attrs: Record<string, number | string>;
}

function rect(x: number, y: number, w: number, hh: number, rx: number, rot = 0): Shape {
  const attrs: Record<string, number | string> = { x, y, width: w, height: hh, rx };
  if (rot !== 0) attrs.transform = `rotate(${rot} ${x + w / 2} ${y + hh / 2})`;
  return { tag: 'rect', attrs };
}

function handShapes(cx: number): Shape[] {
  // palm, four fingers, thumb
  const out: Shape[] = [rect(cx - 15, 40, 30, 28, 11)];
  for (let i = 0; i < 4; i++) {
    const len = i === 0 || i === 3 ? 18 : 23;
    out.push(rect(cx - 15 + i * 7.6, 40 - len + 4, 6.6, len, 3.3));
  }
  out.push(rect(cx - 25, 50, 18, 7, 3.5, -35));
  return out;
}

export type GuidePose = 'relaxed' | 'raise-left' | 'raise-right' | 't-pose';

/** Arm angles in degrees, clockwise from hanging down. Left is the arm on the left of the screen. */
const ARM_ANGLES: Record<GuidePose, readonly [number, number]> = {
  relaxed: [14, -14],
  'raise-left': [165, -14],
  'raise-right': [14, -165],
  't-pose': [90, -90],
};

/** The pose the outline should show, so it always demonstrates what the message asks. */
export function poseForStep(step: CalibrationStep, handedness: Side | null): GuidePose {
  if (step === 'handedness') return handedness === 'left' ? 'raise-left' : 'raise-right';
  if (step === 'hold-still') return 't-pose';
  return 'relaxed';
}

interface ArmSpec {
  /** Shoulder pivot. */
  x: number;
  y: number;
  /** Which of the two arms: 0 left of screen, 1 right of screen. */
  side: 0 | 1;
  shape: Shape;
}

function bodyShapes(stance: Stance): Shape[] {
  switch (stance) {
    case 'full-body':
      return [rect(67, 22, 26, 34, 12), rect(68, 56, 11, 31, 5.5), rect(81, 56, 11, 31, 5.5)];
    case 'upper-body':
      return [rect(50, 22, 60, 66, 24)];
    case 'hands-close':
      return [...handShapes(52), ...handShapes(108)];
  }
}

function armSpecs(stance: Stance): ArmSpec[] {
  // Each arm hangs from its shoulder pivot (0, 0 in local space) and is rotated about it.
  switch (stance) {
    case 'full-body':
      return [
        { x: 68, y: 26, side: 0, shape: rect(-4.5, -2, 9, 30, 4.5) },
        { x: 92, y: 26, side: 1, shape: rect(-4.5, -2, 9, 30, 4.5) },
      ];
    case 'upper-body':
      return [
        { x: 52, y: 32, side: 0, shape: rect(-9, -4, 18, 46, 9) },
        { x: 108, y: 32, side: 1, shape: rect(-9, -4, 18, 46, 9) },
      ];
    case 'hands-close':
      return [];
  }
}

export interface Guide {
  readonly svg: SVGSVGElement;
  /** Move the arms to a pose with a short eased transition. Cheap when the pose is unchanged. */
  setPose(pose: GuidePose): void;
}

/** The silhouette guide drawn over the mirror view. */
export function createGuide(stance: Stance, pose: GuidePose = 'relaxed'): Guide {
  const svg = svgEl('svg', {
    viewBox: '0 -14 160 104',
    preserveAspectRatio: 'xMidYMid meet',
    class: 'guide',
    'aria-hidden': 'true',
  });
  for (const s of bodyShapes(stance)) {
    svg.append(
      svgEl(s.tag, { ...s.attrs, class: 'guide-halo' }),
      svgEl(s.tag, { ...s.attrs, class: 'guide-line' }),
    );
  }
  const arms: SVGGElement[] = [];
  const sides: number[] = [];
  for (const a of armSpecs(stance)) {
    const outer = svgEl('g', { transform: `translate(${a.x} ${a.y})` });
    const inner = svgEl('g', { class: 'guide-arm' });
    inner.append(
      svgEl(a.shape.tag, { ...a.shape.attrs, class: 'guide-halo' }),
      svgEl(a.shape.tag, { ...a.shape.attrs, class: 'guide-line' }),
    );
    outer.append(inner);
    svg.append(outer);
    arms.push(inner);
    sides.push(a.side);
  }
  let current: GuidePose | null = null;
  const setPose = (next: GuidePose): void => {
    if (next === current) return;
    current = next;
    const angles = ARM_ANGLES[next];
    for (let i = 0; i < arms.length; i++) {
      (arms[i] as SVGGElement).style.transform = `rotate(${angles[sides[i] as number]}deg)`;
    }
  };
  setPose(pose);
  return { svg, setPose };
}

export interface CalibrationBuild {
  spec: ScreenSpec & { onMount: () => void };
  screen: CalibrationScreen;
}

export function buildCalibration(
  meta: SportMeta,
  host: ScreenHost,
  release: () => void,
): CalibrationBuild {
  const { el, card } = screenShell('calibration', 'card-cal');
  // A sport with no dominant hand (or hands-only calibration) never shows the "Hand" step.
  const keep = meta.usesHandedness !== false && meta.stance !== 'hands-close';
  const STEPS = keep ? ALL_STEPS : ALL_STEPS.filter((s) => s !== 'handedness');
  const STEP_LABELS = keep ? ALL_LABELS : ALL_LABELS.filter((_, i) => i !== 2);
  const STEP_TEXT = STEPS.map((_, i) => `Step ${i + 1} of ${STEPS.length}`);
  const row = h('div', 'cal-row');
  const mirrorSlot = h('div', 'cal-mirror');
  const side = h('div', 'cal-side');

  const ringWrap = h('div', 'cal-ring');
  const ringSvg = svgEl('svg', { viewBox: '0 0 120 120', width: 150, height: 150 });
  ringSvg.append(
    svgEl('circle', {
      class: 'ring-bg',
      cx: 60,
      cy: 60,
      r: RING_R,
      fill: 'none',
      'stroke-width': 12,
    }),
  );
  const ring = svgEl('circle', {
    class: 'ring-fg',
    cx: 60,
    cy: 60,
    r: RING_R,
    fill: 'none',
    'stroke-width': 12,
    'stroke-linecap': 'round',
    'stroke-dasharray': RING_LEN.toFixed(1),
    'stroke-dashoffset': RING_LEN.toFixed(1),
    transform: 'rotate(-90 60 60)',
  });
  ringSvg.append(ring);
  const check = h('span', 'cal-check', '✓');
  check.setAttribute('aria-hidden', 'true');
  ringWrap.append(ringSvg, check);

  const stepText = h('p', 'cal-step');
  const dots = h('div', 'dots');
  const dotEls: HTMLElement[] = [];
  for (let i = 0; i < STEPS.length; i++) {
    const d = h('span', 'dot');
    d.title = STEP_LABELS[i] as string;
    dots.append(d);
    dotEls.push(d);
  }
  const status = h('p', 'cal-status');
  status.setAttribute('aria-live', 'polite');
  side.append(ringWrap, stepText, dots, status);
  let seatedHandler: ((seated: boolean) => void) | null = null;
  let sitting = false;
  const seat = selectButton('Sitting: off', 'btn btn-small btn-secondary cal-seat');
  seat.setAttribute('aria-pressed', 'false');
  seat.addEventListener('click', () => {
    sitting = !sitting;
    seat.textContent = sitting ? 'Sitting: on' : 'Sitting: off';
    seat.setAttribute('aria-pressed', String(sitting));
    // A seated player is not asked to fit a full-body outline.
    guide = createGuide(
      sitting && meta.stance === 'full-body' ? 'upper-body' : meta.stance,
      poseForStep(lastStep ?? 'position', lastHandedness),
    );
    guide.svg.classList.toggle('ok', lastOk === true);
    host.mirror.setGuide(guide.svg);
    seatedHandler?.(sitting);
  });
  if (meta.seatedOk) side.append(seat);
  row.append(mirrorSlot, side);

  const message = h('p', 'cal-message');
  const hint = h('p', 'cal-hint');
  hint.hidden = true;
  card.append(row, message, hint);

  const skip = selectButton('Skip', 'btn btn-small btn-secondary cal-skip');
  let doSkip: () => void = () => undefined;
  const skipped = new Promise<void>((resolve) => {
    doSkip = resolve;
  });
  skip.addEventListener('click', () => doSkip());
  el.append(skip);

  let guide = createGuide(meta.stance);

  let lastMessage: string | null = null;
  let lastHint: string | null | undefined;
  let lastRing = -1;
  let lastOk: boolean | null = null;
  let lastStep: CalibrationStep | null = null;
  let lastHandedness: Side | null = null;

  const set = (view: CalibrationView): void => {
    if (view.message !== lastMessage) {
      lastMessage = view.message;
      message.textContent = view.message;
    }
    if (view.hint !== lastHint) {
      lastHint = view.hint;
      hint.hidden = view.hint === null;
      hint.textContent = view.hint ?? '';
    }
    const p = Math.round(Math.max(0, Math.min(1, view.progress)) * 100);
    if (p !== lastRing) {
      lastRing = p;
      ring.setAttribute('stroke-dashoffset', (RING_LEN * (1 - p / 100)).toFixed(1));
      ringWrap.dataset.pct = PCT_INT[p] as string;
    }
    if (view.ok !== lastOk) {
      lastOk = view.ok;
      guide.svg.classList.toggle('ok', view.ok);
      ringWrap.classList.toggle('ok', view.ok);
      status.textContent = view.ok ? 'Looking good' : 'Not quite yet';
      status.classList.toggle('ok', view.ok);
    }
    if (view.step !== lastStep || view.handedness !== lastHandedness) {
      lastHandedness = view.handedness;
      guide.setPose(poseForStep(view.step, view.handedness));
    }
    if (view.step !== lastStep) {
      lastStep = view.step;
      const idx = view.step === 'done' ? STEPS.length : STEPS.indexOf(view.step);
      stepText.textContent = idx >= STEPS.length ? 'All done' : (STEP_TEXT[idx] as string);
      for (let i = 0; i < dotEls.length; i++) {
        const d = dotEls[i] as HTMLElement;
        d.classList.toggle('done', i < idx);
        d.classList.toggle('current', i === idx);
      }
    }
  };

  const screen: CalibrationScreen = {
    set,
    skipped,
    close: release,
    onSeated: meta.seatedOk
      ? (handler): void => {
          seatedHandler = handler;
        }
      : undefined,
  };

  const spec = {
    el,
    camera: true,
    primary: skip,
    onEscape: () => doSkip(),
    onMount(): void {
      mirrorSlot.append(host.mirror.el);
      host.camera.el.classList.add('inline');
      side.append(host.camera.el);
      host.mirror.setGuide(guide.svg);
      host.mirror.setMode('large');
    },
    dispose(): void {
      host.mirror.setGuide(null);
    },
  };
  return { spec, screen };
}
