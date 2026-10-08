import * as THREE from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import { solveLeg } from "./foot-contact.ts";

/** Bake a lower swing arc, preserving the recorded stride, timing and ankle roll.
 * Editing knee angles alone shortens the stride and increases the number of steps. */
export function withLightWalk(vrm: VRM, source: THREE.AnimationClip) {
  const legs=(["left","right"] as const).map(side=>({
    upper:vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`),
    lower:vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`),
    foot:vrm.humanoid.getNormalizedBoneNode(`${side}Foot`),
  }));
  if(legs.some(leg=>!leg.upper||!leg.lower||!leg.foot))return source.clone();
  const saved=Object.values(VRMHumanBoneName).flatMap(name=>{
    const bone=vrm.humanoid.getNormalizedBoneNode(name);
    return bone?[{bone,p:bone.position.clone(),q:bone.quaternion.clone()}]:[];
  });
  const result=source.clone(),mixer=new THREE.AnimationMixer(vrm.scene);
  const action=mixer.clipAction(source).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const times=Float32Array.from({length:Math.max(2,Math.ceil(source.duration*60)+1)},(_,i)=>i);
  for(let i=0;i<times.length;i++)times[i]=source.duration*i/(times.length-1);
  const rotations=new Map(legs.flatMap(leg=>[leg.upper!,leg.lower!,leg.foot!]).map(bone=>[bone,[] as number[]]));
  try {
    for(const time of times){
      saved.forEach(({bone,p,q})=>{bone.position.copy(p);bone.quaternion.copy(q);});
      action.paused=false;mixer.setTime(time);vrm.scene.updateMatrixWorld(true);
      const goals=legs.map(leg=>leg.foot!.getWorldPosition(new THREE.Vector3()));
      const floor=Math.min(...goals.map(p=>p.y));
      for(let i=0;i<legs.length;i++){
        const leg=legs[i]!,goal=goals[i]!;
        const hip=leg.upper!.getWorldPosition(new THREE.Vector3());
        const knee=leg.lower!.getWorldPosition(new THREE.Vector3());
        const reach=(hip.distanceTo(knee)+knee.distanceTo(goal))*.998;
        const horizontalSq=(goal.x-hip.x)**2+(goal.z-hip.z)**2;
        const reachableY=hip.y-Math.sqrt(Math.max(0,reach*reach-horizontalSq));
        goal.y=Math.max(reachableY,floor+(goal.y-floor)*.65);
        solveLeg(vrm.scene,leg.upper!,leg.lower!,leg.foot!,goal);
      }
      rotations.forEach((values,bone)=>values.push(...bone.quaternion.toArray()));
    }
    const names=new Set([...rotations.keys()].map(bone=>`${bone.name}.quaternion`));
    result.tracks=result.tracks.filter(track=>!names.has(track.name));
    rotations.forEach((values,bone)=>result.tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,values)));
    return result;
  } finally {
    mixer.stopAllAction();mixer.uncacheRoot(vrm.scene);
    saved.forEach(({bone,p,q})=>{bone.position.copy(p);bone.quaternion.copy(q);});
    vrm.scene.updateMatrixWorld(true);
  }
}
