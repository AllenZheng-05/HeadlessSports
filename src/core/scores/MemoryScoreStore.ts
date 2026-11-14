import type { ScoreEntry, ScoreStore } from './types';

/** Shared by both stores so they rank, prune and validate identically. */
export const MAX_ENTRIES_PER_SPORT = 200;
export const DEFAULT_HISTORY_LIMIT = 20;
export const DEFAULT_TOP_LIMIT = 10;

export function cloneEntry(entry: ScoreEntry): ScoreEntry {
  const copy: ScoreEntry = { sportId: entry.sportId, score: entry.score, at: entry.at };
  if (entry.detail !== undefined) copy.detail = { ...entry.detail };
  return copy;
}

export function assertValidEntry(entry: ScoreEntry): void {
  if (!entry.sportId) throw new RangeError('sportId must not be empty');
  if (!Number.isFinite(entry.score)) {
    throw new RangeError(`score must be a finite number, got ${entry.score}`);
  }
}

/** True when `a` ranks strictly ahead of `b`. Equal scores never beat each other. */
export function beats(a: number, b: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? a > b : a < b;
}

/** Index of the best entry in insertion order (earliest wins ties), or -1 when empty. */
export function bestIndex(list: readonly ScoreEntry[], higherIsBetter: boolean): number {
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    if (best === -1 || beats(list[i].score, list[best].score, higherIsBetter)) best = i;
  }
  return best;
}

/** Indices of the oldest entries to delete so that at most `cap` remain, never `keepIndex`. */
export function indicesToPrune(
  list: readonly ScoreEntry[],
  keepIndex: number,
  cap: number,
): number[] {
  const excess = list.length - cap;
  const out: number[] = [];
  for (let i = 0; i < list.length && out.length < excess; i++) {
    if (i !== keepIndex) out.push(i);
  }
  return out;
}

/** Best first; stable, so ties keep insertion order (earlier first). */
export function rankedTop(
  list: readonly ScoreEntry[],
  limit: number,
  higherIsBetter: boolean,
): ScoreEntry[] {
  return [...list]
    .sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score))
    .slice(0, limit);
}

export class MemoryScoreStore implements ScoreStore {
  private entries: ScoreEntry[] = [];

  async add(
    entry: ScoreEntry,
    higherIsBetter = true,
  ): Promise<{ isBest: boolean; best: ScoreEntry }> {
    assertValidEntry(entry);
    const before = this.forSport(entry.sportId);
    const previous = before.length > 0 ? before[bestIndex(before, higherIsBetter)] : null;
    const isBest = previous === null || beats(entry.score, previous.score, higherIsBetter);

    this.entries.push(cloneEntry(entry));
    const list = this.forSport(entry.sportId);
    const best = bestIndex(list, higherIsBetter);
    const drop = new Set(indicesToPrune(list, best, MAX_ENTRIES_PER_SPORT).map((i) => list[i]));
    this.entries = this.entries.filter((e) => !drop.has(e));
    return { isBest, best: cloneEntry(list[best]) };
  }

  async best(sportId: string, higherIsBetter = true): Promise<ScoreEntry | null> {
    const list = this.forSport(sportId);
    return list.length > 0 ? cloneEntry(list[bestIndex(list, higherIsBetter)]) : null;
  }

  async history(sportId: string, limit = DEFAULT_HISTORY_LIMIT): Promise<ScoreEntry[]> {
    return this.forSport(sportId).reverse().slice(0, limit).map(cloneEntry);
  }

  async top(
    sportId: string,
    limit = DEFAULT_TOP_LIMIT,
    higherIsBetter = true,
  ): Promise<ScoreEntry[]> {
    return rankedTop(this.forSport(sportId), limit, higherIsBetter).map(cloneEntry);
  }

  async clear(sportId?: string): Promise<void> {
    this.entries = sportId === undefined ? [] : this.entries.filter((e) => e.sportId !== sportId);
  }

  /** Entries for one sport in insertion order (a new array). */
  private forSport(sportId: string): ScoreEntry[] {
    return this.entries.filter((e) => e.sportId === sportId);
  }
}
