import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { sideStepStride } from "./stage-locomotion.ts";
import { solveLeg } from "./foot-contact.ts";
export interface SideStep {progress:number;start:number;goal:number}
/** Step out with the leading foot, then bring the other foot alongside it. */
export function sideStepOffset(step:SideStep,leading:boolean){
 const count=Math.max(1,Math.ceil(Math.abs(step.goal-step.start)/sideStepStride));
 const cycle=Math.min(count,Math.max(0,step.progress));
 const whole=Math.floor(cycle),phase=cycle-whole;
 const swing=THREE.MathUtils.clamp((phase-(leading?0:.5))*2,0,1);
 return {x:(step.goal-step.start)/count*(whole+THREE.MathUtils.smootherstep(swing,0,1)),lift:.065*Math.sin(Math.PI*swing)**2};
}
export class BoardSideStep {
 private key="";
 private feet:{upper:THREE.Object3D;lower:THREE.Object3D;foot:THREE.Object3D;origin:THREE.Vector3;orientation:THREE.Quaternion;leading:boolean}[]=[];
 constructor(private vrm:VRM){}
 apply(step:SideStep|undefined){
  if(!step){this.key="";return;}
  const key=`${step.start}:${step.goal}`;
  if(key!==this.key){
   this.key=key;this.vrm.scene.updateMatrixWorld(true);
   this.feet=(["left","right"] as const).flatMap(side=>{
    const upper=this.vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`),lower=this.vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`),foot=this.vrm.humanoid.getNormalizedBoneNode(`${side}Foot`);
    if(!upper||!lower||!foot)return [];
    const origin=foot.getWorldPosition(new THREE.Vector3());
    // Grounding adjusts the avatar root after retargeting. Preserve ankle height
    // relative to that root, otherwise world-space IK fights floor correction.
    origin.y-=this.vrm.scene.getWorldPosition(new THREE.Vector3()).y;
    return [{upper,lower,foot,origin,orientation:foot.getWorldQuaternion(new THREE.Quaternion()),leading:false}];
   });
   const sorted=[...this.feet].sort((a,b)=>(b.origin.x-a.origin.x)*Math.sign(step.goal-step.start));
   if(sorted[0])sorted[0].leading=true;
  }
  for(const {upper,lower,foot,origin,orientation,leading} of this.feet){
   const offset=sideStepOffset(step,leading),goal=origin.clone().add(new THREE.Vector3(offset.x,offset.lift+this.vrm.scene.getWorldPosition(new THREE.Vector3()).y,0));
   solveLeg(this.vrm.scene,upper,lower,foot,goal,.75);
   foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
  }
 }
}
