// Dedicated tracking worker (module worker). See CameraLandmarkSource for the main-thread side.
import { TrackerCore } from './trackerCore';
import type { FromWorker, ResultMsg, ToWorker } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  postMessage(message: FromWorker): void;
  close(): void;
}
const scope = self as unknown as WorkerScope;

let core: TrackerCore | null = null;

// Reused for every frame so the steady-state path allocates nothing of its own.
const result: ResultMsg = {
  type: 'result',
  ok: true,
  buffer: new Float32Array(0),
  dbgLeft: null,
  dbgRight: null,
};
const transferOne: Transferable[] = [result.buffer.buffer];

// Needs changes run strictly one at a time, each reply posted before the next change starts.
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task, task);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

scope.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      const next = new TrackerCore(msg.options, true);
      next.debug = msg.debug;
      core = next;
      enqueue(() =>
        next.setNeeds(msg.needs).then(
          () => scope.postMessage({ type: 'ready', delegate: next.delegate }),
          (err: unknown) =>
            scope.postMessage({ type: 'error', phase: 'init', message: errMessage(err) }),
        ),
      );
      break;
    }
    case 'needs': {
      const target = core;
      if (!target) break;
      enqueue(() =>
        target.setNeeds(msg.needs).then(
          () => scope.postMessage({ type: 'needs-ready', delegate: target.delegate }),
          (err: unknown) =>
            scope.postMessage({ type: 'error', phase: 'needs', message: errMessage(err) }),
        ),
      );
      break;
    }
    case 'debug': {
      if (core) core.debug = msg.enabled;
      break;
    }
    case 'frame': {
      const buffer = msg.buffer;
      let ok = true;
      try {
        if (core) core.process(msg.bitmap, msg.t, buffer);
        else ok = false;
      } catch (err) {
        ok = false;
        scope.postMessage({ type: 'error', phase: 'frame', message: errMessage(err) });
      }
      msg.bitmap.close();
      result.ok = ok;
      result.buffer = buffer;
      const dl = core?.debug ? core.debugCrops[0] : null;
      const dr = core?.debug ? core.debugCrops[1] : null;
      result.dbgLeft = dl;
      result.dbgRight = dr;
      if (dl || dr) {
        // Debug only: allocation is fine here.
        const list: Transferable[] = [buffer.buffer];
        if (dl) list.push(dl);
        if (dr) list.push(dr);
        scope.postMessage(result, list);
      } else {
        transferOne[0] = buffer.buffer;
        scope.postMessage(result, transferOne);
      }
      break;
    }
    case 'stop': {
      core?.close();
      core = null;
      scope.close();
      break;
    }
  }
};
