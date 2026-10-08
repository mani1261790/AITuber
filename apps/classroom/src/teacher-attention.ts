import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

/** Normalized VRM0 bones face -Z; VRM1 bones face +Z. The stage wrapper
 * corrects world heading, but does not change these local rotation signs. */
export const teacherForwardSign = (vrm: VRM) => vrm.meta?.metaVersion === "0" ? -1 : 1;

/** The teacher looks towards the explanation, with the torso following less than the head.
 * This is a pose contribution; PoseTransition supplies continuity when focus changes.
 */
export function applyTeacherAttention(vrm: VRM, target: THREE.Vector3, weight: number) {
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  if (!head || weight <= 0) return;
  vrm.scene.updateMatrixWorld(true);
  // Correct the remaining error after the authored clip has posed the head.
  const local = target.clone().sub(head.getWorldPosition(new THREE.Vector3()))
    .applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).invert());
  const forward = teacherForwardSign(vrm);
  const yaw = THREE.MathUtils.clamp(Math.atan2(forward*local.x, forward*local.z), -1.15, 1.15) * weight;
  const pitch = THREE.MathUtils.clamp(-forward*Math.atan2(local.y, Math.hypot(local.x,local.z)), -.3, .3) * weight;
  // Share the turn down the spine so the shoulder approaches the board too.
  // The pelvis and feet stay planted; the head no longer supplies most of it.
  for (const [name, share] of [["spine", .12], ["chest", .23], ["upperChest", .13], ["neck", .16], ["head", .36]] as const) {
    vrm.humanoid.getNormalizedBoneNode(name)?.rotateY(yaw * share);
  }
  vrm.humanoid.getNormalizedBoneNode("neck")?.rotateX(pitch * .35);
  head.rotateX(pitch * .65);
}

/** Eye aim is relative to the already posed head, avoiding double head turns.
 * The caller supplies the active camera or the explanation target.
 * The caller blends the resulting pose together with every other bone.
 */
export function applyTeacherGaze(vrm: VRM, target: THREE.Vector3) {
  vrm.scene.updateMatrixWorld(true);
  for (const name of ["leftEye", "rightEye"] as const) {
    const eye = vrm.humanoid.getNormalizedBoneNode(name);
    if (!eye?.parent) continue;
    const direction = target.clone().sub(eye.getWorldPosition(new THREE.Vector3()))
      .applyQuaternion(eye.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    // Never roll the eyes around to a target behind the head. Let the head turn
    // handle distant targets while the eyes remain within their natural range.
    const forward = teacherForwardSign(vrm);
    const yaw = THREE.MathUtils.clamp(Math.atan2(forward*direction.x, forward*direction.z), -.18, .18);
    const pitch = THREE.MathUtils.clamp(-forward*Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), -.14, .14);
    eye.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  }
}

/** Fixate ahead during locomotion instead of straining sideways towards the audience.
 * The rendered pose transition handles both departure and return to audience gaze.
 */
export function teacherGazeTarget(vrm: VRM, moving: boolean, cameraPosition?: THREE.Vector3) {
  if (!moving) return cameraPosition?.clone() ?? new THREE.Vector3(-.9, 2.4, 8);
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  const origin = (head ?? vrm.scene).getWorldPosition(new THREE.Vector3());
  return new THREE.Vector3(0, 0, 8)
    .applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion())).add(origin);
}
