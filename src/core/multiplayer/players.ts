import type { PlayerInfo } from '../sport';

/** Most seats any sport can offer. */
export const MAX_PLAYERS = 4;
/** Longest player name, in characters. */
export const NAME_MAX = 12;

/**
 * The four player colours: the Field Day coral (whistle), a deeper sky blue, the archery sun yellow
 * and the batting lavender. Orange, blue, yellow and violet stay apart for the common kinds of
 * colour blindness, and all four read on every venue (names and ranks also carry the identity).
 */
export const PLAYER_COLORS: readonly number[] = [0xff7a59, 0x5aa9e6, 0xf6d55c, 0xb8a6e6];

/** Plain-language colour names, shown beside each field so the colour is never the only cue. */
export const PLAYER_COLOR_NAMES: readonly string[] = ['Coral', 'Blue', 'Sunny', 'Lavender'];

const STORAGE_KEY = 'hs-player-names';

export function defaultName(index: number): string {
  return `Player ${index + 1}`;
}

/** Trim, drop control characters, cap at NAME_MAX characters; an empty result becomes `fallback`. */
export function sanitiseName(raw: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const name = Array.from(cleaned).slice(0, NAME_MAX).join('').trim();
  return name === '' ? fallback : name;
}

/** Clamp a requested player count to 1..max (1 for anything that is not a number). */
export function clampPlayers(count: number, max: number = MAX_PLAYERS): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(max, Math.floor(count)));
}

/** Seats for `count` players from whatever names were given; missing or empty names use defaults. */
export function makePlayers(names: readonly string[], count: number): PlayerInfo[] {
  const players: PlayerInfo[] = [];
  const n = clampPlayers(count);
  for (let i = 0; i < n; i++) {
    players.push({
      index: i,
      name: sanitiseName(names[i] ?? '', defaultName(i)),
      color: PLAYER_COLORS[i] ?? PLAYER_COLORS[0]!,
    });
  }
  return players;
}

/** The names last used on this device, or empty strings. Storage may be missing or blocked. */
export function loadLastNames(): string[] {
  const out: string[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) out.push('');
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return out;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v: unknown = parsed[i];
      if (typeof v === 'string') out[i] = sanitiseName(v, '');
    }
  } catch {
    // Storage is optional; the defaults are fine.
  }
  return out;
}

/** Remember the typed names for next time. Never required to work. */
export function saveLastNames(names: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names.slice(0, MAX_PLAYERS)));
  } catch {
    // Private mode or blocked storage: nothing to do.
  }
}

/** What each field starts with: the last name used for that seat, else "Player n". */
export function prefillNames(count: number): string[] {
  const last = loadLastNames();
  const out: string[] = [];
  for (let i = 0; i < count; i++)
    out.push(last[i] !== '' && last[i] !== undefined ? last[i]! : defaultName(i));
  return out;
}

/** `?names=Mia,Sam` as a list (empty entries are kept so seats stay in place). */
export function parseNames(raw: string | null): string[] | null {
  if (raw === null || raw === '') return null;
  return raw.split(',');
}
