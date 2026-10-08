import { expect, it } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { withLightWalk } from "./light-walk.ts";

it("lowers swing clearance without shortening the stride or changing ankle roll and restores the live rig",()=>{
 const scene=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
  upper.name=side+"UpperLeg";lower.name=side+"LowerLeg";foot.name=side+"Foot";
  scene.add(upper);upper.add(lower);lower.add(foot);
  upper.position.set(side==="left"?-.15:.15,1,0);lower.position.set(0,-.45,.1);foot.position.set(0,-.45,-.1);
  for(const bone of [upper,lower,foot])nodes[bone.name]=bone;
 }
 const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-.4);
 const source=new THREE.AnimationClip("walk",1,[new THREE.QuaternionKeyframeTrack("leftUpperLeg.quaternion",[0,.5,1],[0,0,0,1,...q.toArray(),0,0,0,1])]);
 const before=source.toJSON(),result=withLightWalk(vrm,source);
 expect(source.toJSON()).toEqual(before);expect(result.duration).toBe(source.duration);
 expect(nodes.leftUpperLeg!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-8);
 const sample=(clip:THREE.AnimationClip)=>{
  Object.values(nodes).forEach(b=>b.quaternion.identity());
  const mixer=new THREE.AnimationMixer(scene);mixer.clipAction(clip).play();mixer.setTime(.5);scene.updateMatrixWorld(true);
  const values=[nodes.leftFoot!,nodes.rightFoot!].map(b=>({p:b.getWorldPosition(new THREE.Vector3()),q:b.getWorldQuaternion(new THREE.Quaternion())}));
  mixer.stopAllAction();mixer.uncacheRoot(scene);return values;
 };
 const original=sample(source),light=sample(result);
 expect(light[0]!.p.y-light[1]!.p.y).toBeLessThan((original[0]!.p.y-original[1]!.p.y)*.75);
 for(let i=0;i<2;i++){
  expect(light[i]!.p.x).toBeCloseTo(original[i]!.p.x,4);expect(light[i]!.p.z).toBeCloseTo(original[i]!.p.z,4);
  expect(light[i]!.q.angleTo(original[i]!.q)).toBeLessThan(.001);
 }
});
