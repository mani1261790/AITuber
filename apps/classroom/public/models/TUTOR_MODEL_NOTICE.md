# Tutor VRM model

`tutor.vrm` is the original `AITuber Teacher` model created for this project
with VRoid Studio 2.14.0. The editable source is stored at
`assets/character/AITuber-Teacher-Draft.vroid`.

The embedded VRM 1.0 metadata names `AITuber Project` as the creator and allows
use by everyone, corporate commercial use, redistribution, modification, and
redistribution after modification. Attribution is not required by the embedded
metadata.

The model asset is governed by its embedded VRM metadata. Third-party software
used to display it remains governed by its own license.

## Proportion revision

`tutor-refined.vrm` is a derived version of that same original model, now used by
classroom playback. It is NOT a replacement by a third-party character.
`scripts/rebuild-teacher-proportions.py` deforms rest geometry, skeleton, inverse
bind matrices, morph targets and collider offsets together. The original
`tutor.vrm` and editable `.vroid` are unchanged. The derived model retains the
original license. Face, texture and skin weights are preserved.

Rebuild with Python + numpy:

    python3 scripts/rebuild-teacher-proportions.py apps/classroom/public/models/tutor.vrm apps/classroom/public/models/tutor-refined.vrm

The .vroid editor source does not include this offline deformation. Regenerate
the derived file after exporting a new original. The default trial ratio of
shin to thigh is 0.98; this is an aesthetic revision, not an anatomical standard.

## Classroom sleeve revision

`tutor-classroom.vrm` is the current classroom model. It additionally shortens
and tapers the two bell cuffs, so pointing fingers and presenting palms remain
visible. The same original-model license applies. Skin, fingers, skeleton,
weights and textures are unchanged from the proportion revision.

    python3 scripts/tailor-teacher-sleeves.py apps/classroom/public/models/tutor-refined.vrm apps/classroom/public/models/tutor-classroom.vrm

Keep both generation steps when rebuilding from the original export. Neither
step edits the user's .vroid source.
