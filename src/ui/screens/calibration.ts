import type { SportMeta, Stance } from '../../core/sport';
import { h, selectButton, svgEl } from '../dom';
import { PCT_INT } from '../format';
import type { CalibrationScreen, CalibrationStep, CalibrationView } from '../types';
import type { ScreenHost, ScreenSpec } from './shared';
import { screenShell } from './shared';

const STEPS: readonly CalibrationStep[] = ['position', 'lighting', 'handedness', 'hold-still'];
const STEP_LABELS: readonly string[] = ['Position', 'Light', 'Hand', 'Hold still'];
const STEP_TEXT: readonly string[] = STEPS.map((_, i) => `Step ${i + 1} of ${STEPS.length}`);
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

function stanceShapes(stance: Stance): Shape[] {
  switch (stance) {
    case 'full-body':
      return [
        rect(67, 22, 26, 34, 12),
        rect(53, 24, 9, 30, 4.5, 14),
        rect(98, 24, 9, 30, 4.5, -14),
        rect(68, 56, 11, 31, 5.5),
        rect(81, 56, 11, 31, 5.5),
      ];
    case 'upper-body':
      return [rect(50, 22, 60, 66, 24), rect(26, 28, 18, 52, 9, 10), rect(116, 28, 18, 52, 9, -10)];
    case 'hands-close':
      return [...handShapes(52), ...handShapes(108)];
  }
}

/** The silhouette guide drawn over the mirror view. */
export function createGuide(stance: Stance): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 160 90',
    preserveAspectRatio: 'xMidYMid meet',
    class: 'guide',
    'aria-hidden': 'true',
  });
  for (const s of stanceShapes(stance)) {
    svg.append(
      svgEl(s.tag, { ...s.attrs, class: 'guide-halo' }),
      svgEl(s.tag, { ...s.attrs, class: 'guide-line' }),
    );
  }
  return svg;
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

  const guide = createGuide(meta.stance);

  let lastMessage: string | null = null;
  let lastHint: string | null | undefined;
  let lastRing = -1;
  let lastOk: boolean | null = null;
  let lastStep: CalibrationStep | null = null;

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
      guide.classList.toggle('ok', view.ok);
      ringWrap.classList.toggle('ok', view.ok);
      status.textContent = view.ok ? 'Looking good' : 'Not quite yet';
      status.classList.toggle('ok', view.ok);
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
      host.mirror.setGuide(guide);
      host.mirror.setMode('large');
    },
    dispose(): void {
      host.mirror.setGuide(null);
    },
  };
  return { spec, screen };
}
