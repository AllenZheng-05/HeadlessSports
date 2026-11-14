# Tracking and input

## The central rule

**Fast actions are detected from arm kinematics; hand state is only used for slow, deliberate moments.** At full-body distance (about 2 to 2.5 m from a laptop camera) a hand is only 30 to 50 px tall, and hand models fail under motion blur. So a fist or open hand is a "grab", "hold" or "confirm" gesture made while roughly still. Throw releases, swings and punches are recognised from wrist speed, elbow extension and trajectory shape, never from the hand opening mid-motion.

Original idea (Allen): "open your fist to release" for bowling and javelin. Keep that as the feel of the game (the avatar's hand opens at release, and an actually detected open hand can be a small bonus signal), but the release trigger itself is the wrist-speed peak.

## Pipeline

1. Capture camera at 1280x720, 30 fps, mirrored for display.
2. **Pose Landmarker lite on every frame**, fed a downscaled frame (about 640x360). It gives 33 landmarks in 2D plus 3D "world" coordinates.
3. **Hand state via wrist crops ("body pre-focusing"), only when the sport phase needs it.** For each wrist, cut a square from the full-resolution frame, centred slightly beyond the wrist along the elbow-to-wrist direction, with side about 1.5 to 2 times the forearm length in pixels. Resize to about 224 to 256 px and run Hand Landmarker in IMAGE mode on the crop.
4. **Our own fist/open classifier** on the 21 hand landmarks: per-finger curl is fingertip-to-wrist distance divided by palm size (wrist to middle-finger knuckle). Ignore the thumb. Use hysteresis (start with closed below 0.9, open above 1.3) and require the state to hold for 2 to 3 frames.
5. When a crop fails, keep the last known hand state and show a "show me your hand" hint. Never guess.
6. Climbing is the exception: the player is close to the camera (about 0.7 to 1.2 m), so it runs Hand Landmarker on the full frame with two hands and no pose model.
7. Each sport declares which trackers it needs; the worker loads only those and closes the rest on sport switch to free GPU memory.

## Signal handling

- **Timestamps come from the camera clock** (`requestVideoFrameCallback` metadata or `VideoFrame.timestamp`), not `performance.now()` at inference time. Pass them to MediaPipe and to the filters. A filter fed a stalled clock freezes.
- **One Euro filter** on every landmark axis, tuned per use: responsive for wrists used in throws, smoother for torso and hips used for aim. Starting point: `minCutoff` 1.0 Hz, `beta` tuned by feel.
- **Velocities** come from a least-squares slope over 3 to 5 filtered samples, not frame-to-frame differences, and are **normalised by shoulder width** so they don't depend on body size or camera distance.
- **Zero the visibility of landmarks outside the image.** MediaPipe reports off-screen legs as confidently visible.
- **Fast actions are state machines over 150 to 400 ms** (wind-up, acceleration, peak), not single-frame checks. The release instant is the **peak of wrist speed or elbow-extension rate**, found one or two frames after the fact; timestamp the release at the peak and resolve the outcome from that time. The follow-through animation hides the 33 to 66 ms delay.
- **Latency:** expect about 70 to 130 ms camera-to-screen. During fast phases only, render the avatar one or two frames ahead with clamped constant-velocity extrapolation. Use generous timing windows and immediate visual feedback.
- **Depth is unreliable.** Treat world-z as a coarse hint only. Aim comes from the wrist's 2D x relative to the shoulder midline at release; loft from the 2D wrist path angle; forward power from the upward-and-forward 2D arc (wrist rising, elbow extending). The player faces the camera, so throws travel "into the screen", the axis the model measures worst. Never score on world-z.
- **Spin** (bowling) comes from the curvature of the wrist's 2D path in the last 150 ms before release, or from an explicit slow pre-throw gesture (tilting the closed fist), not forearm rotation.

## Recognizer library (shared across sports)

Build recognizers as small, independently testable state machines that emit typed events: `FistClosed`/`FistOpened` per hand, `HandHold {x, y, closed}`, `ArmRaisedAboveHead`, `KneeLiftCadence {stepsPerSecond, amplitude}`, `ThrowReleased {t, speed, direction, loft}`, `SwingStarted`/`SwingPeak {t, speed, plane}`, `Punch {hand, speed}`, `Lean {angle}`, `Squat`, `Jump`. Sports compose these; they do not read raw landmarks for gesture logic.

## The webcam problem

Nobody in this session can stand in front of a camera, and Allen can't do so either at this stage. Gesture recognition can only really be validated by Allen playing, so build the game so that everything else can be verified without a person:

- **A swappable landmark source.** The input layer consumes landmarks through one interface with three implementations: the real tracking worker, a **replayer** for recorded JSON landmark streams, and a **synthetic player** that generates scripted landmark sequences (for example "grab and pull ten holds", "bowl one straight ball", "run up and throw"). Write the synthetic sequences as plausible human motion with realistic timing and some noise, at 30 Hz.
- **A debug input mode** (`?input=debug`) that maps keyboard and mouse to the same gesture events the recognizers emit, so every sport is playable with no camera at all. It also helps Allen.
- **A landmark recorder**, so that Allen can record clips of each move. Recognizer tests run against the synthetic sequences for now; mark them as placeholders to be replaced by Allen's recordings.
- **A debug page** with the camera feed, skeleton overlay, hand crops, recognizer state, and a HUD showing inference time, tracking rate, render frame rate and estimated end-to-end latency.
- **Headless browser checks with Playwright.** Launch Chromium with a fake camera (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`) to confirm the camera, worker and model pipeline starts and runs without errors; the fake feed contains no person, so expect zero detections. Then drive each sport end to end with the synthetic player, assert on the outcome (a score is recorded, a round completes), fail on console errors, and save screenshots. Look at the screenshots to check the scene against the Field Day theme.
- **Every tunable in one place.** Each sport keeps its thresholds, timing windows and scoring constants in a single typed config object, editable live from a debug panel, so Allen's tuning pass is quick.
- **Playtest checklists** for everything that still needs a real camera go in the morning report.
