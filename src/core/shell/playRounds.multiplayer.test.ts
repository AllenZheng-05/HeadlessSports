import { describe, expect, it, vi } from 'vitest';
import type { Calibration } from '../../input/types';
import { makePlayers } from '../multiplayer/players';
import { MULTI_DONE } from '../multiplayer/result';
import { MemoryScoreStore } from '../scores';
import type { RoundResult, SportEntry, SportMeta } from '../sport';
import { playRounds } from './playRounds';
import type { RoundsDeps } from './playRounds';

const meta: SportMeta = {
  id: 'fake',
  title: 'Fake',
  tagline: 'x',
  accent: 0,
  requiredTrackers: { pose: true, handCrops: false, fullFrameHands: false },
  stance: 'upper-body',
  seatedOk: true,
  needsSpace: false,
  score: { label: 'Score', unit: '', decimals: 0, higherIsBetter: true },
  howTo: [],
  debugKeys: [],
  multiplayer: { turnLabel: 'turn', maxPlayers: 4 },
};
const entry = { meta, load: () => Promise.reject(new Error('not used')) } as SportEntry;
const CALS = [{ id: 0 }, { id: 1 }] as unknown as Calibration[];
const players = makePlayers(['Mia', 'Sam'], 2);
const MULTI = { players, calibrations: CALS };
const RESULTS: RoundResult[] = [
  { score: 4, headline: '4 pts' },
  { score: 9, headline: '9 pts' },
];

function setup(choices: ('again' | 'change' | 'menu')[]) {
  const scores = new MemoryScoreStore();
  const add = vi.spyOn(scores, 'add');
  const play = vi.fn(() => Promise.resolve<RoundResult | null>(MULTI_DONE));
  const queue = [...choices];
  const showMultiResults = vi.fn(() => Promise.resolve(queue.shift() ?? 'menu'));
  const showResults = vi.fn();
  const hook = {
    phase: 'menu' as string,
    result: null as RoundResult | null,
    isBest: null as boolean | null,
    tutorial: false,
    ranking: null as { rank: number; name: string; score: number; headline: string }[] | null,
  };
  const host = { play, lastRoundFailed: false, multiResults: RESULTS };
  const deps = {
    host,
    ui: { showResults, showTutorialDone: vi.fn(), showMultiResults },
    scores,
    hook,
    isCurrent: () => true,
  } as unknown as RoundsDeps;
  return { deps, add, play, showMultiResults, showResults, hook, scores };
}

describe('playRounds pass-and-play', () => {
  it('shows the ranked table and saves nothing: no score, no personal best', async () => {
    const t = setup(['menu']);
    const end = await playRounds(t.deps, entry, CALS[0] ?? null, false, MULTI);
    expect(end).toBe('menu');
    expect(t.add).not.toHaveBeenCalled();
    expect(t.showResults).not.toHaveBeenCalled();
    expect(await t.scores.best('fake', true)).toBeNull();
    expect(t.hook.result).toBeNull();
    expect(t.hook.isBest).toBeNull();
    expect(t.hook.phase).toBe('results');
    expect(t.hook.ranking).toEqual([
      { rank: 1, name: 'Sam', score: 9, headline: '9 pts' },
      { rank: 2, name: 'Mia', score: 4, headline: '4 pts' },
    ]);
    const [, rows, winner] = t.showMultiResults.mock.calls[0] as unknown as [
      SportMeta,
      { rank: number }[],
      string,
    ];
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(winner).toBe('Sam wins');
  });

  it('Play again keeps the same players and calibrations, with no names step in between', async () => {
    const t = setup(['again', 'menu']);
    const end = await playRounds(t.deps, entry, CALS[0] ?? null, false, MULTI);
    expect(end).toBe('menu');
    expect(t.play).toHaveBeenCalledTimes(2);
    for (const call of t.play.mock.calls as unknown as unknown[][]) {
      expect(call[1]).toBe(CALS[0]);
      expect((call[2] as { multiplayer: unknown }).multiplayer).toBe(MULTI);
    }
    expect(t.add).not.toHaveBeenCalled();
  });

  it('Change players ends the run so the shell can ask for names again', async () => {
    const t = setup(['change']);
    expect(await playRounds(t.deps, entry, CALS[0] ?? null, false, MULTI)).toBe('change');
    expect(t.play).toHaveBeenCalledTimes(1);
  });

  it('ranks lower-is-better sports the other way', async () => {
    const low: SportEntry = {
      ...entry,
      meta: { ...meta, score: { ...meta.score, higherIsBetter: false } },
    };
    const t = setup(['menu']);
    await playRounds(t.deps, low, null, false, MULTI);
    expect(t.hook.ranking?.map((r) => r.name)).toEqual(['Mia', 'Sam']);
  });

  it('a single-player round is recorded as before', async () => {
    const t = setup([]);
    t.play.mockResolvedValueOnce({ score: 7, headline: '7' });
    t.showResults.mockResolvedValueOnce('menu');
    await playRounds(t.deps, entry, null, false);
    expect(t.add).toHaveBeenCalledTimes(1);
    expect(t.showMultiResults).not.toHaveBeenCalled();
  });

  it('a tutorial request stays single-player even when a setup is given', async () => {
    const t = setup([]);
    t.play.mockResolvedValueOnce(null);
    await playRounds(t.deps, { ...entry, meta: { ...meta, hasTutorial: true } }, null, true, MULTI);
    expect(t.play).toHaveBeenCalledWith(expect.anything(), null, { tutorial: true });
  });
});
