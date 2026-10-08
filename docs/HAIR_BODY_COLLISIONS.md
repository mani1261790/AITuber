# Long-hair body clearance

Four overlapping capsule colliders supplement the authored VRoid spheres. They are attached to the raw spine bone and sized from the shoulder spacing, covering the upper torso and lower torso without per-frame mesh/triangle intersection. Only the recognized long-hair chains (09, 11, 12, 13; 20 joints on floral v9) receive the new group. Short fringe and garment springs keep their existing groups; hair stiffness/gravity/drag are preserved. The hair hit radius accounts for ribbon thickness. Unsupported rigs are left untouched.

Validation: 13 hair/garment/fixed-step tests pass, including scale, attachment transforms, unchanged damping, idempotence and a hair tip escaping the torso without stretching. Classroom build and targeted lint pass. Local side-view checks exercise left/right movement, pointing and nodding (output/playwright/hair-collision-0.png through -3.png).

A browser-only instrument measured 120 steady-state spring updates per case on this machine: mean 0.502 ms without the added capsules, 0.514 ms with them; p95 0.600 ms in both cases. This short local sample is not a guarantee for mobile hardware or all motion phases. Instrumentation is not in production.

Approximate spring-tip collisions reduce torso penetration; they do not guarantee that every point of a wide hair mesh or all sleeves remains collision-free. Review garment changes against these bounds and adjust when the silhouette changes.
