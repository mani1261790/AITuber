import {expect,it} from "vitest";
import * as THREE from "three";
import type {VRM} from "@pixiv/three-vrm";
import {StandingRecovery} from "./standing-recovery.ts";

it("places one foot at a time and finishes at the narrow standing anchors",()=>{
 const scene=new THREE.Group(),hips=new THREE.Bone();scene.add(hips);hips.position.y=.8;
 const nodes:Record<string,THREE.Bone>={hips};
 for(const side of ["left","right"]){const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();hips.add(upper);upper.add(lower);lower.add(foot);upper.position.x=side==="left"?.08:-.08;lower.position.y=-.4;foot.position.y=-.4;nodes[side+"UpperLeg"]=upper;nodes[side+"LowerLeg"]=lower;nodes[side+"Foot"]=foot;}
 const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 // Capture the same authored idle pose used by the mixer, including toe-in.
 nodes.leftUpperLeg!.position.x=.056;nodes.rightUpperLeg!.position.x=-.056;
 nodes.leftFoot!.rotation.y=-.12;nodes.rightFoot!.rotation.y=.12;
 const recovery=new StandingRecovery(vrm);
 hips.position.y=.78;nodes.leftUpperLeg!.rotation.z=.18;nodes.rightUpperLeg!.rotation.z=-.1;
 scene.updateMatrixWorld(true);
 const start=nodes.rightFoot!.getWorldPosition(new THREE.Vector3());
 recovery.begin();expect(recovery.active).toBe(true);let clearance=0;
 for(let i=0;i<60;i++){
  // Mimic the running mixer restoring an idle target before the recovery overlay.
  Object.values(nodes).forEach(node=>node.quaternion.identity());scene.updateMatrixWorld(true);recovery.apply(1/60);scene.updateMatrixWorld(true);
  if(i===49)expect(recovery.active).toBe(true);
  if(i===50){
   // A final pose limiter can delay the feet. Do not finish on the timer alone.
   nodes.leftFoot!.rotation.y=.3;recovery.confirmSettled();expect(recovery.active).toBe(true);
  }else recovery.confirmSettled();
  if(i<24)expect(nodes.rightFoot!.getWorldPosition(new THREE.Vector3()).distanceTo(start)).toBeLessThan(.001);
  clearance=Math.max(clearance,nodes.leftFoot!.getWorldPosition(new THREE.Vector3()).y);
  if(i===49){expect(nodes.leftFoot!.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(.056,3);expect(nodes.rightFoot!.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(-.056,3);}
 }
 expect(clearance).toBeGreaterThan(.01);
 expect(recovery.active).toBe(false);
 recovery.begin();recovery.cancel();nodes.leftUpperLeg!.rotation.x=.2;const pose=nodes.leftUpperLeg!.quaternion.clone();recovery.apply(1/60);expect(nodes.leftUpperLeg!.quaternion.angleTo(pose)).toBeLessThan(1e-6);
});
