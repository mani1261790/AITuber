import { expect, it } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { removeHorizontalTravel, TeacherMotion, walkPlaybackRate } from "./teacher-motion.ts";

it("extracts net travel but retains lateral and forward weight shifts without mutating the source", () => {
  const original = new THREE.AnimationClip("walk", 1, [new THREE.VectorKeyframeTrack("hips.position", [0, .5, 1], [.1, 1, .2, .45, 1.1, .9, .5, 1, 1.4])]);
  const clip = removeHorizontalTravel(original);
  [.1,1,.2,.25,1.1,.3,.1,1,.2].forEach((value,index)=>expect(clip.tracks[0]!.values[index]).toBeCloseTo(value));
  expect(original.tracks[0]!.values[8]).toBeCloseTo(1.4);
});

it("matches foot cycle time to actual world distance, including a scaled teacher", () => {
  const distance = 1.4 * 1.8, duration = 1.33, speed = 1.15;
  const rate = walkPlaybackRate(speed, distance, duration);
  expect(rate * distance / duration).toBeCloseTo(speed);
  expect(walkPlaybackRate(0, distance, duration)).toBe(0);
});

it("blends out walking and avoids toggling between talk and idle on every mouth closure", () => {
  const scene = new THREE.Group(), hips = new THREE.Bone(); hips.name = "hips"; scene.add(hips);
  const vrm = { scene, humanoid: { update() {}, getNormalizedBoneNode() { return null; } } } as unknown as VRM;
  const clip = (name: string, y: number) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack("hips.position", [0, 1], [0, y, 0, 0, y, 1])]);
  const controller = new TeacherMotion(vrm, clip("idle", 1), clip("talk", 1.1), clip("walk", 1.2), 1);
  const input = { speed: 0, moving: false, speaking: true, target: null, side: "right" as const, reducedMotion: false };
  controller.update(.05, input); expect(controller.state).toBe("talk");
  controller.update(.05, { ...input, speaking: false }); expect(controller.state).toBe("talk");
  controller.update(.05, { ...input, moving: true, speed: 1 }); expect(controller.state).toBe("walk");
  const before = hips.position.y;
  controller.update(.01, { ...input, speaking: false });
  expect(Math.abs(hips.position.y - before)).toBeLessThan(.03);
  expect(hips.position.z).toBe(0);
  controller.update(1/60,{...input,gesture:"listen"});
  expect(controller.state).toBe("talk");
  for(let i=0;i<60;i++)controller.update(1/60,{...input,speaking:false,gesture:"listen"});
  expect(controller.state).toBe("listen");
  controller.dispose();
});

it("starts a nod with speech and performs it once instead of periodically", () => {
  const scene=new THREE.Group(),head=new THREE.Bone();head.name="head";scene.add(head);
  const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>name==="head"?head:null}} as unknown as VRM;
  const clip=(name:string)=>new THREE.AnimationClip(name,2,[new THREE.QuaternionKeyframeTrack("head.quaternion",[0,2],[0,0,0,1,0,0,0,1])]);
  const controller=new TeacherMotion(vrm,clip("idle"),clip("talk"),clip("walk"),1);
  const input={speed:0,moving:false,speaking:false,target:null,side:"right" as const,reducedMotion:false,gesture:"nod" as const,actionId:"beat-1"};
  for(let i=0;i<40;i++)controller.update(.05,input);
  expect(head.rotation.x).toBeCloseTo(0);
  expect(controller.acknowledgementStrength).toBe(0);
  for(let i=0;i<36;i++)controller.update(1/60,{...input,speaking:true});
  expect(head.rotation.x).toBeGreaterThan(.15);
  expect(controller.acknowledgementStrength).toBeGreaterThan(.99);
  for(let i=0;i<180;i++)controller.update(1/60,{...input,speaking:true});
  expect(head.rotation.x).toBeCloseTo(0);
  expect(controller.acknowledgementStrength).toBe(0);
  controller.dispose();
});

it("keeps listening gestures in the torso and head while retaining the standing legs and relaxed arms", () => {
  const scene=new THREE.Group(),hips=new THREE.Bone(),head=new THREE.Bone(),arm=new THREE.Bone();
  hips.name="hips";head.name="head";arm.name="arm";scene.add(hips,head,arm);
  const nodes:Record<string,THREE.Bone>={hips,head,rightUpperArm:arm};
  const vrm={scene,humanoid:{update(){},getNormalizedBoneNode(name:string){return nodes[name]??null;}}} as unknown as VRM;
  const rotations=(name:string,angle:number)=>new THREE.QuaternionKeyframeTrack(name+".quaternion",[0,1,2],[0,0,0,1,...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle).toArray(),0,0,0,1]);
  const idle=new THREE.AnimationClip("idle",2,[new THREE.VectorKeyframeTrack("hips.position",[0,2],[0,1,0,0,1,0]),rotations("head",0),rotations("arm",0)]);
  const listen=new THREE.AnimationClip("listen",2,[new THREE.VectorKeyframeTrack("hips.position",[0,1,2],[0,1,0,0,1.2,0,0,1,0]),rotations("head",.4),rotations("arm",1)]);
  const controller=new TeacherMotion(vrm,idle,idle.clone(),idle.clone(),1,{listen,turnLeft:idle.clone(),turnRight:idle.clone()});
  const input={speed:0,moving:false,speaking:false,target:null,side:"right" as const,reducedMotion:false,gesture:"listen" as const};
  let headTurn=0;
  for(let i=0;i<120;i++){
    controller.update(1/60,input);headTurn=Math.max(headTurn,Math.abs(head.rotation.y));
    expect(hips.position.y).toBeCloseTo(1);expect(arm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  }
  expect(controller.state).toBe("listen");expect(headTurn).toBeGreaterThan(.1);
  controller.update(1/60,{...input,moving:true,speed:.8});expect(controller.state).toBe("walk");
  controller.dispose();
});

it("raises a bent pointing arm continuously and retracts it without a jump",()=>{
 const scene=new THREE.Group(),upper=new THREE.Bone(),lower=new THREE.Bone(),hand=new THREE.Bone();
 upper.name="upper";lower.name="lower";hand.name="hand";upper.position.set(-.2,1.4,0);lower.position.x=-.4;hand.position.x=-.4;scene.add(upper);upper.add(lower);lower.add(hand);
 const nodes={rightUpperArm:upper,rightLowerArm:lower,rightHand:hand};
 const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]??null}} as unknown as VRM;
 const clip=(name:string)=>new THREE.AnimationClip(name,2,[upper,lower,hand].map(b=>new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`,[0,2],[0,0,0,1,0,0,0,1])));
 const controller=new TeacherMotion(vrm,clip("idle"),clip("talk"),clip("walk"),1);
 const input={speed:0,moving:false,speaking:false,target:null as THREE.Vector3|null,side:"right" as const,reducedMotion:false};controller.update(1/60,input);
 let maxStep=0;
 for(let i=0;i<120;i++){const q=upper.quaternion.clone();controller.update(1/60,{...input,target:new THREE.Vector3(-4,2,-.5)});maxStep=Math.max(maxStep,q.angleTo(upper.quaternion));}
 scene.updateMatrixWorld(true);const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=hand.getWorldPosition(new THREE.Vector3());
 const elbow=a.sub(b).angleTo(c.sub(b))*180/Math.PI;expect(elbow).toBeGreaterThan(70);expect(elbow).toBeLessThan(155);expect(maxStep).toBeLessThan(.1);
 const before=upper.quaternion.clone();controller.update(1/60,input);expect(before.angleTo(upper.quaternion)).toBeLessThan(.1);
 for(let i=0;i<180;i++)controller.update(1/60,input);
 expect(upper.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.01);controller.dispose();
});

it("starts in the authored idle pose without displaying the rig reference pose",()=>{
 const scene=new THREE.Group(),arm=new THREE.Bone();arm.name="arm";scene.add(arm);
 const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>name==="rightUpperArm"?arm:null}} as unknown as VRM;
 const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,1.1));
 const idle=new THREE.AnimationClip("idle",1,[new THREE.QuaternionKeyframeTrack("arm.quaternion",[0,1],[...q.toArray(),...q.toArray()])]);
 const controller=new TeacherMotion(vrm,idle,idle.clone(),idle.clone(),1);
 expect(arm.quaternion.angleTo(q)).toBeLessThan(.001);controller.dispose();
});

it("adds speech to walking arms without modifying the gait, then fades it for a pivot",()=>{
 const create=()=>{
  const scene=new THREE.Group(),hips=new THREE.Bone(),arm=new THREE.Bone();hips.name="hips";arm.name="arm";scene.add(hips);hips.add(arm);
  const nodes={hips,rightUpperArm:arm};
  const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]??null}} as unknown as VRM;
  const armTrack=(angle:number)=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(angle,0,0));return new THREE.QuaternionKeyframeTrack("arm.quaternion",[0,2],[...q.toArray(),...q.toArray()]);};
  const gait=new THREE.AnimationClip("walk",2,[new THREE.VectorKeyframeTrack("hips.position",[0,1,2],[0,1,0,0,1.15,0,0,1,0]),armTrack(0)]);
  const talk=new THREE.AnimationClip("talk",2,[new THREE.VectorKeyframeTrack("hips.position",[0,2],[0,3,0,0,3,0]),armTrack(1)]);
  return {hips,arm,controller:new TeacherMotion(vrm,gait.clone(),talk,gait,1)};
 };
 const silent=create(),voiced=create();
 const input={speed:.8,moving:true,speaking:false,target:null,side:"right" as const,reducedMotion:false,gesture:"explain" as const};
 for(let i=0;i<180;i++){
  silent.controller.update(1/60,input);voiced.controller.update(1/60,{...input,speaking:true});
  expect(voiced.hips.position.distanceTo(silent.hips.position)).toBeLessThan(1e-6);
 }
 expect(voiced.controller.state).toBe("walk");
 expect(voiced.arm.quaternion.angleTo(silent.arm.quaternion)).toBeGreaterThan(.15);
 expect(voiced.controller.speechOverlayWeight).toBeGreaterThan(.29);
 for(let i=0;i<90;i++)voiced.controller.update(1/60,{...input,speaking:true,turning:true,turnProgress:.5});
 expect(voiced.controller.speechOverlayWeight).toBeLessThan(.001);
 silent.controller.dispose();voiced.controller.dispose();
});

it("keeps a pointing arm while the free hand emphasizes and the head nods",()=>{
 const plain=createGestureRig(),emphasis=createGestureRig(),nod=createGestureRig();
 const input={speed:0,moving:false,speaking:true,target:new THREE.Vector3(-4,2,-.5),side:'right' as const,reducedMotion:false,actionId:'combined'};
 let nodDifference=0;
 for(let i=0;i<84;i++){
  plain.controller.update(1/60,{...input,gesture:'explain'});
  emphasis.controller.update(1/60,{...input,gesture:'emphasize'});
  nod.controller.update(1/60,{...input,gesture:'nod'});
  nodDifference=Math.max(nodDifference,nod.nodes.head!.quaternion.angleTo(plain.nodes.head!.quaternion));
 }
 expect(emphasis.nodes.leftUpperArm!.quaternion.angleTo(plain.nodes.leftUpperArm!.quaternion)).toBeGreaterThan(.25);
 expect(emphasis.nodes.rightUpperArm!.quaternion.angleTo(plain.nodes.rightUpperArm!.quaternion)).toBeLessThan(.001);
 expect(nodDifference).toBeGreaterThan(.1);
 for(const rig of [plain,emphasis,nod])rig.controller.dispose();
});


it("does not apply the pointing grip or wrist aim when raising an open emphasis hand", async()=>{
 const {aimArm}=await import("./teacher-motion.ts");
 for(const side of ["left","right"] as const){
  const scene=new THREE.Group(),nodes:Record<string,THREE.Bone>={},sign=side==="left"?1:-1;
  const bone=(name:string,parent:THREE.Object3D,x:number)=>{const b=new THREE.Bone();b.name=side+name;b.position.x=x;parent.add(b);nodes[b.name]=b;return b;};
  const upper=bone("UpperArm",scene,sign*.2);upper.position.y=1.4;
  const lower=bone("LowerArm",upper,sign*.4),hand=bone("Hand",lower,sign*.4);
  for(const finger of ["Index","Middle","Ring","Little"]){const proximal=bone(finger+"Proximal",hand,sign*.05);bone(finger+"Distal",proximal,sign*.05);}
  const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
  const wrist=hand.quaternion.clone();
  aimArm(vrm,side,new THREE.Vector3(sign*.8,1.6,1),.5,"open");
  expect(hand.quaternion.angleTo(wrist)).toBeLessThan(1e-6);
  for(const finger of ["Index","Middle","Ring","Little"])expect(nodes[side+finger+"Proximal"]!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.13);
  aimArm(vrm,side,new THREE.Vector3(sign*.8,1.6,1),.5);
  expect(nodes[side+"MiddleProximal"]!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.4);
  expect(hand.quaternion.angleTo(wrist)).toBeGreaterThan(.01);
 }
});


it("waits until arrival to start a spoken nod instead of consuming it during travel",()=>{
 const scene=new THREE.Group(),head=new THREE.Bone();head.name="head";scene.add(head);
 const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>name==="head"?head:null}} as unknown as VRM;
 const clip=new THREE.AnimationClip("idle",2,[new THREE.QuaternionKeyframeTrack("head.quaternion",[0,2],[0,0,0,1,0,0,0,1])]);
 const controller=new TeacherMotion(vrm,clip,clip.clone(),clip.clone(),1);
 const input={speed:1,moving:true,speaking:true,target:null,side:"right" as const,reducedMotion:false,gesture:"nod" as const,actionId:"travel-speech"};
 for(let i=0;i<240;i++)controller.update(1/60,input);
 expect(head.rotation.x).toBeCloseTo(0);
 for(let i=0;i<60;i++)controller.update(1/60,{...input,moving:false,speed:0,speaking:false});
 expect(head.rotation.x).toBeCloseTo(0);
 for(let i=0;i<36;i++)controller.update(1/60,{...input,moving:false,speed:0});
 expect(head.rotation.x).toBeGreaterThan(.15);
 for(let i=0;i<180;i++)controller.update(1/60,{...input,moving:false,speed:0});
 expect(head.rotation.x).toBeCloseTo(0);
 controller.dispose();
});

it("interrupts a middle point with a distinctly lower point without jumping arm or finger joints", () => {
  const scene = new THREE.Group(), nodes: Record<string, THREE.Bone> = {};
  const add = (name: string, parent: THREE.Object3D, x: number) => {
    const bone = new THREE.Bone(); bone.name = name; bone.position.x = x;
    parent.add(bone); nodes[name] = bone; return bone;
  };
  const upper = add("rightUpperArm", scene, 2.23); upper.position.y = 2.34;
  const lower = add("rightLowerArm", upper, -.468), hand = add("rightHand", lower, -.438);
  const index = add("rightIndexProximal", hand, -.06);
  add("rightIndexDistal", index, -.08);
  const vrm = { scene, humanoid: { update() {}, getNormalizedBoneNode: (name: string) => nodes[name] ?? null } } as unknown as VRM;
  const clip = new THREE.AnimationClip("idle", 2, Object.values(nodes).map(bone =>
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 2], [0, 0, 0, 1, 0, 0, 0, 1])));
  const controller = new TeacherMotion(vrm, clip, clip.clone(), clip.clone(), 1);
  const input = { speed: 0, moving: false, speaking: false, side: "right" as const, reducedMotion: false };
  const point = (height: number) => {
    for (let frame = 0; frame < 110; frame++) {
      const previous = Object.values(nodes).map(bone => bone.quaternion.clone());
      controller.update(1 / 60, { ...input, target: new THREE.Vector3(-2.14, height, -.06) });
      Object.values(nodes).forEach((bone, i) => expect(bone.quaternion.angleTo(previous[i]!)).toBeLessThanOrEqual(5 / 60 + 1e-6));
    }
    scene.updateMatrixWorld(true);
    return hand.getWorldPosition(new THREE.Vector3());
  };
  const middle = point(2.03), low = point(1.37);
  expect(middle.y - low.y).toBeGreaterThan(.3);
  const base = index.getWorldPosition(new THREE.Vector3());
  const ray = nodes.rightIndexDistal!.getWorldPosition(new THREE.Vector3()).sub(base).normalize();
  const targetDirection = new THREE.Vector3(-2.14, 1.37, -.06).sub(base).normalize();
  expect(ray.angleTo(targetDirection)).toBeLessThan(.05);
  controller.dispose();
});

it("removes turn yaw from pelvis translation as well as rotation without mutating the source",async()=>{
 const {removeTurnYaw}=await import("./teacher-motion.ts");
 const hips=new THREE.Bone();hips.name="hips";hips.position.y=1;
 const vrm={humanoid:{getNormalizedBoneNode:()=>hips}} as unknown as VRM;
 const times=[0,.5,1],angles=[0,Math.PI/2,Math.PI];
 const rotations=angles.flatMap(angle=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle).toArray());
 const positions=[0,1,0,.2,1.1,0,.3,1,0];
 const source=new THREE.AnimationClip("turn",1,[new THREE.QuaternionKeyframeTrack("hips.quaternion",times,rotations),new THREE.VectorKeyframeTrack("hips.position",times,positions)]);
 const result=removeTurnYaw(source,vrm),position=result.tracks[1]!;
 for(let i=0;i<3;i++){
  const restored=new THREE.Vector3().fromArray(position.values,i*3).sub(hips.position)
   .applyAxisAngle(new THREE.Vector3(0,1,0),angles[i]!).add(hips.position);
  expect(restored.distanceTo(new THREE.Vector3().fromArray(positions,i*3))).toBeLessThan(1e-6);
  expect(new THREE.Quaternion().fromArray(result.tracks[0]!.values,i*4).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
 }
 expect(Array.from(source.tracks[1]!.values)).toEqual(positions.map(Math.fround));
});

it("retains the entry pose across turn changes and half-turn clip restarts",()=>{
 for(const fps of [30,60,120]){
  const scene=new THREE.Group(),arm=new THREE.Bone();arm.name="arm";scene.add(arm);
  const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>name==="rightUpperArm"?arm:null}} as unknown as VRM;
  const clip=(name:string,angle:number)=>new THREE.AnimationClip(name,2,[new THREE.QuaternionKeyframeTrack("arm.quaternion",[0,2],[...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle).toArray(),...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle).toArray()])]);
  const controller=new TeacherMotion(vrm,clip("idle",0),clip("talk",0),clip("walk",0),1,{listen:clip("listen",0),turnLeft:clip("left",1),turnRight:clip("right",-1)});
  const input={speed:0,moving:true,speaking:false,target:null,side:"right" as const,reducedMotion:false,turning:true,turnSign:1,turnProgress:0};
  const before=arm.quaternion.clone();controller.update(1/fps,input);
  expect(arm.quaternion.angleTo(before)).toBeLessThan(1e-7);
  for(let i=1;i<=fps;i++)controller.update(1/fps,{...input,turnProgress:i/fps*.9});
  expect(arm.rotation.z).toBeGreaterThan(.95);
  for(const next of [{...input},{...input,turnSign:-1}]){
   const old=arm.quaternion.clone();controller.update(1/fps,next);
   expect(arm.quaternion.angleTo(old)).toBeLessThan(.02);
  }
  for(let i=0;i<fps*2;i++)controller.update(1/fps,{...input,turnSign:-1,turnProgress:.8});
  expect(arm.rotation.z).toBeLessThan(-.95);
  controller.dispose();
 }
});

it("acknowledges silent listening once without repeating on new action ids",()=>{
 const scene=new THREE.Group(),head=new THREE.Bone(),chest=new THREE.Bone();head.name="head";chest.name="chest";scene.add(chest);chest.add(head);
 const nodes={head,chest};const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]??null}} as unknown as VRM;
 const clip=(name:string)=>new THREE.AnimationClip(name,2,[head,chest].map(b=>new THREE.QuaternionKeyframeTrack(b.name+".quaternion",[0,2],[0,0,0,1,0,0,0,1])));
 const motion=new TeacherMotion(vrm,clip("idle"),clip("talk"),clip("walk"),1);
 const input={speed:0,moving:false,speaking:false,target:null,side:"right" as const,reducedMotion:false,gesture:"listen" as const,actionId:"a"};
 let maxPitch=0;
 for(let i=0;i<120;i++){motion.update(1/60,input);maxPitch=Math.max(maxPitch,head.rotation.x);}
 expect(maxPitch).toBeGreaterThan(.1);expect(maxPitch).toBeLessThan(.14);
 let repeatedPitch=0;
 for(let i=0;i<180;i++){motion.update(1/60,{...input,actionId:"b"});repeatedPitch=Math.max(repeatedPitch,Math.abs(head.rotation.x));}
 expect(repeatedPitch).toBeLessThan(.005);
 expect(Math.abs(head.rotation.x)).toBeLessThan(.001);
 expect(Math.abs(chest.rotation.x)).toBeLessThan(.001);
 motion.update(1/60,{...input,gesture:"idle"});
 maxPitch=0;
 for(let i=0;i<100;i++){motion.update(1/60,input);maxPitch=Math.max(maxPitch,head.rotation.x);}
 expect(maxPitch).toBeGreaterThan(.1);
 motion.dispose();
});

it("introduces an explanation with one restrained open-hand gesture when speech actually starts",()=>{
 const scene=new THREE.Group(),upper=new THREE.Bone(),lower=new THREE.Bone(),hand=new THREE.Bone();
 upper.name="upper";lower.name="lower";hand.name="hand";
 upper.position.set(-.2,1.4,0);lower.position.x=-.4;hand.position.x=-.4;
 scene.add(upper);upper.add(lower);lower.add(hand);
 const nodes={rightUpperArm:upper,rightLowerArm:lower,rightHand:hand};
 const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>nodes[name as keyof typeof nodes]??null}} as unknown as VRM;
 const rest=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,1.1));
 const idle=new THREE.AnimationClip("idle",2,[upper,lower,hand].map(b=>{
  const q=b===upper?rest:new THREE.Quaternion();
  return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`,[0,2],[...q.toArray(),...q.toArray()]);
 }));
 const controller=new TeacherMotion(vrm,idle,idle.clone(),idle.clone(),1);
 const input={speed:0,moving:false,speaking:false,target:null,side:"right" as const,reducedMotion:false,gesture:"explain" as const,actionId:"explanation-1"};
 const position=()=>hand.getWorldPosition(new THREE.Vector3());
 const baseline=position();
 for(let i=0;i<240;i++)controller.update(1/60,input);
 expect(position().distanceTo(baseline)).toBeLessThan(1e-6);
 let peak=0;
 for(let i=0;i<240;i++){
  controller.update(1/60,{...input,speaking:true});
  peak=Math.max(peak,position().distanceTo(baseline));
 }
 expect(peak).toBeGreaterThan(.2);
 for(let i=0;i<360;i++)controller.update(1/60,{...input,speaking:true});
 expect(position().distanceTo(baseline)).toBeLessThan(.001);
 // A short gap in speech must not trigger the same explanation again.
 for(let i=0;i<30;i++)controller.update(1/60,input);
 for(let i=0;i<180;i++)controller.update(1/60,{...input,speaking:true});
 expect(position().distanceTo(baseline)).toBeLessThan(.001);
 // When the opposite hand is assigned to pointing, the free hand stays relaxed.
 for(let i=0;i<180;i++){
  controller.update(1/60,{...input,actionId:"pointed-explanation",speaking:true,side:"left",target:new THREE.Vector3(3,1.4,-.5)});
  expect(position().distanceTo(baseline)).toBeLessThan(.001);
 }
 controller.dispose();
});

function createGestureRig(relaxedArms = false) {
  const scene=new THREE.Group(),nodes:Record<string,THREE.Bone>={};
  const head=new THREE.Bone();head.name='head';head.position.y=1.8;scene.add(head);nodes.head=head;
  for(const side of ['left','right'] as const){
   const upper=new THREE.Bone(),lower=new THREE.Bone(),hand=new THREE.Bone(),sign=side==='left'?1:-1;
   upper.name=side+'UpperArm';lower.name=side+'LowerArm';hand.name=side+'Hand';upper.position.set(sign*.2,1.4,0);lower.position.x=sign*.4;hand.position.x=sign*.4;
   scene.add(upper);upper.add(lower);lower.add(hand);nodes[upper.name]=upper;nodes[lower.name]=lower;nodes[hand.name]=hand;
  }
  const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
  if (relaxedArms) for (const side of ["left", "right"] as const)
    nodes[side+"UpperArm"]!.rotation.z=(side === "left" ? -1 : 1)*Math.PI/2;
  const clip=new THREE.AnimationClip('idle',2,Object.values(nodes).map(b=>new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`,[0,2],[...b.quaternion.toArray(),...b.quaternion.toArray()])));
  return {nodes,controller:new TeacherMotion(vrm,clip,clip.clone(),clip.clone(),1)};
 }

it("retracts the pointing arm before starting a new emphasis",()=>{
 const plain=createGestureRig(),emphasis=createGestureRig();
 const input={speed:0,moving:false,speaking:true,target:new THREE.Vector3(-4,1.1,-.5),side:"right" as const,reducedMotion:false,actionId:"point"};
 for(let i=0;i<90;i++)for(const rig of [plain,emphasis])rig.controller.update(1/60,{...input,gesture:"idle"});
 for(let i=0;i<36;i++){
  plain.controller.update(1/60,{...input,target:null,actionId:"release",gesture:"idle"});
  emphasis.controller.update(1/60,{...input,target:null,actionId:"release",gesture:"emphasize"});
  for(const side of ["left","right"])expect(emphasis.nodes[side+"UpperArm"]!.quaternion.angleTo(plain.nodes[side+"UpperArm"]!.quaternion)).toBeLessThan(.001);
 }
 let difference=0;
 for(let i=0;i<180;i++){
  plain.controller.update(1/60,{...input,target:null,actionId:"release",gesture:"idle"});
  emphasis.controller.update(1/60,{...input,target:null,actionId:"release",gesture:"emphasize"});
  difference=Math.max(difference,emphasis.nodes.rightUpperArm!.quaternion.angleTo(plain.nodes.rightUpperArm!.quaternion));
 }
 expect(difference).toBeGreaterThan(.25);
 plain.controller.dispose();emphasis.controller.dispose();
});

it("waits through an audio lead-in then lets a started nod finish across a speech gap",()=>{
 const rig=createGestureRig();
 const input={speed:0,moving:false,speaking:true,speechLevel:0,target:null,side:"right" as const,reducedMotion:false,gesture:"nod" as const,actionId:"silent-lead-in"};
 for(let i=0;i<120;i++){
  rig.controller.update(1/60,input);
  expect(rig.controller.acknowledgementStrength).toBe(0);
 }
 for(let i=0;i<18;i++)rig.controller.update(1/60,{...input,speechLevel:.5});
 expect(rig.controller.acknowledgementStrength).toBeGreaterThan(.4);
 // A brief pause after onset should not freeze or restart the head halfway down.
 for(let i=0;i<18;i++)rig.controller.update(1/60,input);
 expect(rig.controller.acknowledgementStrength).toBeGreaterThan(.99);
 for(let i=0;i<120;i++)rig.controller.update(1/60,{...input,speechLevel:.5});
 expect(rig.controller.acknowledgementStrength).toBe(0);
 rig.controller.dispose();
});

it("renews the initial pointing cue on actual voice onset after a silent audio lead-in",()=>{
 const rig=createGestureRig();
 const input={speed:0,moving:false,speaking:true,speechLevel:0,target:new THREE.Vector3(-4,1.4,-.5),side:"right" as const,reducedMotion:false,gesture:"explain" as const,actionId:"point-lead-in"};
 for(let i=0;i<360;i++)rig.controller.update(1/60,input);
 expect(rig.controller.category).not.toBe("point");
 for(let i=0;i<90;i++)rig.controller.update(1/60,{...input,speechLevel:.5});
 expect(rig.controller.category).toBe("point");
 for(let i=0;i<180;i++)rig.controller.update(1/60,{...input,speechLevel:.5});
 expect(rig.controller.category).not.toBe("point");
 for(let i=0;i<60;i++)rig.controller.update(1/60,input);
 for(let i=0;i<90;i++)rig.controller.update(1/60,{...input,speechLevel:.5});
 expect(rig.controller.category).not.toBe("point");
 rig.controller.dispose();
});

it("returns an interrupted emphasis to listening without whipping the upper arm or elbow", () => {
  for (const fps of [30, 60, 120]) {
    const {nodes, controller}=createGestureRig();
    const input={speed:0,moving:false,speaking:true,target:null,side:"right" as const,reducedMotion:false,gesture:"emphasize" as const,actionId:"emphasis"};
    for(let frame=0;frame<fps*1.2;frame++)controller.update(1/fps,input);
    const raised=nodes.rightUpperArm!.quaternion.clone();
    let peak=0;
    for(let frame=0;frame<fps*2;frame++) {
      const arms=Object.values(nodes).filter(bone=>/UpperArm|LowerArm/.test(bone.name));
      const before=arms.map(bone=>bone.quaternion.clone());
      controller.update(1/fps,{...input,speaking:false,gesture:"listen",actionId:"listen"});
      arms.forEach((bone,index)=>{peak=Math.max(peak,bone.quaternion.angleTo(before[index]!)*fps);});
      // Releasing the beat should not start with a sudden downward impulse.
      if(frame === Math.round(fps*.1)-1) expect(raised.angleTo(nodes.rightUpperArm!.quaternion)).toBeLessThan(.08);
    }
    expect(peak).toBeLessThanOrEqual(2.5);
    expect(raised.angleTo(nodes.rightUpperArm!.quaternion)).toBeGreaterThan(.2);
    expect(nodes.rightUpperArm!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.02);
    controller.dispose();
  }
});

it("carries a raised emphasis into a high point without returning to the rest pose first",()=>{
 const {nodes,controller}=createGestureRig(true);
 const input={speed:0,moving:false,speaking:true,target:null,side:"right" as const,reducedMotion:false,gesture:"emphasize" as const,actionId:"emphasis"};
 for(let i=0;i<90;i++)controller.update(1/60,input);
 const hand=nodes.rightHand!;hand.updateWorldMatrix(true,false);
 const initial=hand.getWorldPosition(new THREE.Vector3()).y;
 let lowest=initial;
 for(let i=0;i<90;i++){
  controller.update(1/60,{...input,target:new THREE.Vector3(-4,2.7,-.5),gesture:"idle",actionId:"high-point"});
  hand.updateWorldMatrix(true,false);lowest=Math.min(lowest,hand.getWorldPosition(new THREE.Vector3()).y);
 }
 expect(lowest).toBeGreaterThan(initial-.2);
 expect(hand.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(initial);
 controller.dispose();
});

it("lowers a pointing arm gradually while turning to depart",()=>{
 for(const side of ["left","right"] as const)for(const fps of [30,60,120]) {
  const {nodes,controller}=createGestureRig(true);
  const input={speed:0,moving:false,speaking:false,target:new THREE.Vector3(side==="left"?4:-4,2.5,-.5),side,reducedMotion:false,gesture:"idle" as const,actionId:"point"};
  for(let frame=0;frame<fps*1.8;frame++)controller.update(1/fps,input);
  const arm=nodes[`${side}UpperArm`]!,rest=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,(side==="left"?-1:1)*Math.PI/2));
  let middle=0;
  for(let frame=0;frame<fps*2;frame++){
   controller.update(1/fps,{...input,target:null,moving:true,turning:true,turnSign:1,turnProgress:Math.min(.99,frame/fps/2),actionId:"depart"});
   if(frame===Math.round(fps*.6)-1)middle=arm.quaternion.angleTo(rest);
  }
  expect(middle).toBeGreaterThan(1);
  expect(arm.quaternion.angleTo(rest)).toBeLessThan(.02);
  controller.dispose();
 }
});

it("varies the presenting hand across spoken beats without repeating it within one beat",()=>{
 const rig=createGestureRig(true),idle=createGestureRig(true);
 const input={speed:0,moving:false,speaking:true,target:null,side:"right" as const,reducedMotion:false,gesture:"explain" as const,actionId:"first"};
 const differences=()=>Object.fromEntries((["right","left"] as const).map(side=>[side,rig.nodes[`${side}UpperArm`]!.quaternion.angleTo(idle.nodes[`${side}UpperArm`]!.quaternion)]));
 const tick=(frames:number,actionId:string)=>{for(let i=0;i<frames;i++){
  rig.controller.update(1/60,{...input,actionId});idle.controller.update(1/60,{...input,gesture:"idle",actionId});
 }};
 tick(100,"first");let angles=differences();expect(angles.right).toBeGreaterThan(angles.left!+.15);
 tick(620,"first");angles=differences();expect(angles.right).toBeLessThan(.03);expect(angles.left).toBeLessThan(.03);
 tick(100,"second");angles=differences();expect(angles.left).toBeGreaterThan(angles.right!+.15);
 rig.controller.dispose();idle.controller.dispose();
});

it("finishes a presenting gesture across short adjacent explanation beats",()=>{
 const continued=createGestureRig(true),uninterrupted=createGestureRig(true);
 const input={speed:0,moving:false,speaking:true,target:null,side:"right" as const,reducedMotion:false,gesture:"explain" as const,actionId:"first"};
 for(let frame=0;frame<180;frame++){
  continued.controller.update(1/60,{...input,actionId:frame<60?"first":"second"});
  uninterrupted.controller.update(1/60,input);
  for(const side of ["left","right"] as const)expect(continued.nodes[`${side}UpperArm`]!.quaternion.clone().normalize().angleTo(uninterrupted.nodes[`${side}UpperArm`]!.quaternion.clone().normalize()), `frame ${frame} side ${side}`).toBeLessThan(1e-6);
 }
 continued.controller.dispose();uninterrupted.controller.dispose();
});

it("turns a presenting palm through the forearm without displacing the solved hand or bending the wrist",async()=>{
 const {aimArm}=await import("./teacher-motion.ts");
 const {pointingHandGoal}=await import("./pose-transition.ts");
 for(const side of ["left","right"] as const){
  const sign=side==="left"?1:-1,scene=new THREE.Group(),upper=new THREE.Bone(),lower=new THREE.Bone(),hand=new THREE.Bone();
  scene.add(upper);upper.add(lower);lower.add(hand);
  upper.position.set(sign*.2,1.4,0);lower.position.set(sign*.4,-.01,.015);hand.position.set(sign*.4,.012,-.008);
  upper.rotation.z=-sign*Math.PI/2;
  const nodes={[`${side}UpperArm`]:upper,[`${side}LowerArm`]:lower,[`${side}Hand`]:hand};
  const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
  scene.updateMatrixWorld(true);
  const shoulder=upper.getWorldPosition(new THREE.Vector3()),target=shoulder.clone().add(new THREE.Vector3(sign*.4,-.3,.8));
  const expected=pointingHandGoal(shoulder,target,(lower.position.length()+hand.position.length())*.84);
  aimArm(vrm,side,target,1,"open");scene.updateMatrixWorld(true);
  expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
  expect(hand.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  expect(new THREE.Vector3(0,1,0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())).y).toBeGreaterThan(.2);
 }
});

it("keeps head attention continuous when only the speech action changes",()=>{
 const split=createGestureRig(),whole=createGestureRig();
 const input={speed:0,moving:false,speaking:true,target:new THREE.Vector3(-4,1.1,-.5),side:"right" as const,reducedMotion:false,gesture:"idle" as const};
 for(let i=0;i<180;i++){
  split.controller.update(1/60,{...input,actionId:i<120?"speech-1":"speech-2"});
  whole.controller.update(1/60,{...input,actionId:"speech-1"});
  expect(split.nodes.head!.quaternion.clone().normalize().angleTo(whole.nodes.head!.quaternion.clone().normalize()),`frame ${i}`).toBeLessThan(1e-6);
 }
 split.controller.dispose();whole.controller.dispose();
});

it("lets turn foot placement catch up promptly without snapping at entry",()=>{
 for(const fps of [30,60,120]){
  const scene=new THREE.Group(),leg=new THREE.Bone();leg.name="leg";scene.add(leg);
  const vrm={scene,humanoid:{update(){},getNormalizedBoneNode:(name:string)=>name==="leftUpperLeg"?leg:null}} as unknown as VRM;
  const clip=(name:string,angle:number)=>{const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle);return new THREE.AnimationClip(name,1,[new THREE.QuaternionKeyframeTrack("leg.quaternion",[0,1],[...q.toArray(),...q.toArray()])]);};
  const motion=new TeacherMotion(vrm,clip("idle",0),clip("talk",0),clip("walk",0),1,{listen:clip("listen",0),turnLeft:clip("left",.6),turnRight:clip("right",-.6)});
  for(let i=0;i<fps*.4;i++){
   const before=leg.quaternion.clone();motion.update(1/fps,{speed:0,moving:true,speaking:false,target:null,side:"right",reducedMotion:false,turning:true,turnSign:1,turnProgress:i/fps});
   expect(leg.quaternion.angleTo(before)).toBeLessThanOrEqual(5/fps+1e-6);
  }
  expect(leg.rotation.x).toBeGreaterThan(.45);motion.dispose();
 }
});
