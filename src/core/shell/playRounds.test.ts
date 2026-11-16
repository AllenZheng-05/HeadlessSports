import { describe, expect, it, vi } from 'vitest';
import { MemoryScoreStore } from '../scores';
import type { Calibration } from '../../input/types';
import type { RoundResult, SportEntry, SportMeta } from '../sport';
import { TUTORIAL_DONE } from '../tutorial/result';
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
  hasTutorial: true,
};
const entry = { meta, load: () => Promise.reject(new Error('not used')) } as SportEntry;
const CAL = { stance: 'upper-body' } as unknown as Calibration;
const ROUND: RoundResult = { score: 5, headline: '5' };

function setup(plays: (RoundResult | null)[]) {
  const scores = new MemoryScoreStore();
  const add = vi.spyOn(scores, 'add');
  const queue = [...plays];
  const play = vi.fn(() => Promise.resolve(queue.shift() ?? null));
  const showResults = vi.fn(() => Promise.resolve<'again' | 'menu'>('menu'));
  const showTutorialDone = vi.fn(() => Promise.resolve<'play' | 'menu'>('menu'));
  const hook = {
    phase: 'menu' as string,
    result: null as RoundResult | null,
    isBest: null as boolean | null,
    tutorial: false,
  };
  const host = { play, lastRoundFailed: false };
  const deps = {
    host,
    ui: { showResults, showTutorialDone },
    scores,
    hook,
    isCurrent: () => true,
  } as unknown as RoundsDeps;
  return { deps, add, play, showResults, showTutorialDone, hook, host, scores };
}

describe('playRounds', () => {
  it('a tutorial never saves a score or claims a best, and shows the done screen', async () => {
    const t = setup([TUTORIAL_DONE]);
    const end = await playRounds(t.deps, entry, CAL, true);
    expect(end).toBe('menu');
    expect(t.play).toHaveBeenCalledWith(entry, CAL, { tutorial: true });
    expect(t.add).not.toHaveBeenCalled();
    expect(t.showResults).not.toHaveBeenCalled();
    expect(t.showTutorialDone).toHaveBeenCalledWith(meta);
    expect(t.hook.result).toBeNull();
    expect(t.hook.isBest).toBeNull();
    expect(await t.scores.best('fake', true)).toBeNull();
  });

  it('Play now starts a normal round of the same sport with the same calibration', async () => {
    const t = setup([TUTORIAL_DONE, ROUND]);
    t.showTutorialDone.mockResolvedValueOnce('play');
    const end = await playRounds(t.deps, entry, CAL, true);
    expect(end).toBe('menu');
    expect(t.play).toHaveBeenCalledTimes(2);
    expect(t.play).toHaveBeenNthCalledWith(1, entry, CAL, { tutorial: true });
    expect(t.play).toHaveBeenNthCalledWith(2, entry, CAL, { tutorial: false });
    expect(t.hook.tutorial).toBe(false);
    // The normal round that follows is saved as usual.
    expect(t.add).toHaveBeenCalledTimes(1);
    expect(t.showResults).toHaveBeenCalledTimes(1);
  });

  it('Back to menu leaves after the tutorial', async () => {
    const t = setup([TUTORIAL_DONE]);
    expect(await playRounds(t.deps, entry, CAL, true)).toBe('menu');
    expect(t.play).toHaveBeenCalledTimes(1);
  });

  it('Play again after a real round stays in normal mode', async () => {
    const t = setup([ROUND, ROUND]);
    t.showResults.mockResolvedValueOnce('again');
    await playRounds(t.deps, entry, CAL, false);
    expect(t.play).toHaveBeenNthCalledWith(1, entry, CAL, { tutorial: false });
    expect(t.play).toHaveBeenNthCalledWith(2, entry, CAL, { tutorial: false });
    expect(t.add).toHaveBeenCalledTimes(2);
  });

  it('asks for a tutorial only when the sport has one', async () => {
    const t = setup([ROUND]);
    const plain = { ...entry, meta: { ...meta, hasTutorial: undefined } } as SportEntry;
    await playRounds(t.deps, plain, CAL, true);
    expect(t.play).toHaveBeenCalledWith(plain, CAL, { tutorial: false });
  });

  it('reports a broken round and a restarted flow', async () => {
    const broken = setup([null]);
    broken.host.lastRoundFailed = true;
    expect(await playRounds(broken.deps, entry, CAL, false)).toBe('failed');
    const quit = setup([null]);
    expect(await playRounds(quit.deps, entry, CAL, false)).toBe('menu');
    const stale = setup([ROUND]);
    stale.deps.isCurrent = () => false;
    expect(await playRounds(stale.deps, entry, CAL, false)).toBe('stale');
    expect(stale.add).not.toHaveBeenCalled();
  });
});
