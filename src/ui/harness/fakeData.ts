import type { GateReport } from '../../core/gate/types';
import type { RoundResult, SportMeta } from '../../core/sport';

const base = {
  requiredTrackers: { pose: 'full', hands: 'none' },
} as unknown as Pick<SportMeta, 'requiredTrackers'>;

function sport(
  id: string,
  title: string,
  tagline: string,
  accent: number,
  extra: Partial<SportMeta> = {},
): SportMeta {
  return {
    id,
    title,
    tagline,
    accent,
    ...base,
    stance: 'upper-body',
    seatedOk: false,
    needsSpace: true,
    score: { label: 'Score', unit: 'pts', decimals: 0, higherIsBetter: true },
    howTo: ['Raise your throwing hand', 'Swing your arm forward', 'Let go with an open hand'],
    debugKeys: ['Mouse: move hand', 'Q / E: grab', 'Space: release'],
    ...extra,
  };
}

export const FAKE_SPORTS: SportMeta[] = [
  sport('climbing', 'Rock climbing', 'Reach up and grab the holds.', 0xf2a07b, {
    stance: 'hands-close',
    seatedOk: true,
    needsSpace: false,
    score: { label: 'Height', unit: 'm', decimals: 1, higherIsBetter: true },
    howTo: [
      'Hold both hands up in view',
      'Close a fist to grab a hold',
      'Open your hand to let go',
    ],
  }),
  sport('bowling', 'Bowling', 'Swing low and roll a strike.', 0xf0d29a, {
    stance: 'full-body',
    howTo: ['Stand sideways to the lane', 'Swing your arm back', 'Swing forward and let go'],
  }),
  sport('batting', 'Batting', 'Time your swing to hit a homer.', 0xf2a0b8, {
    stance: 'full-body',
    score: { label: 'Distance', unit: 'm', decimals: 0, higherIsBetter: true },
  }),
  sport('archery', 'Archery', 'Draw, aim and let the arrow fly.', 0xf6d55c, {
    seatedOk: true,
    needsSpace: false,
  }),
  sport('javelin', 'Javelin', 'Run, plant and throw far.', 0xe8785a, {
    stance: 'full-body',
    score: { label: 'Distance', unit: 'm', decimals: 1, higherIsBetter: true },
  }),
  sport('darts', 'Darts', 'Flick your wrist for a bullseye.', 0xbfa6e8, { seatedOk: true }),
  sport('boxing', 'Boxing', 'Punch fast and keep your guard up.', 0x9fd0e8, {
    stance: 'full-body',
  }),
  sport('running', 'Running', 'Run on the spot to the finish.', 0xa8d98f, { stance: 'full-body' }),
];

export const FAKE_BESTS: ReadonlyMap<string, number> = new Map([
  ['climbing', 12.4],
  ['bowling', 187],
  ['javelin', 31.7],
]);

export const FAKE_RESULT: RoundResult = {
  score: 31.7,
  headline: '31.7 m',
  lines: ['Throw 1: 28.4 m', 'Throw 2: 31.7 m', 'Throw 3: 25.0 m'],
};

export const FAKE_GATE_REPORT: GateReport = {
  passed: false,
  skipped: false,
  failures: ['slow-tracking', 'slow-rendering'],
  capabilities: {
    webgl2: true,
    cameraApi: true,
    workers: true,
    touchPrimary: false,
    viewportWidth: 1280,
    viewportHeight: 720,
  },
  measurements: {
    inferenceMs: 61.4,
    trackingHz: 14.2,
    renderFrameMs: 41.7,
    renderFps: 24,
    rendererBackend: 'webgl2',
    trackerDelegate: 'CPU',
    trackerInWorker: true,
  },
  thresholds: {
    minTrackingHz: 24,
    minRenderFps: 50,
    minViewportWidth: 1024,
    minViewportHeight: 600,
    benchmarkMs: 3000,
    warmupInferences: 5,
  },
  error: null,
};

/** A device that cannot start the game at all: no WebGL 2. */
export const FAKE_BLOCKED_REPORT: GateReport = {
  ...FAKE_GATE_REPORT,
  failures: ['no-webgl2'],
  capabilities: { ...FAKE_GATE_REPORT.capabilities, webgl2: false },
  measurements: null,
};
