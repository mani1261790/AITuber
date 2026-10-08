# v7: half-up attachment, hair dynamics, loafers

Based on hosted v6; original sources and v6 face/eye textures retained.

- Bound side locks converge at the rear knot. New locks share the original hair material, use strand-aligned UVs, and are weighted to the head.
- Rebuilt ivory bow is moved onto the gathered locks; its tails follow the back-hair contour more closely.
- Long loose hair: stiffness 0.55, drag 0.48, downward gravity 0.12. Fringe/face hair: 0.8 / 0.58 / 0.07. Existing fixed-step runtime simulation is unchanged.
- Loafer atlas refined with imagegen, preserving original atlas layout; warm brown leather, stitching and sole contrast. Inspect on model as generation alone cannot guarantee exact UV registration.

Rebuild:
1. Blender with io_scene_vrm: scripts/character/refine_teacher_hair_v7.py
2. python3 scripts/character/refine_teacher_shoes_v7.py
3. python3 scripts/character/pack_hosted_vrm.py assets/character/teacher-reference/remake/teacher-floral-v7.vrm apps/classroom/public/models/teacher-floral-v7.vrm

Shoe source: v6 embedded Shoes_01_CLOTH atlas. Generated edit: exec-1e9a186e-95b0-4329-bd74-453771ce35b5.png; persisted as extracted/shoes-leather-v7.png.

Review includes back/side close views and walking/turning/pointing video. This is an incremental adaptation, not a finished reference-identical hairstyle. The ribbon currently follows the head; its fabric does not have independent soft-body simulation.
