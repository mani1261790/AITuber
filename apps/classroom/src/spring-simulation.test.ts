import { expect, it } from "vitest";
import * as THREE from "three";
import { VRMSpringBoneManager, VRMSpringBoneJoint } from "@pixiv/three-vrm";
import { SpringSimulation } from "./spring-simulation.ts";

function simulate(fps: number, fixed: boolean) {
 const root=new THREE.Group(),bone=new THREE.Bone(),tail=new THREE.Bone();
 root.add(bone);bone.add(tail);bone.position.y=1;tail.position.y=-.5;
 root.updateMatrixWorld(true);
 const manager=new VRMSpringBoneManager();
 manager.addJoint(new VRMSpringBoneJoint(bone,tail,{stiffness:.5,dragForce:.25,gravityPower:0}));
 manager.setInitState();
 root.position.x=.25;root.updateMatrixWorld(true);
 const clock=new SpringSimulation();
 for(let i=0;i<fps*.5;i++) {
  if(fixed)clock.update(1/fps,dt=>manager.update(dt));else manager.update(1/fps);
 }
 root.updateMatrixWorld(true);
 return tail.getWorldPosition(new THREE.Vector3());
}

it("keeps a real spring impulse consistent at 30, 60 and 120 render fps",()=>{
 const values=[30,60,120].map(fps=>simulate(fps,true));
 for(const value of values)expect(value.distanceTo(values[0]!)).toBeLessThan(1e-7);
 // The library's per-render-frame update demonstrably changes this same response.
 expect(simulate(30,false).distanceTo(simulate(120,false))).toBeGreaterThan(.001);
});
it("limits catch-up after suspension and keeps fractional frame time",()=>{
 const clock=new SpringSimulation();let steps=0;
 const tick=()=>{steps++;};
 clock.update(1/120,tick);expect(steps).toBe(0);
 clock.update(1/120,tick);expect(steps).toBe(1);
 clock.update(10,tick);expect(steps).toBe(3);
 clock.update(0,tick);clock.update(-1,tick);expect(steps).toBe(3);
});

it("interpolates the rendered spring pose without feeding it into the fixed solver",()=>{
 const bone=new THREE.Bone(),clock=new SpringSimulation([bone]);
 const inputs:number[]=[],shown:number[]=[];
 for(let i=0;i<12;i++){
  clock.update(1/120,()=>{inputs.push(bone.rotation.z);bone.rotation.z+=.1;});
  shown.push(bone.rotation.z);
 }
 inputs.forEach((value,i)=>expect(value).toBeCloseTo(i*.1,8));
 // After the initial one-step presentation delay, even non-physics frames move.
 for(let i=2;i<shown.length;i++)expect(shown[i]!-shown[i-1]!).toBeCloseTo(.05,8);
 expect(shown.at(-1)).toBeCloseTo(.5,8);
});

it("shows the same interpolated spring pose at shared times across render rates",()=>{
 const values=[30,60,120].map(fps=>{
  const bone=new THREE.Bone(),clock=new SpringSimulation([bone]);
  for(let i=0;i<fps;i++)clock.update(1/fps,()=>{bone.rotation.z+=.01;});
  return bone.rotation.z;
 });
 values.forEach(value=>expect(value).toBeCloseTo(.59,8));
});

it("preserves a real two-joint spring simulation while rendering between physics steps",()=>{
 const run=(fps:number)=>{
  const root=new THREE.Group(),bone=new THREE.Bone(),middle=new THREE.Bone(),tail=new THREE.Bone();
  root.add(bone);bone.add(middle);middle.add(tail);bone.position.y=1;middle.position.y=-.3;tail.position.y=-.3;
  root.updateMatrixWorld(true);
  const manager=new VRMSpringBoneManager();
  manager.addJoint(new VRMSpringBoneJoint(bone,middle,{stiffness:.5,dragForce:.25,gravityPower:0}));
  manager.addJoint(new VRMSpringBoneJoint(middle,tail,{stiffness:.5,dragForce:.25,gravityPower:0}));
  manager.setInitState();
  const clock=new SpringSimulation([bone,middle]),poses:THREE.Vector3[]=[];
  for(let i=0;i<fps;i++){
   clock.update(1/fps,dt=>{
    root.position.x=Math.sin(poses.length*.08)*.25;
    root.updateMatrixWorld(true);manager.update(dt);
    poses.push(tail.getWorldPosition(new THREE.Vector3()));
   });
   // The renderer sees interpolated bones and updates the scene matrices too.
   root.updateMatrixWorld(true);
  }
  return poses;
 };
 const a=run(60),b=run(120);expect(a).toHaveLength(60);expect(b).toHaveLength(60);
 a.forEach((point,i)=>expect(point.distanceTo(b[i]!)).toBeLessThan(1e-7));
});
