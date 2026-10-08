import { expect, it } from "vitest";
import * as THREE from "three";
import { VRMSpringBoneManager, VRMSpringBoneJoint, type VRM } from "@pixiv/three-vrm";
import { connectHairCollisions } from "./hair-collisions.ts";

function fixture(scale = 1) {
  const scene=new THREE.Group();scene.scale.setScalar(scale);
  const bones: Record<string,THREE.Bone>={};
  for(const [name,x,y] of [["hips",0,.6],["spine",0,.9],["upperChest",0,1.2],["leftUpperArm",.2,1.2],["rightUpperArm",-.2,1.2]] as const){
    const bone=new THREE.Bone();bone.position.set(x,y,0);scene.add(bone);bones[name]=bone;
  }
  const hair=new THREE.Bone(),tail=new THREE.Bone(),fringe=new THREE.Bone(),fringeTail=new THREE.Bone();
  hair.name="J_Sec_Hair2_11";hair.position.set(0,1.5,.035);tail.position.y=-.45;hair.add(tail);scene.add(hair);
  fringe.name="J_Sec_Hair1_01";fringe.position.set(0,1.6,.2);fringeTail.position.y=-.1;fringe.add(fringeTail);scene.add(fringe);
  const manager=new VRMSpringBoneManager();
  const joint=new VRMSpringBoneJoint(hair,tail,{stiffness:.5,gravityPower:.12,dragForce:.48,hitRadius:.004});
  const short=new VRMSpringBoneJoint(fringe,fringeTail,{hitRadius:.004});manager.addJoint(joint);manager.addJoint(short);
  scene.updateMatrixWorld(true);
  const vrm={scene,springBoneManager:manager,humanoid:{getRawBoneNode:(n:string)=>bones[n]??null}} as unknown as VRM;
  return {vrm,joint,short,tail,manager};
}
it("adds a bounded set only to long hair, preserves motion settings and is idempotent",()=>{
  const f=fixture(),before={...f.joint.settings};
  expect(connectHairCollisions(f.vrm)).toEqual({joints:1,colliders:4});
  expect(f.short.colliderGroups).toEqual([]);
  expect(f.joint.settings.dragForce).toBe(before.dragForce);
  expect(f.joint.settings.stiffness).toBe(before.stiffness);
  expect(connectHairCollisions(f.vrm)).toEqual({joints:0,colliders:0});
});
it.each([1,2])("pushes a long hair tip out of the torso at scale %s",scale=>{
  const f=fixture(scale);connectHairCollisions(f.vrm);f.manager.setInitState();
  for(let i=0;i<120;i++)f.manager.update(1/60);
  f.vrm.scene.updateMatrixWorld(true);
  const tip=f.tail.getWorldPosition(new THREE.Vector3());
  expect(tip.z/scale).toBeGreaterThan(.1);
  expect(Number.isFinite(tip.y)).toBe(true);
  // Hair keeps its segment length instead of stretching to escape the collider.
  expect(tip.distanceTo(f.joint.bone.getWorldPosition(new THREE.Vector3()))/scale).toBeCloseTo(.45,3);
});
it("leaves incomplete and unsupported rigs untouched",()=>{
  const f=fixture();f.joint.bone.name="custom-hair";
  expect(connectHairCollisions(f.vrm)).toEqual({joints:0,colliders:0});
});
it("keeps torso colliders attached through translation and rotation",()=>{
 const f=fixture();connectHairCollisions(f.vrm);
 const collider=f.joint.colliderGroups.at(-1)!.colliders[0]!;
 const before=collider.getWorldPosition(new THREE.Vector3());
 const spine=collider.parent!;spine.position.x+=.3;spine.rotation.y=Math.PI/2;f.vrm.scene.updateMatrixWorld(true);
 expect(collider.getWorldPosition(new THREE.Vector3()).x-before.x).toBeCloseTo(.3);
 expect(collider.getWorldQuaternion(new THREE.Quaternion()).angleTo(spine.getWorldQuaternion(new THREE.Quaternion()))).toBeCloseTo(0);
});
it("attaches extra hair guards to articulated sleeves",()=>{
 const f=fixture();
 const upper=f.vrm.humanoid.getRawBoneNode("rightUpperArm")!;
 const lower=new THREE.Bone(),hand=new THREE.Bone();lower.position.x=-.22;hand.position.x=-.20;upper.add(lower);lower.add(hand);
 const original=f.vrm.humanoid.getRawBoneNode.bind(f.vrm.humanoid);
 f.vrm.humanoid.getRawBoneNode=(name)=>name==="rightLowerArm"?lower:name==="rightHand"?hand:original(name);
 f.vrm.scene.updateMatrixWorld(true);
 expect(connectHairCollisions(f.vrm)).toEqual({joints:1,colliders:6});
 const guards=f.joint.colliderGroups.at(-1)!.colliders.filter(c=>c.name.includes("sleeve"));
 expect(guards.map(c=>c.parent)).toEqual([upper,lower]);
 upper.rotation.z=Math.PI/2;f.vrm.scene.updateMatrixWorld(true);
 expect(guards[1]!.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
});
