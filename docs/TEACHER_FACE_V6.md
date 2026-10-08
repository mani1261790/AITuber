# Face / gaze revision v6

2026-10-08. The VRM0 normalized head/eye axes face -Z. The stage adds a π orientation wrapper, but attention previously treated local +Z as the face direction. Camera targets became behind-head targets and clamped to the wrong turn. Head and eye yaw/pitch now account for VRM version. Motion continues to use the stage heading during travel.

A regression covers the VRM0 wrapper, straight camera gaze, and left/up target error reduction; existing VRM1-style tests are retained. Attention and motion tests: 34 passed locally. Included in deployment CI.

Model changes: two generated UV texture replacements, brown irises and softly diffused cheek/lip color. Facial geometry and expressions are preserved. This is a color/detail iteration, not a claim that face proportions fully match the reference.

Inputs: assets/character/teacher-reference/remake/extracted/iris-brown-v6.png and face-soft-v6.png. Generated with built-in image_gen from v5 iris/face textures, preserving UV positions. Outputs exec-e1d8f970-ad8c-4d97-ba09-37128d750c02.png and exec-026fe21a-b4ab-42b5-afd8-b35585095ce8.png under the current generated_images thread directory.

Rebuild: scripts/character/refine_teacher_face_v6.py, then scripts/character/pack_hosted_vrm.py. Source v5 is preserved. Local images: output/playwright/teacher-v6-face.png, teacher-v6-idle.png, teacher-v6-point.png. The classroom lighting was used for the color check.
