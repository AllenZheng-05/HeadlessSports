/** Field Day palette. Values mirror docs/DESIGN.md. */
export const PALETTE = {
  sky: 0xbfe3f7,
  turf: 0x8fd694,
  turfLight: 0xa9e0ac,
  /** Blob shadows on turf. */
  turfShadow: 0x6fbf7a,
  chalk: 0xfbf8f1,
  /** The athlete's body. */
  putty: 0xf4f1ea,
  /** Player colour (mitts, feet). */
  whistle: 0xff7a59,
  ink: 0x27364a,
  /** Secondary text. */
  ink2: 0x4a5a70,
} as const;

/** One accent per venue. Batting uses a soft lavender (chosen: not used by any other venue). */
export const ACCENTS = {
  climbing: 0xf2a07b,
  bowling: 0xf0d29a,
  archery: 0xf6d55c,
  javelin: 0xe8785a,
  batting: 0xb8a6e6,
  /** Pitching: a soft sea teal, distinct from the other five accents and from the sky. */
  pitching: 0x5fc1b0,
} as const;
