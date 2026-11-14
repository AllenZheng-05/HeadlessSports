import type { TrackerNeeds } from '../tracking/types';

export type NeedsName = 'pose' | 'crops' | 'hands';

export const NEEDS: Record<NeedsName, TrackerNeeds> = {
  pose: { pose: true, handCrops: false, fullFrameHands: false },
  crops: { pose: true, handCrops: true, fullFrameHands: false },
  hands: { pose: false, handCrops: false, fullFrameHands: true },
};

const NEEDS_LABELS: Record<NeedsName, string> = {
  pose: 'Pose',
  crops: 'Pose + hand crops',
  hands: 'Full-frame hands',
};

export const HUD_KEYS = [
  'inference',
  'trackingHz',
  'renderFps',
  'latency',
  'dropped',
  'delegate',
  'thread',
  'backend',
  'drawCalls',
  'source',
  'poseModel',
] as const;
export type HudKey = (typeof HUD_KEYS)[number];

const HUD_LABELS: Record<HudKey, string> = {
  inference: 'Inference',
  trackingHz: 'Tracking',
  renderFps: 'Render',
  latency: 'Latency (est.)',
  dropped: 'Dropped frames',
  delegate: 'Tracker delegate',
  thread: 'Tracking thread',
  backend: 'Renderer',
  drawCalls: 'Draw calls',
  source: 'Source',
  poseModel: 'Pose model',
};

export const LATENCY_FORMULA =
  'Estimated end-to-end latency = tracker latency (capture to delivery) + average render frame time + 8 ms display allowance.';

export interface HandRefs {
  present: HTMLElement;
  known: HTMLElement;
  closed: HTMLElement;
  curl: HTMLElement;
}

export interface ArmRefs {
  speed: HTMLElement;
  elbow: HTMLElement;
  wristX: HTMLElement;
  wristY: HTMLElement;
}

export interface Ui {
  mediaBox: HTMLDivElement;
  overlay: HTMLCanvasElement;
  message: HTMLDivElement;
  messageText: HTMLElement;
  messageDetail: HTMLElement;
  cropsSection: HTMLElement;
  cropLeft: HTMLCanvasElement;
  cropRight: HTMLCanvasElement;
  athleteCanvas: HTMLCanvasElement;
  athleteMessage: HTMLDivElement;
  hud: Record<HudKey, HTMLElement>;
  hands: { left: HandRefs; right: HandRefs };
  arms: { left: ArmRefs; right: ArmRefs };
  lean: HTMLElement;
  lateral: HTMLElement;
  shoulderWidth: HTMLElement;
  tracking: HTMLElement;
  problem: HTMLElement;
  needsRadios: Record<NeedsName, HTMLInputElement>;
  sourceSelect: HTMLSelectElement;
  fileInput: HTMLInputElement;
  recordButton: HTMLButtonElement;
  replayButton: HTMLButtonElement;
  recordStatus: HTMLElement;
  links: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(title: string): HTMLElement {
  const c = el('section', 'card');
  c.appendChild(el('h2', undefined, title));
  return c;
}

function crop(label: string): { wrap: HTMLElement; canvas: HTMLCanvasElement } {
  const wrap = el('div', 'crop');
  const canvas = el('canvas');
  canvas.width = 160;
  canvas.height = 160;
  wrap.append(canvas, el('span', undefined, label));
  return { wrap, canvas };
}

function buildHud(): { card: HTMLElement; refs: Record<HudKey, HTMLElement> } {
  const c = card('Performance');
  const dl = el('dl', 'kv');
  const refs = {} as Record<HudKey, HTMLElement>;
  for (const key of HUD_KEYS) {
    const dt = el('dt', undefined, HUD_LABELS[key]);
    const dd = el('dd', undefined, '-');
    if (key === 'latency') {
      dt.title = LATENCY_FORMULA;
      dd.title = LATENCY_FORMULA;
    }
    dl.append(dt, dd);
    refs[key] = dd;
  }
  c.appendChild(dl);
  return { card: c, refs };
}

function buildReadout(): {
  card: HTMLElement;
  hands: Ui['hands'];
  arms: Ui['arms'];
  single: Pick<Ui, 'lean' | 'lateral' | 'shoulderWidth' | 'tracking' | 'problem'>;
} {
  const c = card('Input state');
  const table = el('table', 'readout');
  const head = el('thead');
  const hr = el('tr');
  hr.append(el('th'), el('th', undefined, 'Left'), el('th', undefined, 'Right'));
  head.appendChild(hr);
  const body = el('tbody');
  table.append(head, body);

  const pair = (label: string, gap = false): [HTMLElement, HTMLElement] => {
    const tr = el('tr', gap ? 'gap' : undefined);
    const l = el('td', undefined, '-');
    const r = el('td', undefined, '-');
    tr.append(el('td', undefined, label), l, r);
    body.appendChild(tr);
    return [l, r];
  };
  const single = (label: string, gap = false): HTMLElement => {
    const tr = el('tr', gap ? 'gap' : undefined);
    const v = el('td', undefined, '-');
    v.colSpan = 2;
    tr.append(el('td', undefined, label), v);
    body.appendChild(tr);
    return v;
  };

  const present = pair('Hand present');
  const known = pair('Hand known');
  const closed = pair('Fist closed');
  const curl = pair('Curl');
  const speed = pair('Arm speed (sw/s)', true);
  const elbow = pair('Elbow angle (deg)');
  const wristX = pair('Wrist x (sw)');
  const wristY = pair('Wrist y (sw)');
  const lean = single('Lean (deg)', true);
  const lateral = single('Lateral (sw)');
  const shoulderWidth = single('Shoulder width');
  const tracking = single('Tracking');
  const problem = single('Problem');
  c.appendChild(table);

  return {
    card: c,
    hands: {
      left: { present: present[0], known: known[0], closed: closed[0], curl: curl[0] },
      right: { present: present[1], known: known[1], closed: closed[1], curl: curl[1] },
    },
    arms: {
      left: { speed: speed[0], elbow: elbow[0], wristX: wristX[0], wristY: wristY[0] },
      right: { speed: speed[1], elbow: elbow[1], wristX: wristX[1], wristY: wristY[1] },
    },
    single: { lean, lateral, shoulderWidth, tracking, problem },
  };
}

export function buildUi(root: HTMLElement, scripts: string[], clips: string[]): Ui {
  const page = el('div', 'page');

  const top = el('header', 'top');
  top.append(el('h1', undefined, 'Headless Sports'), el('p', undefined, 'Tracking debug'));

  // Row 1: camera and athlete.
  const row1 = el('div', 'row');
  const camCard = card('Camera');
  const mediaBox = el('div', 'media');
  const overlay = el('canvas');
  const message = el('div', 'message');
  message.hidden = true;
  message.setAttribute('role', 'alert');
  const messageText = el('span');
  const messageDetail = el('small');
  message.append(messageText, messageDetail);
  mediaBox.append(overlay, message);
  camCard.appendChild(mediaBox);

  const cropsSection = el('div', 'crops');
  const cl = crop('Left hand crop');
  const cr = crop('Right hand crop');
  cropsSection.append(cl.wrap, cr.wrap);
  cropsSection.hidden = true;
  camCard.appendChild(cropsSection);

  const athCard = card('Athlete');
  const athlete = el('div', 'athlete');
  const athleteCanvas = el('canvas');
  const athleteMessage = el('div', 'message');
  athleteMessage.hidden = true;
  athlete.append(athleteCanvas, athleteMessage);
  athCard.appendChild(athlete);
  row1.append(camCard, athCard);

  // Row 2: controls, HUD, readout.
  const row2 = el('div', 'row three');
  const ctlCard = card('Controls');
  const controls = el('div', 'controls');

  const needsSet = el('fieldset');
  needsSet.appendChild(el('legend', undefined, 'Tracker needs'));
  const needsRadios = {} as Record<NeedsName, HTMLInputElement>;
  for (const name of ['pose', 'crops', 'hands'] as const) {
    const label = el('label', 'choice');
    const input = el('input');
    input.type = 'radio';
    input.name = 'needs';
    input.value = name;
    label.append(input, el('span', undefined, NEEDS_LABELS[name]));
    needsSet.appendChild(label);
    needsRadios[name] = input;
  }

  const srcSet = el('fieldset');
  srcSet.appendChild(el('legend', undefined, 'Source'));
  const sourceSelect = el('select');
  sourceSelect.setAttribute('aria-label', 'Source');
  const addGroup = (label: string, options: [string, string][]): void => {
    const g = el('optgroup');
    g.label = label;
    for (const [value, text] of options) {
      const o = el('option', undefined, text);
      o.value = value;
      g.appendChild(o);
    }
    sourceSelect.appendChild(g);
  };
  addGroup('Live', [['camera', 'Camera']]);
  addGroup(
    'Synthetic scripts',
    scripts.map((s): [string, string] => [`script:${s}`, s]),
  );
  if (clips.length > 0) {
    addGroup(
      'Recorded clips',
      clips.map((c): [string, string] => [`clip:${c}`, c]),
    );
  }
  const fileLabel = el('label', 'pill', 'Load clip file');
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileLabel.appendChild(fileInput);
  srcSet.append(sourceSelect, fileLabel);

  const recSet = el('fieldset');
  recSet.appendChild(el('legend', undefined, 'Recording'));
  const recordButton = el('button', 'pill primary', 'Record');
  recordButton.type = 'button';
  const replayButton = el('button', 'pill', 'Replay last recording');
  replayButton.type = 'button';
  replayButton.disabled = true;
  const recordStatus = el('span', 'status', '');
  recSet.append(recordButton, replayButton, recordStatus);

  const linkSet = el('fieldset');
  linkSet.appendChild(el('legend', undefined, 'Reload with'));
  const links = el('div');
  links.style.display = 'contents';
  linkSet.appendChild(links);

  controls.append(needsSet, srcSet, recSet, linkSet);
  ctlCard.appendChild(controls);

  const hud = buildHud();
  const readout = buildReadout();
  row2.append(ctlCard, hud.card, readout.card);

  page.append(top, row1, row2);
  root.appendChild(page);

  return {
    mediaBox,
    overlay,
    message,
    messageText,
    messageDetail,
    cropsSection,
    cropLeft: cl.canvas,
    cropRight: cr.canvas,
    athleteCanvas,
    athleteMessage,
    hud: hud.refs,
    hands: readout.hands,
    arms: readout.arms,
    ...readout.single,
    needsRadios,
    sourceSelect,
    fileInput,
    recordButton,
    replayButton,
    recordStatus,
    links,
  };
}
