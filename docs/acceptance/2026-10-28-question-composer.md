# Question composer simplification — 2026-10-28

Removed the optional target selector, its selection state, target-selection evidence request and unused styles. Clicking the material may still open chat, but does not silently select a target. Automatic teaching focus remains driven by the spoken segment and lesson. Removed the empty-chat instruction to click a location.

Questions now send text plus the current scene; the existing server resolves its contextual target. No question schema or classifier behavior was changed.

Validation: classroom ESLint, TypeScript and production build passed; all nine question-queue tests passed, including submission without an explicit target. A local Playwright fixture using the real classroom UI confirmed desktop/mobile layout and a submitted request containing text and `sceneId=scene-json` without `semanticTargetId`. These requests were intercepted locally; no synthetic question was submitted to the live lesson. Screenshots: `output/question-ui-20261028/desktop.png` and `mobile.png`.

Production: code `109f955`, deployment [40627250552](https://github.com/mani1261790/AITuber/actions/runs/40627250552) succeeded, including authenticated rollout and storage/restart checks. The public HTML and deployed JavaScript both returned HTTP 200; the deployed bundle contains the question input and no selector markup or selection prompt. Live lecture playback was not started.
