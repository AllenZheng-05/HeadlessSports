import type { LandmarkFrame, LandmarkSource, TrackerNeeds } from '../tracking/types';
import { inputConfig } from './config';
import type { InputConfig } from './config';
import { EventBus } from './EventBus';
import { FrameProcessor } from './FrameProcessor';
import { createDefaultRecognizers, recognizerConfig } from './recognizers';
import type { RecognizerConfig, Recognizer } from './recognizers';
import { createInputState } from './state';
import type {
  Calibration,
  GameEvent,
  GameEventOf,
  GameEventType,
  InputProvider,
  InputState,
  Unsubscribe,
} from './types';

export interface TrackedInputOptions {
  /** Default: `createDefaultRecognizers(recognizerConfig)`. */
  recognizers?: Recognizer[];
  inputConfig?: InputConfig;
  recognizerConfig?: RecognizerConfig;
}

/**
 * Landmark source -> FrameProcessor (filters, kinematics, fist state) -> recognizers -> events.
 * Events are queued while frames arrive and delivered by `update`, in timestamp order, so
 * handlers never run inside a camera callback.
 */
export class TrackedInput implements InputProvider {
  readonly state: InputState = createInputState();
  readonly source: LandmarkSource;
  private readonly processor: FrameProcessor;
  private readonly bus = new EventBus();
  private readonly recognizers: Recognizer[];
  private readonly emit = (event: GameEvent): void => this.bus.push(event);
  private readonly onFrame = (frame: LandmarkFrame): void => this.handleFrame(frame);
  private unsubscribe: (() => void) | null = null;
  private calibrated = false;
  /** Null until the body has been tracked once; TrackingFound only follows a TrackingLost. */
  private lastTracking: boolean | null = null;
  private lastFrameT = Number.NEGATIVE_INFINITY;
  private frames = 0;

  constructor(source: LandmarkSource, options: TrackedInputOptions = {}) {
    this.source = source;
    this.processor = new FrameProcessor(this.state, options.inputConfig ?? inputConfig);
    this.recognizers =
      options.recognizers ?? createDefaultRecognizers(options.recognizerConfig ?? recognizerConfig);
  }

  get frameCount(): number {
    return this.frames;
  }

  start(needs: TrackerNeeds): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = this.source.subscribe(this.onFrame);
    return this.source.start(needs);
  }

  setNeeds(needs: TrackerNeeds): Promise<void> {
    this.resetRecognizers();
    return this.source.setNeeds(needs);
  }

  setCalibration(calibration: Calibration | null): void {
    this.processor.setCalibration(calibration);
    this.calibrated = calibration !== null;
    for (const r of this.recognizers) r.setCalibrated?.(this.calibrated);
  }

  applyConfig(): void {
    this.processor.applyConfig();
  }

  update(nowMs: number): void {
    this.source.pump(nowMs);
    this.processor.tick(nowMs);
    this.checkTracking(nowMs);
    this.bus.flush();
  }

  on<T extends GameEventType>(type: T, handler: (event: GameEventOf<T>) => void): Unsubscribe {
    return this.bus.on(type, handler);
  }

  onAny(handler: (event: GameEvent) => void): Unsubscribe {
    return this.bus.onAny(handler);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.source.stop();
    this.bus.clear();
  }

  private handleFrame(frame: LandmarkFrame): void {
    const state = this.state;
    if (frame.t < this.lastFrameT) this.resetRecognizers(); // the clock restarted (clip loop)
    const changes = this.processor.process(frame);
    if (state.t === this.lastFrameT && changes === 0) return; // duplicate timestamp, ignored
    this.lastFrameT = state.t;
    this.frames++;
    for (let i = 0; i < changes; i++) {
      const c = this.processor.fistChange(i);
      this.bus.push({ type: c.closed ? 'FistClosed' : 'FistOpened', t: c.t, hand: c.hand });
    }
    this.checkTracking(state.t);
    if (!state.tracking || !state.hasPose) {
      this.resetRecognizersNeedingPose();
    }
    for (const r of this.recognizers) {
      if (r.needsPose !== false && !(state.hasPose && state.tracking)) continue;
      if (r.needsPose === false && !state.tracking) continue;
      r.update(state, this.emit);
    }
  }

  private checkTracking(t: number): void {
    const tracking = this.state.tracking;
    if (tracking === this.lastTracking) return;
    if (this.lastTracking === null) {
      if (tracking) this.lastTracking = true;
      return;
    }
    this.lastTracking = tracking;
    this.bus.push({ type: tracking ? 'TrackingFound' : 'TrackingLost', t });
    if (!tracking) this.resetRecognizers();
  }

  private resetRecognizers(): void {
    for (const r of this.recognizers) r.reset();
    this.state.cadence.stepsPerSecond = 0;
    this.state.cadence.amplitude = 0;
  }

  private resetRecognizersNeedingPose(): void {
    for (const r of this.recognizers) if (r.needsPose !== false) r.reset();
    this.state.cadence.stepsPerSecond = 0;
    this.state.cadence.amplitude = 0;
  }
}
