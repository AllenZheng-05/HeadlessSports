import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './EventBus';
import type { GameEvent } from './types';

const fist = (t: number, hand: 'left' | 'right' = 'left'): GameEvent => ({
  type: 'FistClosed',
  t,
  hand,
});

describe('EventBus', () => {
  it('calls nothing until flush', () => {
    const bus = new EventBus();
    const h = vi.fn();
    bus.on('FistClosed', h);
    bus.push(fist(1));
    expect(h).not.toHaveBeenCalled();
    bus.flush();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('delivers in t order, stable for equal t', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onAny((e) => seen.push(`${e.t}${e.type === 'FistClosed' ? e.hand[0] : '?'}`));
    bus.push(fist(30, 'left'));
    bus.push(fist(10, 'left'));
    bus.push(fist(20, 'right'));
    bus.push(fist(20, 'left'));
    bus.push(fist(10, 'right'));
    bus.flush();
    expect(seen).toEqual(['10l', '10r', '20r', '20l', '30l']);
  });

  it('delivers only matching types to typed handlers, typed', () => {
    const bus = new EventBus();
    const got: number[] = [];
    bus.on('Jump', (e) => got.push(e.height));
    bus.push(fist(1));
    bus.push({ type: 'Jump', t: 2, height: 0.5 });
    bus.flush();
    expect(got).toEqual([0.5]);
  });

  it('clears the queue after a flush', () => {
    const bus = new EventBus();
    const h = vi.fn();
    bus.onAny(h);
    bus.push(fist(1));
    bus.flush();
    bus.flush();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('clear drops queued events', () => {
    const bus = new EventBus();
    const h = vi.fn();
    bus.onAny(h);
    bus.push(fist(1));
    bus.clear();
    bus.flush();
    expect(h).not.toHaveBeenCalled();
  });

  it('is safe when a handler unsubscribes during delivery', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    let offB: () => void = () => undefined;
    bus.on('FistClosed', () => {
      calls.push('a');
      offB();
    });
    offB = bus.on('FistClosed', () => calls.push('b'));
    bus.on('FistClosed', () => calls.push('c'));
    bus.push(fist(1));
    bus.push(fist(2));
    bus.flush();
    // b was unsubscribed by a before it ran for the first event, and never ran at all.
    expect(calls).toEqual(['a', 'c', 'a', 'c']);
  });

  it('unsubscribe stops later deliveries', () => {
    const bus = new EventBus();
    const h = vi.fn();
    const off = bus.onAny(h);
    off();
    bus.push(fist(1));
    bus.flush();
    expect(h).not.toHaveBeenCalled();
  });

  it('delivers events pushed by handlers in the same flush, in order', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.on('FistClosed', (e) => {
      seen.push(e.t);
      if (e.t === 10) {
        bus.push(fist(15)); // before the queued 20
        bus.push(fist(5)); // earlier than the one being handled: delivered next
      }
    });
    bus.push(fist(10));
    bus.push(fist(20));
    bus.flush();
    expect(seen).toEqual([10, 5, 15, 20]);
    bus.flush();
    expect(seen).toHaveLength(4);
  });
});
