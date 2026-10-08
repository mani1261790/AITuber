import {expect,it} from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {FootContact,solveLeg} from "./foot-contact.ts";
it("places the foot without stretching bones or twisting the ankle",()=>{
 const root=new THREE.Group(),hip=new THREE.Bone(),knee=new THREE.Bone(),foot=new THREE.Bone();root.add(hip);hip.add(knee);knee.add(foot);hip.position.y=2;knee.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);root.updateMatrixWorld(true);
 const rotation=foot.getWorldQuaternion(new THREE.Quaternion()),target=new THREE.Vector3(-.25,.25,.1);
 solveLeg(root,hip,knee,foot,target);root.updateMatrixWorld(true);
 expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(.001);
 expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation)).toBeLessThan(.001);
 expect(knee.position.length()).toBeCloseTo(Math.hypot(.9,.2));expect(foot.position.length()).toBeCloseTo(Math.hypot(.9,.2));
});

it("holds a reachable support foot and releases continuously when travel stops",()=>{
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();root.add(upper);upper.add(lower);lower.add(foot);upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;}
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm),foot=nodes.leftFoot!;root.updateMatrixWorld(true);const start=foot.getWorldPosition(new THREE.Vector3());
 for(let i=0;i<60;i++){Object.values(nodes).forEach(b=>b.quaternion.identity());root.position.x=i*.002;contact.apply(1/60,true);}
 root.updateMatrixWorld(true);expect(Math.abs(foot.getWorldPosition(new THREE.Vector3()).x-start.x)).toBeLessThan(.01);
 let previous=foot.getWorldPosition(new THREE.Vector3());
 for(let i=0;i<60;i++){Object.values(nodes).forEach(b=>b.quaternion.identity());contact.apply(1/60,false);root.updateMatrixWorld(true);const current=foot.getWorldPosition(new THREE.Vector3());expect(current.distanceTo(previous)).toBeLessThan(.015);previous=current;}
 expect(previous.x).toBeCloseTo(start.x+root.position.x,2);
});

it("releases a forward swing even while the foot is still close to the floor",()=>{
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();root.add(upper);upper.add(lower);lower.add(foot);upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;}
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm);let authored=new THREE.Vector3();
 for(let i=0;i<120;i++){
  Object.values(nodes).forEach(b=>b.quaternion.identity());
  if(i>=60)nodes.leftUpperLeg!.rotation.x=-(i-59)*.002;
  root.updateMatrixWorld(true);authored=nodes.leftFoot!.getWorldPosition(new THREE.Vector3());
  contact.apply(1/60,true);
 }
 root.updateMatrixWorld(true);
 const lifted=nodes.leftFoot!.getWorldPosition(new THREE.Vector3());
 expect(Math.hypot(lifted.x-authored.x,lifted.z-authored.z)).toBeLessThan(.005);
 expect(lifted.y-authored.y).toBeGreaterThan(.003);
 expect(lifted.y-authored.y).toBeLessThan(.02);
 let previous=lifted;
 for(let i=0;i<90;i++){
  Object.values(nodes).forEach(b=>b.quaternion.identity());
  nodes.leftUpperLeg!.rotation.x=-.12;
  root.updateMatrixWorld(true);authored=nodes.leftFoot!.getWorldPosition(new THREE.Vector3());
  contact.apply(1/60,false);root.updateMatrixWorld(true);
  const current=nodes.leftFoot!.getWorldPosition(new THREE.Vector3());
  expect(current.distanceTo(previous)).toBeLessThan(.04);previous=current;
 }
 expect(previous.distanceTo(authored)).toBeLessThan(.001);
});

it("keeps the knee bending forwards when a nearly straight source pose changes sign",()=>{
 for(const epsilon of [-.000001,.000001]){
  const root=new THREE.Group(),hip=new THREE.Bone(),knee=new THREE.Bone(),foot=new THREE.Bone();root.add(hip);hip.add(knee);knee.add(foot);hip.position.y=2;knee.position.set(0,-1,epsilon);foot.position.set(0,-1,-epsilon);
  solveLeg(root,hip,knee,foot,new THREE.Vector3(.1,.2,0));root.updateMatrixWorld(true);
  expect(knee.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(.2);
 }
});

it("preserves a clearly bent authored knee plane when the ankle needs no correction",()=>{
 for(const rootYaw of [0,.7,-1.2]){
  const root=new THREE.Group(),hip=new THREE.Bone(),knee=new THREE.Bone(),foot=new THREE.Bone();
  root.rotation.y=rootYaw;root.add(hip);hip.add(knee);knee.add(foot);
  hip.position.y=2;knee.position.set(.25,-.85,.25);foot.position.set(-.25,-.85,-.25);
  root.updateMatrixWorld(true);
  const original=knee.getWorldPosition(new THREE.Vector3()),target=foot.getWorldPosition(new THREE.Vector3());
  solveLeg(root,hip,knee,foot,target);root.updateMatrixWorld(true);
  expect(knee.getWorldPosition(new THREE.Vector3()).distanceTo(original)).toBeLessThan(.001);
 }
});

it("lowers the pelvis smoothly to keep planted feet reachable without freezing ankle roll",()=>{
 const root=new THREE.Group(),hips=new THREE.Bone(),nodes:Record<string,THREE.Bone>={hips};root.add(hips);
 for(const side of ["left","right"]){const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();hips.add(upper);upper.add(lower);lower.add(foot);upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;}
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm),foot=nodes.leftFoot!;
 root.updateMatrixWorld(true);const start=foot.getWorldPosition(new THREE.Vector3());let previous=0;
 for(let i=0;i<150;i++){
  hips.position.y=0;Object.values(nodes).forEach(b=>b.quaternion.identity());root.position.x=Math.min(i/100,1)*.4;foot.rotation.x=Math.min(i/100,1)*.2;
  root.updateMatrixWorld(true);const rotation=foot.getWorldQuaternion(new THREE.Quaternion());
  contact.apply(1/60,true);root.updateMatrixWorld(true);
  expect(Math.abs(hips.position.y-previous)).toBeLessThan(.01);previous=hips.position.y;
  expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation)).toBeLessThan(.001);
 }
 expect(hips.position.y).toBeLessThan(-.001);
 expect(hips.position.y).toBeGreaterThan(-.01);
 expect(contact.supportState.every(state=>state.reachRatio!<1)).toBe(true);
 const end=foot.getWorldPosition(new THREE.Vector3());expect(Math.hypot(end.x-start.x,end.z-start.z)).toBeLessThan(.005);
 // Both feet begin toe-off while their horizontal anchors still have weight.
 // The pelvis must keep supporting those anchors rather than pop up immediately.
 hips.position.y=0;Object.values(nodes).forEach(b=>b.quaternion.identity());
 nodes.leftFoot!.position.z+=.02;nodes.rightFoot!.position.z+=.02;
 contact.apply(1/60,true);
 expect(contact.supportState.every(state=>!state.planted&&state.weight>.99)).toBe(true);
 expect(Math.abs(hips.position.y-previous)).toBeLessThan(.003);previous=hips.position.y;
 for(let i=0;i<90;i++){
  hips.position.y=0;Object.values(nodes).forEach(b=>b.quaternion.identity());foot.rotation.x=.2;
  contact.apply(1/60,false);
  expect(Math.abs(hips.position.y-previous)).toBeLessThan(.003);previous=hips.position.y;
 }
 expect(hips.position.y).toBeCloseTo(0,5);
});

it("stabilizes a calibrated shoe without raising its lowest contact point, then releases into the authored pose",()=>{
 const root=new THREE.Group();root.scale.setScalar(1.6);
 const nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
  root.add(upper);upper.add(lower);lower.add(foot);
  upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.35);foot.position.set(0,-.9,-.35);
  nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;
 }
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm);
 const sole=[new THREE.Vector3(0,-.1,-.16),new THREE.Vector3(0,-.1,.24)];
 root.updateMatrixWorld(true);
 contact.setSolePoints(["leftFoot","rightFoot"].map(name=>sole.map(p=>nodes[name]!.localToWorld(p.clone()))));
 const foot=nodes.leftFoot!;
 const supportZ=foot.localToWorld(sole[1]!.clone()).z;
 const height=()=>Math.min(...sole.map(p=>foot.localToWorld(p.clone()).y));
 for(let i=0;i<120;i++){
  Object.values(nodes).forEach(b=>b.quaternion.identity());
  foot.rotation.x=Math.min(i/60,1)*.25;
  root.updateMatrixWorld(true);const originalHeight=height();
  contact.apply(1/60,true);root.updateMatrixWorld(true);
  expect(height()).toBeCloseTo(originalHeight,4);
  if(i>60)expect(foot.localToWorld(sole[1]!.clone()).z).toBeCloseTo(supportZ,4);
 }
 expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(.08);
 for(let i=0;i<120;i++){
  Object.values(nodes).forEach(b=>b.quaternion.identity());foot.rotation.x=.25;
  contact.apply(1/60,false);
 }
 expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeCloseTo(.25,4);
});




it("releases pivot anchors gradually before acquiring walking support",()=>{
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
  root.add(upper);upper.add(lower);lower.add(foot);upper.position.set(side==="left"?-.15:.15,2,0);
  lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);
  nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;
 }
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm),foot=nodes.leftFoot!;
 const tick=(turning:boolean)=>{Object.values(nodes).forEach(b=>b.quaternion.identity());contact.apply(1/60,true,turning);root.updateMatrixWorld(true);return foot.getWorldPosition(new THREE.Vector3());};
 for(let i=0;i<60;i++){root.position.x=i*.001;tick(true);}
 const before=foot.getWorldPosition(new THREE.Vector3()),after=tick(false);
 expect(after.distanceTo(before)).toBeLessThan(.025);
 expect(contact.supportState[0]!.planted).toBe(false);
 for(let i=0;i<60;i++)tick(false);
 expect(contact.supportState[0]!.planted).toBe(true);
 expect(foot.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(-.15+root.position.x,2);
});


it.each([false,true])("eases out of a planted foot when the authored swing lifts it (turning=%s)", (turning) => {
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
  root.add(upper);upper.add(lower);lower.add(foot);
  upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);
  nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;
 }
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm);
 const tick=(swing:boolean)=>{
  Object.values(nodes).forEach(bone=>bone.quaternion.identity());
  if(swing)nodes.leftUpperLeg!.rotation.x=-.6;
  contact.apply(1/60,true,turning);return contact.supportState[0]!
 };
 for(let i=0;i<60;i++)tick(false);
 expect(contact.supportState[0]!.weight).toBeGreaterThan(.99);
 const first=tick(true);
 expect(first.planted).toBe(false);
 expect(first.weight).toBeGreaterThan(.98);
 let previous=first.weight;
 for(let i=0;i<(turning?26:24);i++){
  const current=tick(true).weight;
  // A walking foot must be free by mid-swing, rather than dragging its old anchor.
  if(!turning && i===11)expect(current).toBeLessThan(.001);
  expect(current).toBeGreaterThanOrEqual(0);expect(current).toBeLessThanOrEqual(previous);expect(previous-current).toBeLessThan(turning?.08:.20);previous=current;
 }
 expect(previous).toBeLessThan(.001);
});

it("releases a lifted pivot foot before the walking lift threshold",()=>{
 for(const turning of [false,true]){
  const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
  for(const side of ["left","right"]){
   const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
   root.add(upper);upper.add(lower);lower.add(foot);
   upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);
   nodes[`${side}UpperLeg`]=upper;nodes[`${side}LowerLeg`]=lower;nodes[`${side}Foot`]=foot;
  }
  const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
  const contact=new FootContact(vrm);
  for(let i=0;i<60;i++){
   Object.values(nodes).forEach(bone=>bone.quaternion.identity());contact.apply(1/60,true,turning);
  }
  Object.values(nodes).forEach(bone=>bone.quaternion.identity());nodes.leftUpperLeg!.position.y+=.06;
  contact.apply(1/60,true,turning);
  expect(contact.supportState[0]!.planted).toBe(!turning);
  expect(contact.supportState[0]!.weight).toBeGreaterThan(.98);
 }
});

it.each(["left","right"] as const)("keeps the %s toe pivot in place while turning without locking rotation",(side)=>{
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();root.add(upper);upper.add(lower);lower.add(foot);
  upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);
  nodes[side+"UpperLeg"]=upper;nodes[side+"LowerLeg"]=lower;nodes[side+"Foot"]=foot;
 }
 root.updateMatrixWorld(true);
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm);
 contact.setSolePoints(["left","right"].map(side=>[-.1,.25].map(z=>nodes[side+"Foot"]!.localToWorld(new THREE.Vector3(0,-.1,z)))));
 for(let i=0;i<60;i++){Object.values(nodes).forEach(b=>b.quaternion.identity());contact.apply(1/60,true,true);}
 const sign=side==="left"?-1:1;
 const foot=nodes[side+"Foot"]!,before=foot.localToWorld(new THREE.Vector3(0,-.1,.25));
 for(let i=1;i<=30;i++){
  Object.values(nodes).forEach(b=>b.quaternion.identity());foot.rotation.y=sign*.3*i/30;
  contact.apply(1/60,true,true);root.updateMatrixWorld(true);
 }
 const after=foot.localToWorld(new THREE.Vector3(0,-.1,.25));
 expect(Math.hypot(after.x-before.x,after.z-before.z)).toBeLessThan(.005);
 expect(new THREE.Euler().setFromQuaternion(foot.getWorldQuaternion(new THREE.Quaternion())).y).toBeCloseTo(sign*.3);
 // The toe may remain on its original side while the corrected ankle would cross the body.
 Object.values(nodes).forEach(b=>b.quaternion.identity());foot.rotation.y=sign*.9;
 contact.apply(1/60,true,true);
 expect(contact.supportState[side==="left"?0:1]!.planted).toBe(false);
 expect(contact.supportState[side==="left"?0:1]!.reason).toBe("crossing");
 expect(contact.supportState[side==="left"?0:1]!.weight).toBeGreaterThan(.98);
});

it("starts releasing a pivot anchor before root rotation carries it across the body",()=>{
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();root.add(upper);upper.add(lower);lower.add(foot);
  upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);
  nodes[side+"UpperLeg"]=upper;nodes[side+"LowerLeg"]=lower;nodes[side+"Foot"]=foot;
 }
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm);
 for(let i=0;i<60;i++){Object.values(nodes).forEach(b=>b.quaternion.identity());contact.apply(1/60,true,true);}
 expect(contact.supportState.every(s=>s.planted&&s.weight>.99)).toBe(true);
 Object.values(nodes).forEach(b=>b.quaternion.identity());root.rotation.y=1;
 contact.apply(1/60,true,true);
 for(const state of contact.supportState){expect(state.planted).toBe(false);expect(state.reason).toBe("crossing");expect(state.weight).toBeGreaterThan(.98);}
});

it("pivots on the grounded heel when the authored toe is raised",()=>{
 const root=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
 for(const side of ["left","right"]){
  const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();root.add(upper);upper.add(lower);lower.add(foot);
  upper.position.set(side==="left"?-.15:.15,2,0);lower.position.set(0,-.9,.2);foot.position.set(0,-.9,-.2);
  nodes[side+"UpperLeg"]=upper;nodes[side+"LowerLeg"]=lower;nodes[side+"Foot"]=foot;
 }
 root.updateMatrixWorld(true);
 const vrm={scene:root,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
 const contact=new FootContact(vrm),heel=new THREE.Vector3(0,-.1,-.1);
 contact.setSolePoints(["left","right"].map(side=>[heel,new THREE.Vector3(0,-.1,.25)].map(p=>nodes[side+"Foot"]!.localToWorld(p.clone()))));
 const foot=nodes.leftFoot!;
 const pose=(yaw:number)=>{Object.values(nodes).forEach(b=>b.quaternion.identity());foot.rotation.set(-.3,yaw,0,"YXZ");};
 for(let i=0;i<60;i++){pose(0);contact.apply(1/60,true,true);}
 const before=foot.localToWorld(heel.clone());
 for(let i=1;i<=30;i++){pose(-.3*i/30);contact.apply(1/60,true,true);}
 const after=foot.localToWorld(heel.clone());
 expect(contact.supportState[0]!.planted).toBe(true);
 expect(Math.hypot(after.x-before.x,after.z-before.z)).toBeLessThan(.005);
 expect(new THREE.Euler().setFromQuaternion(foot.getWorldQuaternion(new THREE.Quaternion()),"YXZ").y).toBeCloseTo(-.3);
});

it("reduces outward knee bend while preserving the foot target and bone lengths",()=>{
 for(const sign of [-1,1]){
  const root=new THREE.Group(),upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
  root.add(upper);upper.add(lower);lower.add(foot);upper.position.set(sign*.2,2,0);lower.position.set(sign*.3,-.8,.3);foot.position.set(-sign*.3,-.8,-.3);
  root.updateMatrixWorld(true);const target=foot.getWorldPosition(new THREE.Vector3()),initial=lower.getWorldPosition(new THREE.Vector3());
  const a=lower.position.length(),b=foot.position.length();
  solveLeg(root,upper,lower,foot,target,.35);root.updateMatrixWorld(true);
  expect(Math.abs(lower.getWorldPosition(new THREE.Vector3()).x-upper.position.x)).toBeLessThan(Math.abs(initial.x-upper.position.x)*.6);
  expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6);
  expect(lower.position.length()).toBeCloseTo(a);expect(foot.position.length()).toBeCloseTo(b);
 }
});
