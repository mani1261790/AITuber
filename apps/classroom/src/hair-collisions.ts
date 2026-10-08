import * as THREE from "three";
import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeCapsule, type VRM } from "@pixiv/three-vrm";

const connected = new WeakSet<VRM>();
/** Four bone-local capsules supplement the donor's thin body spheres for long hair.
 * No triangle collisions or per-frame mesh bounds; short fringe springs are untouched.
 */
export function connectHairCollisions(vrm: VRM) {
  const manager = vrm.springBoneManager;
  if (!manager || connected.has(vrm)) return { joints: 0, colliders: 0 };
  const joints = [...manager.joints].filter(j => /^J_Sec_Hair\d+_(09|11|12|13)$/.test(j.bone.name));
  const spine = vrm.humanoid.getRawBoneNode("spine");
  const chest = vrm.humanoid.getRawBoneNode("upperChest") ?? vrm.humanoid.getRawBoneNode("chest");
  const hips = vrm.humanoid.getRawBoneNode("hips");
  const left = vrm.humanoid.getRawBoneNode("leftUpperArm");
  const right = vrm.humanoid.getRawBoneNode("rightUpperArm");
  if (!joints.length || !spine || !chest || !hips || !left || !right) return { joints: 0, colliders: 0 };
  vrm.scene.updateMatrixWorld(true);
  const local = (node: THREE.Object3D) => spine.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
  const l = local(left), r = local(right), width = l.distanceTo(r);
  if (width < .01 || !Number.isFinite(width)) return { joints: 0, colliders: 0 };
  const lateral = l.clone().sub(r).normalize();
  const top = local(chest), bottom = local(hips), middle = new THREE.Vector3();
  const colliders: VRMSpringBoneCollider[] = [];
  const capsule = (offset: THREE.Vector3, tail: THREE.Vector3, radius: number) => {
    const collider = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeCapsule({ offset, tail, radius }));
    collider.name = "Teacher long-hair body clearance";
    spine.add(collider); colliders.push(collider);
  };
  // Overlapping slim capsules approximate the torso's width without a huge round
  // sphere that pushes hair unnaturally far away from the back.
  for (const side of [-1, 0, 1]) {
    const shift = lateral.clone().multiplyScalar(side * width * .19);
    capsule(middle.clone().add(shift), top.clone().add(shift), width * .25);
  }
  capsule(bottom, middle, width * .32);
  const group = { colliders };
  for (const joint of joints) {
    manager.deleteJoint(joint);
    joint.colliderGroups = [...joint.colliderGroups, group];
    // A hair ribbon has thickness beyond its centreline. Scale with the rig.
    joint.settings.hitRadius = Math.max(joint.settings.hitRadius, width * .045);
    manager.addJoint(joint);
  }
  connected.add(vrm);
  return { joints: joints.length, colliders: colliders.length };
}
