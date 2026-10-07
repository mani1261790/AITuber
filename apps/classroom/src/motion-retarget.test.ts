import {expect,it} from "vitest";
import * as THREE from "three";
import type {VRM} from "@pixiv/three-vrm";
import {retargetMotion,applyHandPose} from "./motion-retarget.ts";

it("preserves animated parent travel through the last sample without mutating source tracks",()=>{
 const source=new THREE.Group(),root=new THREE.Bone(),pelvis=new THREE.Bone();root.name="root";pelvis.name="pelvis";pelvis.position.y=1;source.add(root);root.add(pelvis);
 const target=new THREE.Bone();target.name="NormalizedHips";target.position.y=2;
 const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>name==="hips"?target:null}} as unknown as VRM;
 const track=new THREE.VectorKeyframeTrack("root.position",[0,1.333333373],[0,0,0,0,0,1.3]);
 const original=Array.from(track.values);const clip=new THREE.AnimationClip("walk",1.333333373,[track]);
 const result=retargetMotion(source,clip,vrm);
 expect(result.displacement.z).toBeCloseTo(2.6,4);
 expect(result.clip.tracks.at(-1)!.values.at(-1)).toBeCloseTo(2.6,4);
 expect(Array.from(track.values)).toEqual(original);
 expect(root.position.z).toBe(0);
 const repeat=retargetMotion(source,clip,vrm);expect(repeat.displacement.z).toBeCloseTo(2.6,4);
});
it("keeps the index extended while curling the other fingers",()=>{
 const index=new THREE.Bone(),middle=new THREE.Bone();
 const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>name==="rightIndexProximal"?index:name==="rightMiddleProximal"?middle:null}} as unknown as VRM;
 applyHandPose(vrm,"point","right",1);
 const identity=new THREE.Quaternion();expect(index.quaternion.angleTo(identity)).toBeLessThan(.05);expect(middle.quaternion.angleTo(identity)).toBeGreaterThan(1);
 applyHandPose(vrm,"open","right",1);expect(middle.quaternion.angleTo(identity)).toBeCloseTo(.12);
});

it("retargets centimeter-scale Mixamo FBX bones including fingers",()=>{
 const source=new THREE.Group(),hips=new THREE.Bone(),hand=new THREE.Bone(),finger=new THREE.Bone();
 hips.name="mixamorigHips";hips.position.y=100;hand.name="mixamorigRightHand";finger.name="mixamorigRightHandIndex1";
 source.add(hips);hips.add(hand);hand.add(finger);
 const targetHips=new THREE.Bone(),targetHand=new THREE.Bone(),targetFinger=new THREE.Bone();
 targetHips.name="hips";targetHips.position.y=1;targetHand.name="hand";targetFinger.name="finger";targetHips.add(targetHand);targetHand.add(targetFinger);
 const nodes={hips:targetHips,rightHand:targetHand,rightIndexProximal:targetFinger};
 const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]??null}} as unknown as VRM;
 const clip=new THREE.AnimationClip("point",1,[new THREE.VectorKeyframeTrack("mixamorigHips.position",[0,1],[0,100,0,0,100,100]),new THREE.QuaternionKeyframeTrack("mixamorigRightHandIndex1.quaternion",[0,1],[0,0,0,1,0,0,Math.sin(.3),Math.cos(.3)])]);
 const result=retargetMotion(source,clip,vrm);
 expect(result.bones).toBe(3);expect(result.displacement.z).toBeCloseTo(1);
 const track=result.clip.tracks.find(t=>t.name==="finger.quaternion")!;
 expect(track.values.at(-2)).toBeCloseTo(Math.sin(.3));
});


it("keeps open hands softly curved with increasing curl toward the little finger on both sides",()=>{
 for(const side of ["left","right"] as const){
  const nodes:Record<string,THREE.Bone>={};
  for(const finger of ["Index","Middle","Ring","Little"])nodes[side+finger+"Proximal"]=new THREE.Bone();
  const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
  applyHandPose(vrm,"open",side,1);
  const angles=Object.values(nodes).map(b=>b.rotation.z*(side==="left"?1:-1));
  expect(angles[0]).toBeGreaterThan(0);expect(angles.at(-1)).toBeLessThan(.3);
  for(let i=1;i<angles.length;i++)expect(angles[i]).toBeGreaterThan(angles[i-1]!);
 }
});

it("folds non-pointing fingertips back toward the palm on either hand",()=>{
 for(const side of ["left","right"] as const){
  const sign=side==="left"?1:-1, nodes:Record<string,THREE.Bone>={};
  const root=new THREE.Group();
  for(const finger of ["Index","Middle","Ring","Little"]){
   let parent:THREE.Object3D=root;
   for(const [i,part] of ["Proximal","Intermediate","Distal"].entries()){
    const bone=new THREE.Bone();bone.position.x=i===0?0:sign*(i===1?.035:.025);
    parent.add(bone);nodes[side+finger+part]=bone;parent=bone;
   }
  }
  const vrm={humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
  applyHandPose(vrm,"point",side,1);root.updateMatrixWorld(true);
  const tip=(finger:string)=>nodes[side+finger+"Distal"]!.localToWorld(new THREE.Vector3(sign*.02,0,0));
  expect(tip("Index").x*sign).toBeGreaterThan(.075);
  for(const finger of ["Middle","Ring","Little"]){
   expect(tip(finger).x*sign).toBeLessThan(.01);
   expect(tip(finger).length()).toBeLessThan(.06);
  }
 }
});
