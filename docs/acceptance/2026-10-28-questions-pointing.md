# Questions and slide pointing — 2026-10-28

## Production evidence

The learner question `トークンについて、黒板使って教えて` was accepted at 02:33 UTC in session `session.2e804e29-cfe7-4fff-a2ae-816c68262054`, but had `triage=later`, `resolution=pending`, `disposition=after-class`. The displayed scene was `scene-tools`; the last completed unit was `unit-llm`. No learner answer had been generated. This proves incorrect routing, but the old record does not distinguish an LLM decision from the former timeout/restart fallback.

The old classifier received only the current unit and course title. Both a classifier failure and Worker restart could turn a question into `later`. The new classifier includes course concepts, goals and unit captions, accepts prerequisite explanations at the next speech boundary, and preserves recognizable questions on classification failure/restart. An operator-only retry preserves the question ID and supporter count. Explicit blackboard requests require an illustrative example in generation and independent review.

After the first production deployment, retrying this exact question returned `immediate`, but it still had `after-class`: its remaining time was zero while the lecture was paused at `unit-http`. `getRemainingTimeMs` subtracted wall-clock time, including pauses. The follow-up fix freezes the clock during pauses, preserves it across checkpoints, and reconstructs existing pause intervals from session timing events once. Modern checkpoints do not replay history on each request.

Questions submitted while paused are held until resume. Frequent speech/progress events do not query the question store: the resume listener only considers questions on status transitions. The Worker alarm awaits outstanding classifier and supplement preparation work instead of leaving their lifetime solely to untracked callbacks.

## Pointing

The published Ollama material has no explicit PDF page regions. The former fallback could locate only a few authored labels verbatim. Runtime PDF extraction now retains actual text rectangles, joins adjacent text runs on the same baseline, and matches the current audio-aligned caption to those rectangles. It never invents coordinates. Synthetic visual rectangles are not sent as semantic question IDs. A stale image cannot provide pointing cues for a new slide.

Supplement speech without a stage command can use the same pointing path. Motion is restricted to located targets in speaking/pointing phases. Existing torso/neck speeds and garment clearance remain unchanged.

## Verification

- Full local suite: 108 files, 660 tests passed; relevant lint and server/classroom/Worker types passed.
- Local production build succeeded; CI additionally verifies deployment authentication, storage limits/restart behavior, public/private boundaries and authenticated operator rollout.
- Actual Ollama PDF plus published unit narration: a text-backed location was found for all 17 slide-bearing units (some share a PDF page). This is location coverage, not an assertion that all narration was played end to end. Some Japanese PDF text has an imperfect text mapping; Latin terms and intact words remain usable, and unmatched narration does not invent a target.
- Local Playwright with actual PDF and production classroom components: observed the teacher raise the arm toward slide content, including `ollama list` during speech with no stage command. Screenshots are in `output/lecture-debug-20261028/point-cli-list.png` and `point-during-answer-confirmed.png`.
- Regression coverage: classifier failure/restart, same-ID retry, paused question/resume, reviewed supplement recovery, split PDF command runs, no fabricated/out-of-page coordinates, long pauses and legacy checkpoint migration.

The user's live lesson remains paused at its existing position. No production playback/stage completion acknowledgements were simulated. Live audio and blackboard playback of the recovered question must not be claimed verified until the lesson resumes and is observed.

## Final production check — 03:08:49 UTC / 12:08:49 JST

- Deployed code: `e04c08e`; [deployment 40624754135](https://github.com/mani1261790/AITuber/actions/runs/40624754135) succeeded, including storage-budget/restart checks and authenticated rollout verification. An earlier follow-up run stopped before deployment on a strict optional-property typing error; the final revision fixes it and also passes the local production server build.
- Authenticated operator snapshot: HTTP 200, ChatGPT connected, same session still `PAUSED` at `unit-http`.
- Reconnected the existing diagnostic participant without creating another participant. The exact original learner question now has `triage=immediate`, `resolution=pending`, `disposition=answer-now`, remaining time `334604 ms`, reason `次の区切りで授業中に回答します。`. Supporter count remains one.
- Unauthenticated access to the operator retry endpoint returns HTTP 401.
- No lecture resume, new lesson, course publication or connection change was performed. Production answer playback remains unverified while the user keeps the lesson paused.
