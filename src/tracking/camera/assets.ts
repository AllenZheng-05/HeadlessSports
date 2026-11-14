import { MEDIAPIPE_VERSION } from '../../core/version';

function base(): string {
  const b = import.meta.env.BASE_URL;
  return b.endsWith('/') ? b : `${b}/`;
}

/** Absolute URL (so workers resolve it the same way) of the self-hosted WASM directory. */
export function wasmBaseUrl(): string {
  return new URL(`${base()}wasm/tasks-vision-${MEDIAPIPE_VERSION}/`, location.href).href;
}

export function modelBaseUrl(): string {
  return new URL(`${base()}models/`, location.href).href;
}

export const POSE_MODEL_FILES = {
  lite: 'pose_landmarker_lite.task',
  full: 'pose_landmarker_full.task',
} as const;

export const HAND_MODEL_FILE = 'hand_landmarker.task';

export interface WasmPaths {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}

/**
 * In a module worker `importScripts` throws a TypeError, so MediaPipe falls back to `import()`.
 * That needs the ES-module build of the loader (`vision_wasm_module_internal.js`, which sets
 * globalThis.ModuleFactory and has a default export). On the main thread MediaPipe injects a
 * classic <script>, which needs the classic loader instead.
 */
export function wasmPaths(wasmBase: string, inModuleWorker: boolean): WasmPaths {
  const stem = inModuleWorker ? 'vision_wasm_module_internal' : 'vision_wasm_internal';
  return { wasmLoaderPath: `${wasmBase}${stem}.js`, wasmBinaryPath: `${wasmBase}${stem}.wasm` };
}
