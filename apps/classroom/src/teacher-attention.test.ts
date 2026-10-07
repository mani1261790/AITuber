import { expect, it } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { applyTeacherAttention } from "./teacher-attention.ts";

it("shares a bounded turn between torso, neck and head and follows lower targets",()=>{
 const scene=new THREE.Group(),chest=new THREE.Bone(),neck=new THREE.Bone(),head=new THREE.Bone();scene.add(chest);chest.add(neck);neck.add(head);head.position.y=2;
 const nodes={chest,neck,head};const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]}} as unknown as VRM;
 applyTeacherAttention(vrm,new THREE.Vector3(-3,1,-1),1);
 expect(chest.rotation.y).toBeLessThan(0);expect(neck.rotation.y).toBeLessThan(0);expect(head.rotation.y).toBeLessThan(0);
 expect(Math.abs(head.rotation.y)).toBeLessThan(.6);expect(head.rotation.x).toBeGreaterThan(0);
 const q=head.quaternion.clone();applyTeacherAttention(vrm,new THREE.Vector3(3,4,0),0);expect(head.quaternion.angleTo(q)).toBeLessThan(.00001);
});

it("aims eyes relative to a turned head and bounds extreme board targets", async () => {
 const {applyTeacherGaze}=await import("./teacher-attention.ts");
 const scene=new THREE.Group(),head=new THREE.Bone(),leftEye=new THREE.Bone(),rightEye=new THREE.Bone();
 scene.add(head);head.add(leftEye,rightEye);head.position.y=2;head.rotation.y=.6;
 leftEye.position.x=.03;rightEye.position.x=-.03;
 const nodes={head,leftEye,rightEye};
 const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]}} as unknown as VRM;
 scene.updateMatrixWorld(true);
 const forward=new THREE.Vector3(0,0,10).applyQuaternion(head.quaternion).add(head.position);
 applyTeacherGaze(vrm,forward);
 expect(Math.abs(leftEye.rotation.y)).toBeLessThan(.01);
 expect(Math.abs(rightEye.rotation.y)).toBeLessThan(.01);
 applyTeacherGaze(vrm,new THREE.Vector3(-10,-4,-4));
 expect(leftEye.rotation.y).toBeCloseTo(-.18);
 expect(leftEye.rotation.x).toBeCloseTo(.14);
});

it("turns the torso towards either board side while keeping the pelvis planted",()=>{
 for(const side of [-1,1]){
  const scene=new THREE.Group();const nodes:Record<string,THREE.Bone>={};let parent:THREE.Object3D=scene;
  for(const name of ["hips","spine","chest","upperChest","neck","head"]){const bone=new THREE.Bone();parent.add(bone);nodes[name]=bone;parent=bone;}
  nodes.hips!.position.y=1;
  const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]}} as unknown as VRM;
  applyTeacherAttention(vrm,new THREE.Vector3(side*4,1,-1),1);scene.updateMatrixWorld(true);
  expect(nodes.hips!.rotation.y).toBe(0);
  const torso=new THREE.Euler().setFromQuaternion(nodes.upperChest!.getWorldQuaternion(new THREE.Quaternion()),"YXZ");
  const head=new THREE.Euler().setFromQuaternion(nodes.head!.getWorldQuaternion(new THREE.Quaternion()),"YXZ");
  expect(torso.y*side).toBeGreaterThan(.5);expect(torso.y*side).toBeLessThan(.6);
  expect(head.y*side).toBeCloseTo(1.15);
  expect(Math.abs(nodes.head!.rotation.y)).toBeLessThan(.45);
 }
});

it("does not add another turn when the authored head already faces the target",()=>{
 const scene=new THREE.Group(),chest=new THREE.Bone(),neck=new THREE.Bone(),head=new THREE.Bone();
 scene.rotation.y=.4;scene.add(chest);chest.add(neck);neck.add(head);head.position.y=2;
 chest.rotation.y=.2;neck.rotation.y=.1;head.rotation.set(.12,.3,0,"YXZ");
 const nodes={chest,neck,head};const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]}} as unknown as VRM;
 scene.updateMatrixWorld(true);
 const target=new THREE.Vector3(0,0,5).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).add(head.getWorldPosition(new THREE.Vector3()));
 const before=Object.values(nodes).map(b=>b.quaternion.clone());
 applyTeacherAttention(vrm,target,1);
 Object.values(nodes).forEach((b,i)=>expect(b.quaternion.angleTo(before[i]!)).toBeLessThan(1e-7));
});

it("looks ahead at head height during either walking direction, and returns to the audience at rest",async()=>{
 const {teacherGazeTarget,applyTeacherGaze}=await import("./teacher-attention.ts");
 for(const yaw of [-Math.PI/2,Math.PI/2]){
  const scene=new THREE.Group(),head=new THREE.Bone(),leftEye=new THREE.Bone(),rightEye=new THREE.Bone();
  scene.position.set(2,-.5,.6);scene.rotation.y=yaw;
  scene.add(head);head.position.y=2.5;head.add(leftEye,rightEye);
  leftEye.position.x=.03;rightEye.position.x=-.03;
  const nodes={head,leftEye,rightEye};
  const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]??null}} as unknown as VRM;
  const target=teacherGazeTarget(vrm,true),origin=head.getWorldPosition(new THREE.Vector3());
  expect(target.y).toBeCloseTo(origin.y);
  expect(target.clone().sub(origin).normalize().x).toBeCloseTo(Math.sign(yaw));
  applyTeacherGaze(vrm,target);
  expect(Math.abs(leftEye.rotation.y)).toBeLessThan(.01);
  expect(Math.abs(rightEye.rotation.y)).toBeLessThan(.01);
  expect(teacherGazeTarget(vrm,false).toArray()).toEqual([-.9,2.4,8]);
  const camera=new THREE.Vector3(3,3,7);
  const cameraTarget=teacherGazeTarget(vrm,false,camera);
  expect(cameraTarget.toArray()).toEqual(camera.toArray());
  cameraTarget.set(0,0,0);expect(camera.toArray()).toEqual([3,3,7]);
  expect(teacherGazeTarget(vrm,true,camera).toArray()).toEqual(target.toArray());
 }
});
