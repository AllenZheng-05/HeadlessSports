# Sports

## Build order

1. **Rock climbing** (simplest pipeline; forces the input layer, fist classifier, calibration, HUD, scoring and high scores to exist)
2. **Bowling** (pose plus hand crops, the throw recognizer, Rapier, the signature nostalgia game)
3. **Baseball batting** (swing-onset timing, latency compensation; pose only)
4. **Archery** (very robust, seated-friendly, reuses hand crops)
5. **Javelin** (most complex: cadence, throw and foul line; built once the recognizers are proven)

Baseball pitching follows javelin, reusing its throw recognizer.

## Rock climbing

- Original idea (Allen): climbing with two hands only. An open or closed hand decides whether the character is holding the wall. A vertical scroller with holds along the wall; climb as high as you can; the high score is height.
- Tracking: Hand Landmarker on the full frame, two hands, player about 0.7 to 1.2 m from the camera. No pose model.
- Controls: each hand is a cursor on the wall. Closing a hand over a hold grabs it. **Pulling a closed hand downward raises the climber**, so the motion feels like climbing. At least one hand must be holding or the climber slips; a stamina bar drains while hanging.
- Depth: hold types (big jugs are forgiving, small crimps need the fist held firmly), rest ledges every 20 m or so, later hazards such as wind or falling rocks.
- Risks: fist flicker (hysteresis and the 2 to 3 frame hold), hands leaving the top of the frame, arm fatigue (rest ledges, short rounds).

## Bowling

- Original idea (Allen): like Wii Sports bowling. Clench a fist to hold the ball, wind back, swing forward, open the hand to release; the game reads the angle and shows the ball and the whole round.
- Tracking: pose throughout; hand crops only for the grab.
- Controls: stand still and close a fist to pick up the ball. Step or lean left and right to position. Swing back and forward; **release is the wrist-speed peak of the forward swing**. Ball speed from normalised wrist speed, aim from the wrist's lateral offset at release, spin from path curvature or a pre-throw fist tilt.
- Physics: Rapier for ball and ten pins. Pins as convex hulls or capsule-plus-cylinder compounds, continuous collision detection on the ball, fixed timestep with substeps. Full ten-frame scoring.

## Baseball batting

- Tracking: pose only.
- Controls: both wrists together is the grip. Judge the **start of the swing and the predicted bat path** against the ball's arrival, with a sweet window of about plus or minus 60 to 100 ms. Wrist height at swing start sets the bat height, giving grounder, line drive or fly ball.
- Fairness: show the pitcher's wind-up clearly and use slower pitches on the easy difficulty.

## Archery

- Tracking: pose plus a hand crop on the draw hand.
- Controls: extend the bow arm toward the screen, close the draw hand near it, pull back toward the cheek (draw distance is power), aim with the bow arm's 2D position, **open the hand to release**. This is the one release that can use hand state, because the hand is nearly still.
- Works seated.

## Javelin

- Original idea (Allen): start by clenching a fist above your head. Run in place; the game detects knee lifts and the athlete runs toward the line. Throw before crossing the line, or it's a foul. Distance depends on run speed, throw speed and release timing; try to beat your best.
- Tracking: pose; hand crop only for the start gesture.
- Phases: (1) start with the fist above the head (accept both arms raised as an alternative); (2) run-up speed from **knee-lift cadence and amplitude** (alternating knee height against hip height), with a soft cap; (3) cock the arm back (wrist behind and above the shoulder); (4) throw, with release at the wrist-speed peak plus elbow extension, loft from the 2D release path angle.
- Scoring: distance is a function of run speed, release speed, how far the angle is from about 35 degrees, and a bonus for releasing close to the line. Releasing after the line is a foul. Show a large "foul line approaching" meter.
- Risks: knees leaving the frame, the player drifting toward the camera while running in place, hand state unusable during the sprint (so never rely on it after the start gesture).

## Baseball pitching

- Tracking: pose; hand crop for pitch selection.
- Controls: choose the pitch type with a slow hand sign before the motion. Wind up, accelerate, release at the wrist-speed peak. Aim from release position relative to the shoulder toward a catcher's-mitt target grid with a forgiving cone. Cap the effort that scores so nobody strains a shoulder.

## Backlog

| Sport | Control scheme (one line) |
|---|---|
| Boxing and target punching | Pose; `Punch {hand, speed}` on each wrist, targets scored by which hand fires and its speed |
| Darts | Pose; small forward throw, release at wrist-speed peak, aim from wrist x/y at release |
| Soccer goalkeeper | Pose; `Lean {angle}` and `Jump` to dive or leap, arm raise to block |
| Basketball free throws | Pose; `ThrowReleased` at wrist-speed peak, aim from wrist x at release, loft from 2D path angle |
| Golf (putting first, then drives) | Pose; `SwingStarted`/`SwingPeak` on the club hand, aim from wrist x at release, power from peak speed |
| Ski slalom by leaning | Pose; `Lean {angle}` steers, `Squat` to tuck |
| Ski jump | Pose; `Jump` at takeoff, `Lean {angle}` in flight to set the glide |
| Volleyball serve | Pose; `ThrowReleased` for the toss, `SwingPeak` for the hit |
| Skeet shooting | Pose; aim from the arm's 2D position, fire with a `Punch {hand, speed}` thrust |
| Axe throwing, horseshoes, cornhole and frisbee | Pose; the existing `ThrowReleased {t, speed, direction, loft}` throw recognizer, released at wrist-speed peak |
| Shot put | Pose; `ThrowReleased` at wrist-speed peak, loft from 2D path angle, start from shoulder height |
| 100 m sprint and hurdles | Pose; `KneeLiftCadence {stepsPerSecond, amplitude}` for speed, `Jump` over hurdles |
| Long and high jump | Pose; `KneeLiftCadence` for the run-up, `Jump` at takeoff |
| Rowing and kayaking | Pose; alternating `SwingPeak` events from each arm set the stroke rate, `Lean {angle}` steers |
| Curling | Pose; `ThrowReleased` for release speed and direction, sweeping from repeated `SwingPeak` events |
| Weightlifting (bodyweight only) | Pose; `Squat` starts the lift, `ArmRaisedAboveHead` completes it |
| Football quarterback passing | Pose; `ThrowReleased` at wrist-speed peak, aim from wrist x at release |
| Hockey shootout | Pose; `SwingStarted`/`SwingPeak` for the shot, `Lean {angle}` to aim |
| Dodge-only dodgeball | Pose; `Lean {angle}` and `Jump` to dodge |
| Fishing | Pose; `ThrowReleased` for the cast, `HandHold {closed}` to reel with a fist |
| Surfing or skateboard balance | Pose; `Lean {angle}` for balance and turns, `Squat` to crouch |
| Dance and rhythm | Pose; `KneeLiftCadence` and `Punch`/`SwingPeak` events matched to beat timing |

**Poor fits, do not build:** swimming, fencing, pool or billiards, precision jump-rope counting, speed skating, tennis or table-tennis rallies (a serve-only game is fine), real spinning for hammer throw, and anything needing two simultaneous players on one camera (hot-seat turns are fine).
