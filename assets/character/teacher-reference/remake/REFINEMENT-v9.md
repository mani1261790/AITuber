# v9: swept half-up roots and lecture rendering

Uses hosted v8 as the source; face, eye and garment textures remain unchanged.

The added half-up locks are rebuilt as 11 tapered strips on each side. Their paths sample the existing hair surface, use a smooth outer envelope to avoid disappearing into underlying layers, and converge toward the rear knot. Root starts are staggered and sink into the cap; midtone UV sampling avoids the bright horizontal band of the first trial. Upper rear roots blend to head weights while free lengths retain their spring animation.

This is still a modification of the supplied donor hairstyle. The donor's coarse layered cap remains visible at close range, and the bow still follows the head without independent fabric physics. Do not describe it as reference-identical or entirely collision-free.

Rebuild with Blender and io_scene_vrm using scripts/character/refine_teacher_hair_v9.py, then pack with scripts/character/pack_hosted_vrm.py. The lab defaults to v9; classroom model selection remains unchanged.

Render resolution is now 3x on standard displays and up to 4x on Retina, bounded by 16,588,800 pixels and the GPU's maximum texture dimension. This increases sampling quality; it cannot restore detail smaller than a physical display pixel. Anisotropic sampling retains up to 8x, capped by the GPU. Local 902x507 CSS canvas checks: 2706x1521 at DPR 1 and 3608x2028 at DPR 2. DPR 1 frame sample median 16.6 ms, p95 20.2 ms (90 frames); this is not a performance guarantee for other devices.

Final structural check: 54 humanoid bones, 14 expression groups, finite float accessors, source license metadata preserved. Ear rest-pose diagnostic: 7 overlap pairs remain in inherited Hair; 0 in the new Bound half-up hair. These counts do not establish dynamic collision-free motion. Final close-up/motion evidence: output/playwright/v9-ear-detail.png, v9-final-motion-0.png through -3.png, and hair-v9-final-motion.webm. Hosted asset: 24,996,476 bytes.
