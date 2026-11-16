import '../styles/base.css';
import './harness.css';
import { createUi } from './createUi';
import {
  FAKE_BESTS,
  FAKE_BLOCKED_REPORT,
  FAKE_GATE_REPORT,
  FAKE_RESULT,
  FAKE_SPORTS,
} from './harness/fakeData';
import { createFakeInput } from './harness/fakeInput';
import { makePlayers } from '../core/multiplayer/players';
import { rankResults, winnerLine } from '../core/multiplayer/ranking';
import type { FakeInput } from './harness/fakeInput';
import { meta as archeryMeta } from '../sports/archery/meta';
import { meta as battingMeta } from '../sports/batting/meta';
import { meta as bowlingMeta } from '../sports/bowling/meta';
import { meta as climbingMeta } from '../sports/climbing/meta';
import { meta as javelinMeta } from '../sports/javelin/meta';
import { meta as pitchingMeta } from '../sports/pitching/meta';
import { meta as warmupMeta } from '../sports/warmup/meta';
import type { TrackingErrorCode } from '../tracking/types';
import type { FrameProblem } from '../input/types';
import type { CalibrationView, PlayersControl, Ui } from './types';

declare global {
  interface Window {
    __ui: { ui: Ui; resolved: string | null; paused: boolean; fake: FakeInput | null };
  }
}

/** The real sport metas, for checking their copy against the layout. */
const REAL_METAS = [
  climbingMeta,
  bowlingMeta,
  battingMeta,
  archeryMeta,
  javelinMeta,
  pitchingMeta,
  warmupMeta,
];

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'title';
const count = Math.max(1, Math.min(8, Number(params.get('n') ?? 5)));
const seatCount = Math.max(2, Math.min(4, Number(params.get('seats') ?? 3)));
const multiMeta = { ...archeryMeta };
function playersControl(): PlayersControl {
  const control: PlayersControl = {
    count: 1,
    onCount: (n) => {
      control.count = n;
      hub.resolved = `players:${n}`;
    },
  };
  return control;
}
const sports = params.has('real') ? REAL_METAS : FAKE_SPORTS.slice(0, count);
const root = document.getElementById('ui') as HTMLElement;

const ui = createUi(root, {
  debug: params.has('debug'),
  reducedMotion: params.get('rm') === '1' ? true : undefined,
});
const hub: Window['__ui'] = { ui, resolved: null, paused: false, fake: null };
ui.onHowToPlay((open) => {
  hub.paused = open;
});
window.__ui = hub;

// ?mouseonly=1 (or ?input=debug): the "Turn camera on" button is on offer.
ui.onCameraOn(() => {
  hub.resolved = 'camera-on';
});
if (params.get('input') === 'debug' || params.has('mouseonly')) ui.setCameraOnAvailable(true);

const handParam = params.get('hand');
// ?input=debug: no landmark source, like mouse play.
const debugInput = params.get('input') === 'debug';
const wantsInput =
  handParam !== null ||
  debugInput ||
  screen === 'playing' ||
  screen === 'pause' ||
  screen === 'calibration';
const fake = wantsInput
  ? createFakeInput(handParam === '1' ? 'hands' : 'pose', debugInput ? 'debug' : 'camera')
  : null;
hub.fake = fake;
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

// ?sport=<n> picks a stand-in sport; ?sport=<id> (for example bowling) picks the real one.
const sportParam = params.get('sport') ?? '1';
const sportIndex = Number(sportParam);
const meta =
  (Number.isNaN(sportIndex) ? REAL_METAS.find((m) => m.id === sportParam) : undefined) ??
  FAKE_SPORTS[sportIndex] ??
  FAKE_SPORTS[1]!;

// ?cam=1 turns the camera indicator on, as it is while the camera runs behind a menu.
if (params.has('cam')) ui.setCameraActive(true);

switch (screen) {
  case 'loading':
    if (params.has('cancel')) {
      ui.showLoading('Bowling', undefined, () => {
        hub.resolved = 'cancelled';
      });
    } else {
      ui.showLoading('Loading the tracker...', 0.6);
    }
    break;
  case 'gatefail':
    ui.showGateFail(FAKE_BLOCKED_REPORT);
    break;
  case 'gatewarn':
    track(ui.showGateWarning(FAKE_GATE_REPORT));
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
    track(
      ui.showMenu(
        sports,
        FAKE_BESTS,
        params.has('notice') ? 'That round broke. Pick a sport to try again.' : undefined,
      ),
    );
    break;
  case 'howto':
    track(
      ui.showHowTo(
        meta,
        params.has('debugkeys') || debugInput,
        params.has('toggle') || debugInput
          ? {
              handedness: params.get('toggle') === 'left' ? 'left' : 'right',
              onHandedness: (side) => {
                hub.resolved = `hand:${side}`;
              },
            }
          : undefined,
        // ?multi=1: the Players control, as for a sport with pass-and-play.
        params.has('multi') ? playersControl() : undefined,
      ),
    );
    break;
  case 'names':
    // ?hands=1 adds the mouse-play "Dominant hand" choice beside each name.
    track(
      ui.showNames(
        multiMeta,
        ['Mia', 'Player 2', 'Player 3', 'Player 4'].slice(0, seatCount),
        params.has('hands')
          ? {
              hands: ['right', 'left', 'right', 'right'].slice(0, seatCount) as (
                'left' | 'right'
              )[],
            }
          : undefined,
      ),
    );
    break;
  case 'handover': {
    const players = makePlayers(['Mia', 'Sam', 'Zoe', 'Alexander J'], seatCount);
    const who = Math.min(players.length - 1, Number(params.get('who') ?? 1));
    track(
      ui.showHandover({
        player: players[who] as (typeof players)[number],
        mode: params.has('stepin') ? 'step-in' : 'up',
        camera: params.has('cam'),
        standings: params.has('stepin')
          ? []
          : players.map((player, i) => ({
              player,
              text: `${i * 7 + 3} pts`,
              leading: params.has('lead') && i === Number(params.get('lead')),
            })),
      }),
    );
    // ?hint=1 shows the camera card's second line, "Swap places, or make a fist on Ready".
    if (params.has('hint')) ui.setHandoverHint(true);
    break;
  }
  case 'multiresults': {
    const players = makePlayers(['Mia', 'Sam', 'Zoe', 'Alexander J'], seatCount);
    const scores = (params.get('scores') ?? '24,31,24,9').split(',').map(Number);
    const results = players.map((_, i) => ({
      score: scores[i] ?? 0,
      headline: `${scores[i] ?? 0} pts`,
      lines: ['Rings: 10, 8, 6'],
    }));
    const rows = rankResults(players, results, true);
    track(ui.showMultiResults(multiMeta, rows, winnerLine(rows)));
    break;
  }
  case 'calibration': {
    const cal = ui.showCalibration(meta);
    ui.setCameraActive(true);
    cal.onSeated?.((seated) => {
      hub.resolved = `seated:${seated}`;
    });
    void cal.skipped.then(() => {
      hub.resolved = 'skipped';
    });
    const view: CalibrationView = {
      step: (params.get('step') ?? 'position') as CalibrationView['step'],
      message: 'Step back until your whole body is inside the outline',
      hint: 'It is a bit dark. Turn on a light or face a window.',
      progress: 0.6,
      ok: params.get('ok') === '1',
      problem: 'none',
      handedness: params.get('handed') === 'left' ? 'left' : null,
    };
    cal.set(view);
    break;
  }
  case 'playing':
  case 'pause': {
    const tutorial = params.has('tutorial');
    ui.showPlaying(meta, { tutorial });
    ui.setCameraActive(true);
    const hud = ui.hud;
    hud.setScore('187');
    hud.setSubScore('Best 212');
    hud.setBanner(params.get('banner') ?? 'Strike!');
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
    if (params.has('seats')) {
      const players = makePlayers(['Mia', 'Sam', 'Zoe', 'Alexander J'], seatCount);
      ui.standings.show(players);
      players.forEach((_, i) => ui.standings.set(i, `${i * 7 + 3} pts`));
      ui.standings.setCurrent(1);
    }
    if (screen === 'pause') ui.showPause((params.get('problem') ?? 'move-left') as FrameProblem);
    ui.onQuit(() => {
      hub.resolved = 'quit';
    });
    if (tutorial) {
      // ?tutorial=1 shows the coach panel; ?step=<n> picks the step, ?confirm=1 the confirmation.
      const step = Number(params.get('step') ?? 1);
      ui.coach.onSkip(() => {
        hub.resolved = 'skip';
      });
      ui.onTutorialEnd(() => {
        hub.resolved = 'end';
      });
      if (params.has('confirm')) {
        ui.coach.show(step, 7, 'Reach for a hold and make a fist to grab it');
        ui.coach.confirm();
      } else {
        ui.coach.show(
          step,
          7,
          params.get('text') ?? 'Reach for a hold and make a fist to grab it',
          params.has('nodetail') ? null : 'Use either hand.',
        );
        if (!params.has('nofeedback')) ui.coach.setFeedback('Move closer to a hold');
      }
    }
    break;
  }
  case 'tutorialdone':
    track(ui.showTutorialDone(meta));
    break;
  case 'results':
    track(ui.showResults(meta, FAKE_RESULT, { isBest: params.get('best') !== '0', best: 31.7 }));
    break;
}
