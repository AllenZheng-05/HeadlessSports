import { defaultControls } from '../controls';
import type { Script, ScriptStep } from '../script';
import {
  armDown,
  armUp,
  climbPull,
  closeFist,
  drawBow,
  handsOnlyStart,
  idle,
  jumpUp,
  leanTo,
  openFist,
  overarmThrow,
  raiseArm,
  runInPlace,
  sidestep,
  squat,
  twoHandSwing,
  underarmSwing,
} from './moves';
import { registerScript } from './registry';

/** Return every control to the relaxed standing pose. */
function reset(ms = 600): ScriptStep[] {
  return [{ dur: ms, to: defaultControls(), label: 'reset' }];
}

function waveSteps(): ScriptStep[] {
  return [
    ...idle(500),
    ...armUp('right'),
    ...closeFist('right'),
    ...openFist('right'),
    ...closeFist('right'),
    ...openFist('right'),
    ...idle(300),
    ...armDown('right'),
    ...idle(400),
  ];
}

function fistsSteps(): ScriptStep[] {
  const raised = {
    leftWristX: -0.55,
    leftWristY: -0.85,
    rightWristX: 0.55,
    rightWristY: -0.85,
  };
  return [
    ...idle(400),
    { dur: 600, to: raised, label: 'raise' },
    ...idle(500),
    ...closeFist('left'),
    ...idle(500),
    ...openFist('left'),
    ...idle(400),
    ...closeFist('right'),
    ...idle(500),
    ...openFist('right'),
    ...idle(400),
    ...reset(),
  ];
}

function bowlSteps(): ScriptStep[] {
  return [
    ...idle(500),
    ...closeFist('right'),
    ...idle(400),
    ...underarmSwing('right'),
    ...openFist('right'),
    ...idle(500),
  ];
}

function throwSteps(): ScriptStep[] {
  return [
    ...idle(500),
    ...raiseArm('right', { fist: true, holdMs: 600 }),
    ...runInPlace({ steps: 8, stepsPerSecond: 3 }),
    ...overarmThrow('right'),
    ...openFist('right'),
    ...idle(500),
  ];
}

function swingSteps(): ScriptStep[] {
  return [...idle(500), ...twoHandSwing(), ...reset(), ...idle(400)];
}

function runSteps(): ScriptStep[] {
  return [...idle(500), ...runInPlace({ steps: 12, stepsPerSecond: 3 }), ...reset(), ...idle(400)];
}

function handsSteps(): ScriptStep[] {
  return [
    ...idle(600),
    ...climbPull('left', { reachX: 0.36, reachY: 0.35, pullBy: 0.18 }),
    ...climbPull('right', { reachX: 0.64, reachY: 0.3, pullBy: 0.18 }),
    ...climbPull('left', { reachX: 0.4, reachY: 0.25, pullBy: 0.18 }),
    ...climbPull('right', { reachX: 0.6, reachY: 0.2, pullBy: 0.18 }),
    ...idle(400),
  ];
}

function lostSteps(): ScriptStep[] {
  return [
    ...idle(800),
    { dur: 500, to: { centreX: 1.35 }, ease: 'in', label: 'leave' },
    { dur: 1, to: { bodyVisible: 0 }, label: 'lost' },
    { dur: 1500, label: 'lost' },
    { dur: 1, to: { bodyVisible: 1 }, label: 'return' },
    { dur: 600, to: { centreX: 0.5 }, ease: 'out', label: 'return' },
    ...idle(800),
  ];
}

registerScript('idle', () => ({ name: 'idle', steps: idle(3000) }));
registerScript('wave', () => ({ name: 'wave', steps: waveSteps() }));
registerScript('fists', () => ({ name: 'fists', steps: fistsSteps() }));
registerScript('bowl', () => ({ name: 'bowl', steps: bowlSteps() }));
registerScript('throw', () => ({ name: 'throw', steps: throwSteps() }));
registerScript('swing', () => ({ name: 'swing', steps: swingSteps() }));
registerScript('run', () => ({ name: 'run', steps: runSteps() }));
registerScript('hands', () => ({ name: 'hands', start: handsOnlyStart(), steps: handsSteps() }));
registerScript('lost', () => ({ name: 'lost', steps: lostSteps() }));
registerScript('all', (): Script => ({
  name: 'all',
  loop: true,
  steps: [
    ...idle(400),
    ...waveSteps(),
    ...reset(),
    ...bowlSteps(),
    ...reset(),
    ...throwSteps(),
    ...reset(),
    ...swingSteps(),
    ...runSteps(),
    ...leanTo(0.2),
    ...leanTo(-0.2, 600),
    ...leanTo(0),
    ...sidestep(0.35),
    ...sidestep(0.65, 700),
    ...sidestep(0.5),
    ...squat(),
    ...jumpUp(),
    ...drawBow('right', { draw: 1 }),
    ...reset(),
    ...lostSteps(),
    ...reset(),
  ],
}));
