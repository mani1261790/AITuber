# Lecture positioning and camera — 2026-10-28

## Findings and changes

- The whole-lecture prompt explicitly defaulted every unit to the right. Existing Ollama performance beats were consequently all on the right. Generation now plans audience-facing center explanations and deliberate side changes at topic boundaries.
- Old single-position PDF performances receive a deterministic playback staging pass. It preserves every spoken string, reading, board and source. Topic/learning-goal changes after an established explanation may change sides; short neighboring beats stay together. Known page regions favor the nearby side. Existing deliberately varied choreography is preserved.
- `compileBeats` treated two null targets as the same semantic focus and discarded a requested position change. Only a real shared target now holds a continuous pointing explanation in place.
- Projection/speech coalescing discarded camera and position actions. Both now survive compilation. Screen lowering and the subsequent walk can share the same speech; completion waits for the actual stage acknowledgements without restarting audio.
- Automatic PDF pointing cannot pull an audience-facing center explanation back to the right.
- Camera selection now uses the rendered lens rather than a fictitious 35-degree lens. Composition favors the occupied teaching lane, the front for center explanations and crossings; clipping/material visibility and the ten-second cut hold still take precedence.
- No-op speaking moves do not request arrival acknowledgements. A real arrival clears `traveling` while speech continues, preventing repeated arrival requests throughout the utterance.

## Existing Ollama playback plan

Introduction: center. Installation: right. LLM/tools: left. Local models/model families/commands: right. Model efficiency/quantization/distillation/hardware: left. JSON/HTTP/Python: right. Generation options: left. Final recap: center. No word-level or reading changes are needed. Full computed plan: `output/staging-20261028/ollama-stage-plan.json`.

## Verification

- Local full suite: 109 test files / 666 tests passed. Relevant ESLint, server/classroom/Worker type checks, server production build and Cloudflare build passed.
- Regression tests cover authored choreography preservation, stable topic grouping, unchanged speech, null-target movement, retained projection camera/destination, audio continuity through screen and walking acknowledgements, no-op/arrival network behavior, rendered lens composition, existing cut cooldown and clipping rules.
- Local browser using the actual classroom renderer: right x=1.95 / left-front camera; after crossing, left x=-4.20 / right-front camera; center x=-0.65 / front camera. Explanation and mouth motion continued. Screenshots: `right.png`, `left-settled.png`, `center.png` in `output/staging-20261028/`.
- The live user lesson was paused at `unit-http` before deployment. Verification must not resume or replace it merely to exercise stage motion. A motion-lab check uses the deployed renderer without sending learner playback/stage acknowledgements.

## Production verification

- Final code: `e752692`; deployment [40626629167](https://github.com/mani1261790/AITuber/actions/runs/40626629167) succeeded, including the storage/restart and authenticated rollout gates. The final follow-up additionally tests projection arrival on both sides; the affected server tests and production build passed.
- Deployed motion lab at the production origin, using the same renderer as the classroom: observed right x=1.95 / left-front, walked to left x=-4.20 / right-front, then center x=-0.65 / front. Screenshots `production-left.png` and `production-center.png`; no browser errors. This exercises production-rendered movement/camera behavior, not a complete new live lecture.
- Authenticated operator snapshot after deployment remained on the user's same paused session at `unit-http`, with ChatGPT connected. No classroom playback acknowledgements were sent and the user's lesson was not resumed or replaced.
- Source fixes were also brought into the primary checkout without changing its unrelated dependency edits. Cherry-pick conflicts were resolved against that checkout's existing implementation rather than introducing unrelated main-branch assessment changes.
