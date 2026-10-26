# Teacher motion adjustments

- Cap neck at 0.45 rad/s and other attention-chain joints at 0.9 rad/s, with coordinated post-IK progression. Arms/fingers/gait retain separate limits. Turn clip durations bounded to 1–1.8s.
- Move presentation hands farther out and slightly up; move the elbow pole outward/forward instead of behind the jacket. Cover both VRM conventions and stage headings.
- Existing Ollama draft has 19 beats with no pointing target and 16 semantic targets with no page region. Infer only unique horizontal PDF text locations matching the target label/source term. Activate an inferred target only during speech mentioning that term; explicit targets retain precedence. Unknown/ambiguous locations stay unpointed.
- React review: speech updates do not remount the avatar or invalidate PDF texture content keys; runtime reads latest target through the existing ref. No additional network polling.
- 76 tests passed across motion, attention, transitions, locomotion, pointing, PDF layout and lesson texture. New checks cover frame-rate-independent neck/head speed bounds (30/60/120fps), presentation elbow clearance, and rejecting unknown/ambiguous text regions.
- Browser motion lab using production VRM: inspected explanation, emphasis, pointing and turn poses. Screenshots in output/playwright/motion-20261026. This is pose/preview verification, not proof of zero garment collisions across all animations.
- Actual provided Ollama PDF text extraction located three unique target regions: install page3, distillation page13, Python page22. Other ambiguous/missing regions remain uninferred.
