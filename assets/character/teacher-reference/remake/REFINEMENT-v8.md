# v8: ear clearance and gathered half-up hair

## Changes

Based on hosted v7, preserving face/eye, clothing and loafer textures and license metadata.

- Classify connected hair islands before moving strands around the ears, avoiding a split through a connected strand.
- Use a local elliptical clearance rather than opening a large hole around each ear. Rejected full underlayers and large openings because they looked like flat sideburn panels or bare patches in side views.
- Replace the swept additions with tapered, head-bound panels and strand-aligned UVs.
- Gather the inner rear locks while preserving the outer loose locks. Move the corresponding rest bones with the mesh. Fade gathering toward the scalp and forward hair to avoid compressing the whole cap.
- Move the ivory knot toward the gathered locks. Retain the v7 spring settings and the existing gaze/motion runtime.

## Verification and limits

Classroom build passes. VRM structural validation checks finite coordinates, 54 humanoid bones, 14 expression groups, and preservation of source metadata. Local browser review includes both side views, rear view, pointing and nodding; walking/turning is recorded in output/playwright/hair-v8-final-motion.webm. Diagnostic close-up camera overrides are removed after recording.

This remains a refinement candidate, not reference-image-level completion. The inherited large side-hair layers and the transition into the added swept strands are still visible at close range. The ribbon follows the head and has no independent fabric simulation. Static mesh intersection counts do not prove collision-free spring motion. Keep these limitations visible rather than treating a successful export or build as artistic acceptance.

## Rebuild

1. Blender 4.5 with io_scene_vrm: scripts/character/refine_teacher_hair_v8.py
2. python3 scripts/character/pack_hosted_vrm.py assets/character/teacher-reference/remake/teacher-floral-v8.vrm apps/classroom/public/models/teacher-floral-v8.vrm
3. Blender: scripts/character/check_teacher_ear_clearance.py -- v8 (rest-pose diagnostic).

The motion lab defaults to v8; the classroom model setting is unchanged.

Final static diagnostic on the 664 selected ear polygons: original Hair overlap pairs reduced from v7's 587 to 7; new Bound half-up hair has 0. This is a reduction, not a zero-intersection result. Hosted file is 25,056,312 bytes, below the 25 MiB static-asset limit.
