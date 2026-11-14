export interface ScoreEntry {
  sportId: string;
  /** The number that is ranked. */
  score: number;
  /** ISO timestamp. */
  at: string;
  /** Small numeric summary of the round (release speed, angle, ...), for later server-side recompute. */
  detail?: Record<string, number>;
}

export interface ScoreStore {
  /** Save a finished round. Resolves with whether it is a new personal best. */
  add(entry: ScoreEntry, higherIsBetter?: boolean): Promise<{ isBest: boolean; best: ScoreEntry }>;
  /** Personal best for a sport, or null. */
  best(sportId: string, higherIsBetter?: boolean): Promise<ScoreEntry | null>;
  /** Most recent first, at most `limit` (default 20). */
  history(sportId: string, limit?: number): Promise<ScoreEntry[]>;
  /** Top scores, best first, at most `limit` (default 10). */
  top(sportId: string, limit?: number, higherIsBetter?: boolean): Promise<ScoreEntry[]>;
  clear(sportId?: string): Promise<void>;
}
