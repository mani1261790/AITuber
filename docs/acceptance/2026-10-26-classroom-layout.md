# Classroom layout verification

- Removed learner-facing supplement preparation/bridging banners and synchronization/provider status. Connection failures remain visible on desktop.
- Questions/comments and assessments share a side panel. A new assessment opens its panel; switching panels preserves the draft answer.
- Stage viewport stays independent of assessment content. Narrow screens stack the panel below it.
- Fullscreen API with viewport fallback; native fullscreen changes and Escape update the control.
- Replaced classroom wordmark typography and native target select with a disclosure of selectable targets.

## Local evidence

Typecheck, classroom build, ESLint passed. Speech captions/playback/audio and lesson texture tests: 4 files, 15 tests passed.
Chromium fixture-driven UI checks:
- 1440×900: stage before/after assessment = x16 y196.84375 width1003.203125 height564.296875.
- Radio selection preserved across question/exercise panel switches.
- Native fullscreen entered and exited by visible controls.
- Widths 375, 768, 1440 at height900: no horizontal document overflow.
- Screenshots: output/playwright/classroom-redesign-20261026 (local, untracked).

Fixtures use a previous session snapshot and local WebSocket responses. PDF source is not served by this fixture (502); this is layout verification, not a hosted lecture/audio or real-device acceptance run. Existing production lecture state is not mutated.
