import type { Side } from '../../input/types';
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
const HANDS_KEY = 'hs-player-hands';

export function defaultName(index: number): string {
  return `Player ${index + 1}`;
}

/** Control characters (C0, DEL, C1) and the bidirectional controls that can reorder what follows. */
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * The first `max` user-perceived characters of `value`: grapheme clusters when `Intl.Segmenter`
 * exists (so a joined emoji such as a family is kept whole or dropped whole), else code points.
 */
export function clipGraphemes(value: string, max: number): string {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter === undefined) {
    const chars = Array.from(value);
    return chars.length <= max ? value : chars.slice(0, max).join('');
  }
  let out = '';
  let n = 0;
  for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
    if (n++ >= max) break;
    out += part.segment;
  }
  return out;
}

/**
 * Trim, drop control and bidi-control characters, cap at NAME_MAX characters (grapheme clusters,
 * not UTF-16 units); an empty result becomes `fallback`.
 */
export function sanitiseName(raw: string, fallback: string): string {
  const cleaned = raw.replace(STRIPPED, '').trim();
  const name = clipGraphemes(cleaned, NAME_MAX).trim();
  return name === '' ? fallback : name;
}

/**
 * The names to show where seats must be told apart in words: a name shared by two or more seats
 * gets its colour name, e.g. "Mia (blue)". Unique names stay as typed. Comparison ignores case.
 */
export function displayNames(players: readonly PlayerInfo[]): string[] {
  const counts = new Map<string, number>();
  for (const p of players) {
    const key = p.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return players.map((p) =>
    (counts.get(p.name.toLowerCase()) ?? 0) > 1
      ? `${p.name} (${(PLAYER_COLOR_NAMES[p.index] ?? '').toLowerCase()})`
      : p.name,
  );
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

function isSide(v: unknown): v is Side {
  return v === 'left' || v === 'right';
}

/** The dominant hands last chosen on this device (mouse play), one per seat; null where unknown. */
export function loadLastHands(): (Side | null)[] {
  const out: (Side | null)[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) out.push(null);
  try {
    const raw = localStorage.getItem(HANDS_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return out;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v: unknown = parsed[i];
      if (isSide(v)) out[i] = v;
    }
  } catch {
    // Storage is optional; the default hand is fine.
  }
  return out;
}

/** Remember the chosen hands for next time. Never required to work. */
export function saveLastHands(hands: readonly (Side | null)[]): void {
  try {
    localStorage.setItem(HANDS_KEY, JSON.stringify(hands.slice(0, MAX_PLAYERS)));
  } catch {
    // Private mode or blocked storage: nothing to do.
  }
}

/** What each seat's hand starts with: the last one chosen for that seat, else `fallback`. */
export function prefillHands(count: number, fallback: Side): Side[] {
  const last = loadLastHands();
  const out: Side[] = [];
  for (let i = 0; i < count; i++) out.push(last[i] ?? fallback);
  return out;
}

/** `?hands=r,l,r` (or left/right) as a list; unknown entries become null so seats stay in place. */
export function parseHands(raw: string | null): (Side | null)[] | null {
  if (raw === null || raw === '') return null;
  return raw.split(',').map((v) => {
    const t = v.trim().toLowerCase();
    if (t === 'l' || t === 'left') return 'left';
    if (t === 'r' || t === 'right') return 'right';
    return null;
  });
}

/** `?names=Mia,Sam` as a list (empty entries are kept so seats stay in place). */
export function parseNames(raw: string | null): string[] | null {
  if (raw === null || raw === '') return null;
  return raw.split(',');
}
