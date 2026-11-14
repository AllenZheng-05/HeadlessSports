import type { GameEvent, GameEventOf, GameEventType, Unsubscribe } from './types';

interface Entry {
  fn: (event: never) => void;
  active: boolean;
}

/**
 * Queue of gesture events. Recognizers `push` while frames are processed; the owner calls `flush`
 * once per rendered frame so handlers always run in one place, in timestamp order, never from
 * inside a camera callback.
 */
export class EventBus {
  private readonly byType = new Map<GameEventType, Entry[]>();
  private any: Entry[] = [];
  /** Sorted by t, stable for equal t. `cursor` is the next undelivered index during a flush. */
  private queue: GameEvent[] = [];
  private cursor = 0;
  private flushing = false;

  on<T extends GameEventType>(type: T, handler: (event: GameEventOf<T>) => void): Unsubscribe {
    const entry: Entry = { fn: handler as (event: never) => void, active: true };
    // Copy on write so a flush that is iterating the old array is unaffected.
    this.byType.set(type, [...(this.byType.get(type) ?? []), entry]);
    return () => {
      entry.active = false;
      const list = this.byType.get(type);
      if (list)
        this.byType.set(
          type,
          list.filter((e) => e !== entry),
        );
    };
  }

  onAny(handler: (event: GameEvent) => void): Unsubscribe {
    const entry: Entry = { fn: handler as (event: never) => void, active: true };
    this.any = [...this.any, entry];
    return () => {
      entry.active = false;
      this.any = this.any.filter((e) => e !== entry);
    };
  }

  /** Queue an event; nothing is called yet. */
  push(event: GameEvent): void {
    const q = this.queue;
    let i = q.length;
    const floor = this.flushing ? this.cursor : 0;
    while (i > floor && q[i - 1].t > event.t) i--;
    q.splice(i, 0, event);
  }

  /**
   * Deliver queued events in t order (stable), then clear. Handlers may push more events; those
   * are delivered in the same flush. Safe if a handler unsubscribes during delivery.
   */
  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    this.cursor = 0;
    try {
      while (this.cursor < this.queue.length) {
        const event = this.queue[this.cursor++];
        const list = this.byType.get(event.type);
        if (list) {
          for (const e of list) if (e.active) (e.fn as (ev: GameEvent) => void)(event);
        }
        for (const e of this.any) if (e.active) (e.fn as (ev: GameEvent) => void)(event);
      }
    } finally {
      this.queue.length = 0;
      this.cursor = 0;
      this.flushing = false;
    }
  }

  clear(): void {
    this.queue.length = 0;
    this.cursor = 0;
  }
}
