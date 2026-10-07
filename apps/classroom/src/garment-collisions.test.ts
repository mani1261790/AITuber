import { expect, it } from "vitest";
import * as THREE from "three";
import { VRMSpringBoneManager, VRMSpringBoneJoint, VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere, type VRM } from "@pixiv/three-vrm";
import { connectGarmentCollisions } from "./garment-collisions.ts";

function fixture() {
  const scene=new THREE.Group(),hand=new THREE.Bone(),hem=new THREE.Bone(),tail=new THREE.Bone(),hair=new THREE.Bone(),hairTail=new THREE.Bone();
  hem.name="J_Sec_L_SkirtSide1_01";scene.add(hand,hem,hair);hem.add(tail);hair.add(hairTail);
  hem.position.set(0,1,0);tail.position.y=-.5;hair.position.set(2,2,0);hairTail.position.y=-.2;hand.position.set(.1,.5,0);
  const collider=new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({radius:.2}));hand.add(collider);
  const group={colliders:[collider]},manager=new VRMSpringBoneManager();
  const skirtJoint=new VRMSpringBoneJoint(hem,tail,{hitRadius:0,stiffness:1,gravityPower:0});
  const hairJoint=new VRMSpringBoneJoint(hair,hairTail,{gravityPower:0},[group]);manager.addJoint(skirtJoint);manager.addJoint(hairJoint);
  scene.updateMatrixWorld(true);
  const vrm={scene,springBoneManager:manager,humanoid:{getRawBoneNode:(name:string)=>name==="leftHand"?hand:null}} as unknown as VRM;
  return {vrm,manager,skirtJoint,hairJoint,group,tail,hand};
}

it("uses authored hand collisions to keep a skirt tail outside the hand",()=>{
  const f=fixture();expect(connectGarmentCollisions(f.vrm)).toEqual({joints:1,addedGroups:1});
  f.manager.setInitState();
  for(let i=0;i<30;i++)f.manager.update(1/60);
  f.vrm.scene.updateMatrixWorld(true);
  expect(f.tail.getWorldPosition(new THREE.Vector3()).distanceTo(f.hand.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(.19);
  expect(f.hairJoint.colliderGroups).toEqual([f.group]);
});
it("is idempotent and leaves unrecognized clothing rigs untouched",()=>{
 const f=fixture();connectGarmentCollisions(f.vrm);expect(connectGarmentCollisions(f.vrm)).toEqual({joints:0,addedGroups:0});
 const unknown=fixture();unknown.skirtJoint.bone.name="custom-cloth";
 expect(connectGarmentCollisions(unknown.vrm)).toEqual({joints:0,addedGroups:0});expect(unknown.skirtJoint.colliderGroups).toEqual([]);
});

it("dissipates a garment impulse while retaining simulated movement and hair settings",()=>{
 const movement=(damped:boolean)=>{
  const f=fixture();f.skirtJoint.settings.dragForce=.05;
  const hairSettings={...f.hairJoint.settings};
  connectGarmentCollisions(f.vrm);
  if(!damped)f.skirtJoint.settings.dragForce=.05;
  expect(f.hairJoint.settings).toEqual(hairSettings);
  f.manager.setInitState();
  for(let i=0;i<90;i++)f.manager.update(1/60);
  f.vrm.scene.updateMatrixWorld(true);
  f.vrm.scene.position.x=.25;f.vrm.scene.updateMatrixWorld(true);
  let previous=f.tail.getWorldPosition(new THREE.Vector3()),distance=0;
  for(let i=0;i<90;i++){
   f.manager.update(1/60);f.vrm.scene.updateMatrixWorld(true);
   const current=f.tail.getWorldPosition(new THREE.Vector3());
   if(i>=15)distance+=current.distanceTo(previous);
   previous=current;
  }
  return distance;
 };
 const original=movement(false),damped=movement(true);
 expect(damped).toBeGreaterThan(0);
 expect(damped).toBeLessThan(original*.6);
});
