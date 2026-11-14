# Memory soak test

Run on 2026-11-14, Windows 11, headless Chromium with software rendering (SwiftShader), the
default settings (`SOAK_MINUTES=4`, `SOAK_TIMESCALE=2`). The whole run took 34 minutes.

## How to run

    pnpm test:soak

It builds the app into `dist-soak`, serves it on port 4230 and runs `e2e-soak/soak.spec.ts` with
one worker. Eight scenarios of 4 minutes each (rotation up to 8): each of the five sports on
repeat, rotation through all sports, the idle lobby, and the tracking pipeline on `/debug.html`
with Chromium's fake camera. Total about 35 minutes.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOAK_MINUTES` | 4 | Minutes per scenario. `1` gives a quick (about 10 minute) shake-out |
| `SOAK_TIMESCALE` | 2 | Game clock speed for the synthetic player |
| `SOAK_MAX_HEAP_MB_PER_MIN` | 8 | Fail threshold for the post-warm-up JS heap slope |

Raw samples and tables land in `e2e-soak/results/` (git-ignored). Samples are taken every 10 s and
at every round boundary, after a forced GC: `performance.memory`, CDP `Performance.getMetrics`
(heap, Nodes, JSEventListeners, Documents, LayoutCount), `Memory.getDOMCounters`, and the hook's
`frames` and `drawCalls`. Console and page errors fail a test. The rotation scenario uses the
in-page menu path (Menu, sport card, Start on the how-to screen) so sport-to-sport disposal
happens within one page lifetime.

## What it cannot measure

- GPU memory. Software rendering says nothing about real VRAM or the WebGL/WebGPU driver.
- three.js `renderer.info.memory` (geometries, textures): the app does not expose the renderer
  handle, so those columns are empty.
- The tracking worker's heap (only the page's heap is sampled). The fake camera has no person,
  so pose is almost never detected (1 of 514 frames) and hand crops barely run; inference was
  about 350 to 400 ms per frame in software, so this exercises the GPU-delegate path only lightly.
- Long-session effects beyond 4 minutes per scenario.

## Results (4 minutes per scenario)

`performance.memory` heap (includes ArrayBuffer backing stores) versus the CDP JS heap (V8 heap
only). Per-round figures are from the second to the last round boundary.

| Scenario | Rounds | Heap slope MB/min | Heap growth per round | CDP heap per round | DOM nodes / listeners | Draw calls | Verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| climbing | 11 | 1.46 | 0.68 MB | 0.26 MB | flat (143, 42) | flat 23 | grows slowly |
| bowling | 5 | 1.14 | 1.06 MB | 0.33 MB | flat (162, 42) | flat 9 | grows slowly |
| batting | 19 | 4.71 | 1.00 MB | 0.34 MB | flat (nodes alternate 131/147, 42) | flat 32 to 34 | grows |
| archery | 25 | 9.43 | 1.57 MB | 0.24 MB | flat (127, 42) | flat 21 | grows, fails the 8 MB/min limit |
| javelin | 28 | 5.16 | 0.79 MB | 0.21 MB | flat (129, 42) | flat 7 | grows |
| rotation | 12 | 2.62 | 1.09 MB | 0.34 MB | flat (150, 42) | no growth | grows |
| idle lobby | 0 | 0.05 | n/a | n/a | flat (147, 49) | flat 18 | flat |
| tracking (debug page) | 0 | 0.04 | n/a | n/a | flat (483, 23) | n/a | flat |

Full tables are produced in `e2e-soak/results/summary.md` by every run.

Verdicts:

- **DOM nodes, listeners, documents, draw calls: flat in every scenario.** Listeners jump from
  28 to 42 after the first round (UI screens built once) and then stay constant. Node counts
  alternate between two values depending on the results screen, with no trend. The UI and
  scene-graph side of dispose and re-create is clean.
- **Idle lobby: flat.** 0.05 MB/min over 4 minutes.
- **Tracking pipeline: flat on the main thread** (0.04 MB/min, DOM and listeners constant). This
  is inconclusive about the GPU-delegate leak the architecture notes mention, because the worker
  heap and GPU memory are not visible here and the fake feed hardly triggers hand tracking.
  Check it on real hardware (below).
- **Every sport grows by roughly 0.7 to 1.6 MB per round** in `performance.memory`, of which
  only about 0.2 to 0.35 MB is ordinary V8 heap (also still rising, possibly the score history
  and warm-up, unproven). Most of it is ArrayBuffer backing stores. Archery is the worst
  (1.57 MB per round, 9.4 MB/min at the fast test speed) and trips the 8 MB/min threshold, so
  its test is marked `test.fail()` as a known defect.

## Suspected leak: per-round ArrayBuffers retained by three.js

Evidence (archery, two heap snapshots at round 4 and round 14, after forced GC; deleted
afterwards): total self-size grew 16.9 MB over 10 rounds, of which 14.0 MB is
`system / JSArrayBufferData` (+1070 buffers, +610 Float32Arrays). The largest retained buffers are
`Float32Array`s held in a `vertexBuffers` array of a minified three.js renderer object (the
render-object or node-builder-state kind), reachable from `Set` tables and from a `WeakMap`
keyed by a `lightsNode`. That is, the WebGPU renderer keeps the per-object vertex data for earlier
rounds' stages alive, and each round creates a new `Scene`, lights, ground, sky and avatar
(`src/core/shell/SportHost.ts` around line 232, `src/render/style/scene.ts` around line 135).

What is ruled out: the toon materials are shared singletons (`src/render/style/toon.ts:41`), and
`FieldDayScene.dispose()` does dispose the sky and ground geometries and the sky material. Not
shown: which exact object keeps the renderer entries alive (lights are not disposed and
`BlobShadow.dispose()`, `src/render/style/blobShadow.ts:82`, only detaches the mesh, so those are
the places to look first). This needs a retainer-path investigation with the renderer exposed, or
a test that calls `renderer.info.memory` before and after a round. Fix suggestion for whoever takes
it: confirm with `renderer.info.memory.geometries/textures` per round, then dispose every geometry,
material and light the stage created, and drop the stage's scene from the renderer's caches.

Impact: about 1 MB per round, so roughly 60 to 100 MB per hour at a round every one to two
minutes of real play. Not dramatic for a one-hour session, but a measurable steady climb.

## Check on real hardware

1. Open Chrome Task Manager (Shift+Esc), enable the "GPU memory" and "JavaScript memory" columns.
2. Run `/debug.html` with a real camera for 30 minutes, then one sport on repeat for 30 minutes,
   noting the tab's GPU memory and JS memory every 5 minutes.
3. Worrying: GPU memory rising steadily on the debug page (the MediaPipe GPU-delegate leak), JS
   memory climbing more than about 50 MB over 30 minutes, or frame time getting worse with time.
   A sawtooth that returns to the same floor is fine.
