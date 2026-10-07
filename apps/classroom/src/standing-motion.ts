import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { solveLeg } from "./foot-contact.ts";

/** Author a quiet, narrow stance into the idle clip, before any runtime blending.
 * Keep the captured upper-body performance. Feet stay planted while the pelvis
 * makes a small weight shift; never squeeze the legs after the walking solver. */
export function withTeacherStance(vrm: VRM, source: THREE.AnimationClip) {
  const names = ["hips", "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes", "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"] as const;
  const nodes = new Map(names.flatMap(name => {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    return node ? [[name, node] as const] : [];
  }));
  const hips = nodes.get("hips");
  const legs = (["left", "right"] as const).map(side => ({upper:nodes.get(`${side}UpperLeg`), lower:nodes.get(`${side}LowerLeg`), foot:nodes.get(`${side}Foot`)}));
  if (!hips || legs.some(leg => !leg.upper || !leg.lower || !leg.foot)) return source.clone();
  const saved = new Map([...nodes.values()].map(node => [node,{position:node.position.clone(),rotation:node.quaternion.clone()}]));
  const restore = () => { saved.forEach((pose,node) => { node.position.copy(pose.position);node.quaternion.copy(pose.rotation); });vrm.scene.updateMatrixWorld(true); };
  const clip = source.clone();
  const lowerNames = new Set([...nodes.values()].map(node => node.name));
  clip.tracks = clip.tracks.filter(track => !lowerNames.has(track.name.split(".")[0]!));
  const count = Math.max(2,Math.ceil(source.duration*30)+1);
  const times = Float32Array.from({length:count},(_,i)=>source.duration*i/(count-1));
  const rotations = new Map([...nodes.values()].map(node => [node,new Float32Array(count*4)]));
  const positions = new Float32Array(count*3);
  try {
    vrm.scene.updateMatrixWorld(true);
    const localFeet = legs.map(leg=>vrm.scene.worldToLocal(leg.foot!.getWorldPosition(new THREE.Vector3())));
    const center = (localFeet[0]!.x+localFeet[1]!.x)/2;
    const goals = localFeet.map(point => vrm.scene.localToWorld(new THREE.Vector3(center+(point.x-center)*.7,point.y,point.z)));
    // A small toe-in, without crossing ankles or forcing the knees together.
    // Resolve the sign from the rest-pose forward direction for both VRM versions.
    const footRotations = legs.map((leg,index) => {
      const rotation=leg.foot!.getWorldQuaternion(new THREE.Quaternion());
      const forward=new THREE.Vector3(0,0,1).applyQuaternion(rotation)
        .applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion()).invert());
      const angle=-Math.sign(localFeet[index]!.x-center)*Math.sign(forward.z || 1)*THREE.MathUtils.degToRad(7);
      return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0).applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion())),angle).multiply(rotation);
    });
    for(let i=0;i<count;i++) {
      restore();
      const phase=2*Math.PI*i/(count-1);
      hips.quaternion.identity();
      hips.position.x += .003*Math.sin(phase);
      hips.position.y -= .004+.001*(1-Math.cos(phase));
      vrm.scene.updateMatrixWorld(true);
      legs.forEach((leg,index)=>solveLeg(vrm.scene,leg.upper!,leg.lower!,leg.foot!,goals[index]!,0));
      legs.forEach((leg,index)=>leg.foot!.quaternion.copy(leg.foot!.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footRotations[index]!)));
      rotations.forEach((values,node)=>node.quaternion.toArray(values,i*4));
      hips.position.toArray(positions,i*3);
    }
    rotations.forEach((values,node)=>clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`,times,values)));
    clip.tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`,times,positions));
    return clip;
  } finally { restore(); }
}
