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

/** Conservative local eye limits. Keep iris visible even when the head turns.
 * Upward travel is smaller because it disappears behind the upper eyelid first. */
export const eyeLimits = { yaw: .09, up: .035, down: .055 } as const;

function boundedEyeAngles(vrm: VRM, direction: THREE.Vector3) {
  const forward=teacherForwardSign(vrm);
  if(direction.lengthSq()<1e-10 || forward*direction.z<=0)return {yaw:0,pitch:0};
  let yaw=THREE.MathUtils.clamp(Math.atan2(forward*direction.x,forward*direction.z),-eyeLimits.yaw,eyeLimits.yaw);
  let elevation=THREE.MathUtils.clamp(Math.atan2(direction.y,Math.hypot(direction.x,direction.z)),-eyeLimits.down,eyeLimits.up);
  // Elliptical envelope prevents extreme diagonal eye poses too.
  const radius=Math.hypot(yaw/eyeLimits.yaw,elevation/(elevation>0?eyeLimits.up:eyeLimits.down));
  if(radius>1){yaw/=radius;elevation/=radius;}
  return {yaw,pitch:-forward*elevation};
}

/** Solve against the FINAL head pose, not the target pose of the body spring. */
export function applyTeacherGaze(vrm: VRM, target: THREE.Vector3) {
  vrm.scene.updateMatrixWorld(true);
  for(const name of ["leftEye","rightEye"] as const){
    const eye=vrm.humanoid.getNormalizedBoneNode(name);
    if(!eye?.parent)continue;
    const direction=target.clone().sub(eye.getWorldPosition(new THREE.Vector3()))
      .applyQuaternion(eye.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    const {yaw,pitch}=boundedEyeAngles(vrm,direction);
    eye.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,"YXZ"));
  }
}

/** Eyes have no angular momentum. Exponential interpolation is monotonic and
 * stays within the bounded local envelope, independently of body inertia. */
export class TeacherGaze {
  private angles=new Map<THREE.Object3D,{yaw:number;pitch:number}>();
  constructor(private vrm:VRM){}
  update(target:THREE.Vector3,delta:number){
    applyTeacherGaze(this.vrm,target);
    const dt=THREE.MathUtils.clamp(delta,0,1/30);
    for(const name of ["leftEye","rightEye"] as const){
      const eye=this.vrm.humanoid.getNormalizedBoneNode(name);if(!eye)continue;
      const goal=new THREE.Euler().setFromQuaternion(eye.quaternion,"YXZ");
      const state=this.angles.get(eye)??{yaw:0,pitch:0};
      state.yaw=THREE.MathUtils.damp(state.yaw,goal.y,28,dt);
      state.pitch=THREE.MathUtils.damp(state.pitch,goal.x,28,dt);
      eye.quaternion.setFromEuler(new THREE.Euler(state.pitch,state.yaw,0,"YXZ"));
      this.angles.set(eye,state);
    }
  }
}

/** A stable student-side target: camera cuts must not pull a walking teacher's face
 * away from the class. Keep the vertical target level during sideways travel. */
export function teacherGazeTarget(vrm: VRM, moving: boolean, cameraPosition?: THREE.Vector3) {
  if (!moving) return cameraPosition?.clone() ?? new THREE.Vector3(-.9, 2.4, 8);
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  const origin = (head ?? vrm.scene).getWorldPosition(new THREE.Vector3());
  return new THREE.Vector3(-.9,origin.y,8);
}

/** Permit a small glance along the path, but do not turn the face broadside with
 * the pelvis. Bound the correction and share it across the chest, neck and head;
 * eye tracking remains independently limited to the visible-iris envelope. */
export function applyTravelAttention(vrm: VRM, target: THREE.Vector3) {
  const head=vrm.humanoid.getNormalizedBoneNode("head");
  if(!head)return;
  vrm.scene.updateMatrixWorld(true);
  const forward=new THREE.Vector3(0,0,teacherForwardSign(vrm)).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
  const toward=target.clone().sub(head.getWorldPosition(new THREE.Vector3()));
  const error=THREE.MathUtils.euclideanModulo(Math.atan2(toward.x,toward.z)-Math.atan2(forward.x,forward.z)+Math.PI,Math.PI*2)-Math.PI;
  const allowed=20*Math.PI/180;
  const correction=THREE.MathUtils.clamp(error-THREE.MathUtils.clamp(error,-allowed,allowed),-1.15,1.15);
  // Rotate around WORLD up: VRM0 wrappers and tilted authored bones must not
  // invert the yaw or turn it into a roll. These are offsets, not rig limits.
  for(const [name,share] of [["spine",.12],["chest",.23],["upperChest",.13],["neck",.16],["head",.36]] as const){
    const bone=vrm.humanoid.getNormalizedBoneNode(name);if(!bone?.parent)continue;
    vrm.scene.updateMatrixWorld(true);
    const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),correction*share);
    bone.quaternion.premultiply(parent.clone().invert().multiply(rotation).multiply(parent));
  }
}
