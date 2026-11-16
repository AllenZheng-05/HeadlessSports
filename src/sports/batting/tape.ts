/**
 * Pass-and-play fairness: every seat faces the same pitches. The first seat's round draws from the
 * seeded source through `recorder`, which writes each draw down; later seats' rounds read the same
 * draws back through `replayer`, in the same order. Every seat's round is the same state machine
 * fed the same numbers, so pitch n (height, wobble, the set's length) is identical for all, and the
 * seeded source is touched only by the first seat: the draw count does not depend on the seat count.
 */
export class DrawTape {
  private vals = new Float64Array(64);
  private len = 0;

  /** Draws recorded so far. */
  get length(): number {
    return this.len;
  }

  /** A random source that draws from `source` and records every value. */
  recorder(source: () => number): () => number {
    return () => {
      const v = source();
      if (this.len === this.vals.length) {
        const bigger = new Float64Array(this.vals.length * 2);
        bigger.set(this.vals);
        this.vals = bigger;
      }
      this.vals[this.len++] = v;
      return v;
    };
  }

  /** A random source that plays the recorded values from the start; past the end it uses `source`. */
  replayer(source: () => number): () => number {
    let i = 0;
    return () => (i < this.len ? this.vals[i++]! : source());
  }
}
