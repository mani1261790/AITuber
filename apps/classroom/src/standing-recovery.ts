import * as THREE from "three";
import type {VRM} from "@pixiv/three-vrm";
import {solveLeg} from "./foot-contact.ts";

/** Place each foot back into the authored narrow stance after the final turn.
 * The other foot supports the body; feet do not slide together across the floor. */
export class StandingRecovery {
  private legs: {upper:THREE.Object3D;lower:THREE.Object3D;foot:THREE.Object3D;goal:THREE.Vector3;rotation:THREE.Quaternion}[];
  private starts: {position:THREE.Vector3;rotation:THREE.Quaternion}[]=[];
  private order:number[]=[];
  private age=0;
  private duration=.42;
  get active(){return this.starts.length>0;}
  constructor(private vrm:VRM) {
    const root=vrm.scene;root.updateMatrixWorld(true);
    const inverse=root.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.legs=(["left","right"] as const).flatMap(side=>{
      const upper=vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`),lower=vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`),foot=vrm.humanoid.getNormalizedBoneNode(`${side}Foot`);
      return upper&&lower&&foot ? [{upper,lower,foot,goal:root.worldToLocal(foot.getWorldPosition(new THREE.Vector3())),rotation:inverse.clone().multiply(foot.getWorldQuaternion(new THREE.Quaternion()))}] : [];
    });
  }
  begin(){
    if(this.legs.length!==2)return;
    const root=this.vrm.scene;root.updateMatrixWorld(true);
    const inverse=root.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.starts=this.legs.map(({foot})=>({position:root.worldToLocal(foot.getWorldPosition(new THREE.Vector3())),rotation:inverse.clone().multiply(foot.getWorldQuaternion(new THREE.Quaternion()))}));
    this.order=[0,1].sort((a,b)=>this.starts[b]!.position.distanceToSquared(this.legs[b]!.goal)-this.starts[a]!.position.distanceToSquared(this.legs[a]!.goal));
    this.age=0;
  }
  cancel(){this.starts=[];}
  apply(delta:number){
    if(!this.starts.length)return;
    const root=this.vrm.scene;
    this.age+=Math.max(0,Math.min(delta,1/30));
    this.legs.forEach((leg,index)=>{
      const start=this.starts[index]!;
      const phase=THREE.MathUtils.clamp((this.age-this.order.indexOf(index)*this.duration)/this.duration,0,1);
      const progress=THREE.MathUtils.smootherstep(phase,0,1);
      const local=start.position.clone().lerp(leg.goal,progress);
      // Small steps have proportionally less clearance; never march in place.
      const distance=Math.hypot(start.position.x-leg.goal.x,start.position.z-leg.goal.z);
      local.y+=Math.min(.035,distance*.3)*Math.sin(Math.PI*phase)**2;
      solveLeg(root,leg.upper,leg.lower,leg.foot,root.localToWorld(local),0);
      const rotation=start.rotation.clone().slerp(leg.rotation,progress).premultiply(root.getWorldQuaternion(new THREE.Quaternion()));
      leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    });
  }
  /** Check the rendered result, including the final angular-velocity limiter. */
  confirmSettled(){
    if(!this.active || this.age<this.duration*2)return;
    const root=this.vrm.scene;root.updateMatrixWorld(true);
    const inverse=root.getWorldQuaternion(new THREE.Quaternion()).invert();
    if(this.legs.every(leg=>root.worldToLocal(leg.foot.getWorldPosition(new THREE.Vector3())).distanceTo(leg.goal)<.004
      && inverse.clone().multiply(leg.foot.getWorldQuaternion(new THREE.Quaternion())).angleTo(leg.rotation)<.04))this.cancel();
  }
}
