import type { AudioKit, SoundName } from '../core/sport';

type Ctor = typeof AudioContext;

function contextCtor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export interface UiAudio extends AudioKit {
  /** Create the AudioContext now (the first user gesture does this automatically). */
  unlock(): void;
  dispose(): void;
}

/** Original, short, soft sounds made with WebAudio only. Silent until the first user gesture. */
export function createAudioKit(): UiAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;

  function unlock(): void {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      return;
    }
    const Ctx = contextCtor();
    if (!Ctx) return;
    try {
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    } catch {
      ctx = null;
      master = null;
    }
  }

  const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
  const onGesture = (): void => unlock();
  if (typeof document !== 'undefined') {
    for (const type of gestureEvents) document.addEventListener(type, onGesture, { passive: true });
  }

  function tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    at: number,
    dur: number,
    vol: number,
  ): void {
    if (!ctx || !master) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function burst(
    kind: BiquadFilterType,
    f0: number,
    f1: number,
    at: number,
    dur: number,
    vol: number,
    q = 1,
  ): void {
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = kind;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, 0, dur + 0.05);
  }

  function play(name: SoundName, options?: { pitch?: number; volume?: number }): void {
    if (!ctx || !master || muted) return;
    const p = options?.pitch ?? 1;
    const v = Math.max(0, Math.min(1, options?.volume ?? 1));
    if (v === 0) return;
    switch (name) {
      case 'select':
        tone('sine', 620 * p, 880 * p, 0, 0.11, 0.3 * v);
        break;
      case 'tick':
        tone('triangle', 1300 * p, 1300 * p, 0, 0.035, 0.12 * v);
        break;
      case 'grab':
        tone('triangle', 330 * p, 460 * p, 0, 0.07, 0.25 * v);
        break;
      case 'release':
        tone('triangle', 460 * p, 300 * p, 0, 0.08, 0.22 * v);
        break;
      case 'whoosh':
        burst('bandpass', 400 * p, 1800 * p, 0, 0.24, 0.35 * v, 0.8);
        break;
      case 'thud':
        tone('sine', 130 * p, 48 * p, 0, 0.18, 0.5 * v);
        burst('lowpass', 500 * p, 150 * p, 0, 0.1, 0.25 * v);
        break;
      case 'clatter':
        for (let i = 0; i < 5; i++) {
          burst('highpass', (2200 + i * 340) * p, 3500 * p, i * 0.045, 0.06, 0.22 * v, 2);
        }
        tone('triangle', 520 * p, 380 * p, 0.02, 0.1, 0.1 * v);
        break;
      case 'good':
        tone('triangle', 660 * p, 660 * p, 0, 0.12, 0.28 * v);
        tone('triangle', 880 * p, 880 * p, 0.09, 0.18, 0.28 * v);
        break;
      case 'great':
        tone('sine', 523 * p, 523 * p, 0, 0.12, 0.28 * v);
        tone('sine', 659 * p, 659 * p, 0.08, 0.12, 0.28 * v);
        tone('triangle', 784 * p, 784 * p, 0.16, 0.26, 0.3 * v);
        break;
      case 'bad':
        tone('triangle', 220 * p, 150 * p, 0, 0.26, 0.26 * v);
        break;
      case 'cheer':
        tone('sine', 523 * p, 523 * p, 0, 0.14, 0.26 * v);
        tone('sine', 659 * p, 659 * p, 0.09, 0.14, 0.26 * v);
        tone('sine', 784 * p, 784 * p, 0.18, 0.14, 0.26 * v);
        tone('triangle', 1047 * p, 1047 * p, 0.27, 0.34, 0.3 * v);
        burst('bandpass', 3000 * p, 5000 * p, 0.1, 0.5, 0.08 * v, 0.6);
        break;
    }
  }

  return {
    play,
    unlock,
    setMuted(m: boolean): void {
      muted = m;
    },
    dispose(): void {
      if (typeof document !== 'undefined') {
        for (const type of gestureEvents) document.removeEventListener(type, onGesture);
      }
      if (ctx) void ctx.close().catch(() => undefined);
      ctx = null;
      master = null;
    },
  };
}
