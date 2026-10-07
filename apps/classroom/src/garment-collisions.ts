import type { VRM } from "@pixiv/three-vrm";

/** Reuse the authored limb colliders for VRoid's skirt chains. No asset mutation.
 * Unknown rigs retain their original physics; body/hair springs are untouched.
 */
export function connectGarmentCollisions(vrm: VRM) {
  const manager = vrm.springBoneManager;
  if (!manager) return { joints: 0, addedGroups: 0 };
  const arms = new Set((["leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand"] as const).map(name => vrm.humanoid.getRawBoneNode(name)).filter(Boolean));
  const legs = new Set([vrm.humanoid.getRawBoneNode("leftUpperLeg"), vrm.humanoid.getRawBoneNode("rightUpperLeg")].filter(Boolean));
  const groups = manager.colliderGroups;
  const limbGroups = groups.filter(group => group.colliders.some(collider => arms.has(collider.parent)));
  const legGroups = groups.filter(group => group.colliders.some(collider => legs.has(collider.parent)));
  let joints = 0, addedGroups = 0;
  for (const joint of [...manager.joints]) {
    if (!/^J_Sec_[LR]_(?:Coat)?Skirt/.test(joint.bone.name)) continue;
    // VRoid garments can ship with nearly undamped springs (0–0.05).
    // Keep cloth dynamics, but dissipate the kick after a body turn.
    joint.settings.dragForce = Math.max(joint.settings.dragForce, .25);
    const extra = joint.bone.name.includes("CoatSkirt") ? [...limbGroups, ...legGroups] : limbGroups;
    const missing = extra.filter(group => !joint.colliderGroups.includes(group));
    if (!missing.length) continue;
    // Re-register to invalidate the manager's dependency ordering cache.
    manager.deleteJoint(joint);
    joint.colliderGroups = [...joint.colliderGroups, ...missing];
    manager.addJoint(joint);
    joints++; addedGroups += missing.length;
  }
  return { joints, addedGroups };
}
