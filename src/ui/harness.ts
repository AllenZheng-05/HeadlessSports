import '../styles/base.css';
import { createUi } from './createUi';
import { FAKE_BESTS, FAKE_GATE_REPORT, FAKE_RESULT, FAKE_SPORTS } from './harness/fakeData';
import { createFakeInput } from './harness/fakeInput';
import type { TrackingErrorCode } from '../tracking/types';
import type { FrameProblem } from '../input/types';
import type { CalibrationView, Ui } from './types';

declare global {
  interface Window {
    __ui: { ui: Ui; resolved: string | null };
  }
}

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'title';
const count = Math.max(1, Math.min(8, Number(params.get('n') ?? 5)));
const sports = FAKE_SPORTS.slice(0, count);
const root = document.getElementById('ui') as HTMLElement;

const ui = createUi(root, {
  debug: params.has('debug'),
  reducedMotion: params.get('rm') === '1' ? true : undefined,
});
const hub: Window['__ui'] = { ui, resolved: null };
window.__ui = hub;

const handParam = params.get('hand');
const wantsInput =
  handParam !== null || screen === 'playing' || screen === 'pause' || screen === 'calibration';
const fake = wantsInput ? createFakeInput(handParam === '1' ? 'hands' : 'pose') : null;
if (fake) {
  ui.setInput(fake);
  const move = (e: MouseEvent): void =>
    fake.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight, e.buttons > 0);
  window.addEventListener('mousemove', move);
  window.addEventListener('mousedown', move);
  window.addEventListener('mouseup', move);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r')
      fake.emit({ type: 'ArmRaised', t: performance.now(), hand: 'right', both: false });
  });
  // the mirror shows a palm marker in the play screenshots
  if (screen === 'playing' || screen === 'pause') fake.setMouse(0.6, 0.3, false);
}

let last = performance.now();
const frame = (now: number): void => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fake?.update(now);
  ui.update(dt, now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

function track(p: Promise<unknown>): void {
  void p.then((v) => {
    hub.resolved = v === undefined ? 'resolved' : String(v);
  });
}

const sportIndex = Number(params.get('sport') ?? 1);
const meta = FAKE_SPORTS[sportIndex] ?? FAKE_SPORTS[1]!;

switch (screen) {
  case 'loading':
    ui.showLoading('Loading the tracker...', 0.6);
    break;
  case 'gatefail':
    ui.showGateFail(FAKE_GATE_REPORT);
    break;
  case 'title':
    track(ui.showTitle());
    break;
  case 'camintro':
    track(ui.showCameraIntro());
    break;
  case 'camerror':
    track(ui.showCameraError((params.get('code') ?? 'camera-denied') as TrackingErrorCode));
    break;
  case 'menu':
    track(ui.showMenu(sports, FAKE_BESTS));
    break;
  case 'howto':
    track(ui.showHowTo(meta, params.has('debugkeys')));
    break;
  case 'calibration': {
    const cal = ui.showCalibration(meta);
    ui.setCameraActive(true);
    void cal.skipped.then(() => {
      hub.resolved = 'skipped';
    });
    const view: CalibrationView = {
      step: 'position',
      message: 'Step back until your whole body is inside the outline',
      hint: 'It is a bit dark. Turn on a light or face a window.',
      progress: 0.6,
      ok: params.get('ok') === '1',
      problem: 'none',
      handedness: null,
    };
    cal.set(view);
    break;
  }
  case 'playing':
  case 'pause': {
    ui.showPlaying(meta);
    ui.setCameraActive(true);
    const hud = ui.hud;
    hud.setScore('187');
    hud.setSubScore('Best 212');
    hud.setBanner('Strike!');
    hud.setHint('Swing your arm forward and let go');
    hud.setMeter('power', 0.72, 'Power', 'good');
    hud.setMeter('foul', 0.35, 'Foul line', 'warn');
    hud.setTable(
      [
        ['1', '2', '3', '4', '5'],
        ['X', '7/', '9', '-', ''],
      ],
      3,
    );
    hud.setCursor('left', 0.3, 0.62, false);
    hud.setCursor('right', 0.68, 0.55, true);
    if (screen === 'pause') ui.showPause((params.get('problem') ?? 'move-left') as FrameProblem);
    ui.onQuit(() => {
      hub.resolved = 'quit';
    });
    break;
  }
  case 'results':
    track(ui.showResults(meta, FAKE_RESULT, { isBest: params.get('best') !== '0', best: 31.7 }));
    break;
}
