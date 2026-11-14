import type { SportEntry } from '../core/sport';
import { meta as warmupMeta } from './warmup/meta';

/** Menu order. Real sports are appended here by later tasks: one import of the sport's meta and one line. */
export const SPORTS: readonly SportEntry[] = [];

/** Reachable only with ?sport=<id>; the menu shows it when SPORTS is empty. */
export const HIDDEN_SPORTS: readonly SportEntry[] = [
  { meta: warmupMeta, load: () => import('./warmup/index') },
];

/** Includes hidden entries (the warm-up) reachable only with ?sport=<id>. */
export function findSport(id: string): SportEntry | null {
  for (const entry of SPORTS) if (entry.meta.id === id) return entry;
  for (const entry of HIDDEN_SPORTS) if (entry.meta.id === id) return entry;
  return null;
}
