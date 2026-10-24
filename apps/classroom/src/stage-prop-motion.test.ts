import {expect,it} from "vitest";
import {rightStageX} from "./stage-locomotion.ts";
import {StagePropMotion,handwritingDuration} from "./stage-prop-motion.ts";
it("waits until the teacher arrives before writing or lowering the screen, then releases the pose",()=>{
 for(const kind of ["write","screen"] as const){
  const motion=new StagePropMotion(),action={id:"a",kind,writingDuration:handwritingDuration};
  for(let i=0;i<180;i++){const frame=motion.update(action,false,1/60)!;expect(frame.weight).toBe(0);expect(frame.progress).toBe(0);}
  let previous=0,peak=0;
  for(let i=0;i<720;i++){
   const frame=motion.update(action,i===0,1/60)!;expect(frame.progress).toBeGreaterThanOrEqual(previous);previous=frame.progress;peak=Math.max(peak,frame.weight);
  }
  const done=motion.update(action,false,1/60)!;expect(done.done).toBe(true);expect(done.progress).toBe(1);expect(done.weight).toBe(0);expect(done.yaw).toBe(0);expect(peak).toBeGreaterThan(.99);
  expect(motion.update({id:"b",kind},false,1/60)!.progress).toBe(0);
  expect(motion.update(undefined,false,1/60)).toBeNull();
 }
});
it("carries the chalk between separate strokes continuously instead of teleporting",()=>{
 for(const fps of [30,60,120]){
  const motion=new StagePropMotion(),action={id:"write",kind:"write" as const};let previous=motion.update(action,true,0)!.pose.target;
  for(let i=0;i<fps*10;i++){
   const frame=motion.update(action,true,1/fps)!;
   expect(frame.pose.target.distanceTo(previous)).toBeLessThan(.11);
   expect(frame.pose.target.z).toBeGreaterThanOrEqual(.0449);previous=frame.pose.target;
  }
 }
});

it("never adds ink and keeps the ring on its own vertical trajectory",async()=>{
 const THREE=await import("three"),{StagePropVisuals}=await import("./stage-prop-motion.ts");
 const scene=new THREE.Scene(),visuals=new StagePropVisuals(scene),motion=new StagePropMotion();
 const writing={id:"w",kind:"write" as const};visuals.update(writing,motion.update(writing,true,0));
 expect(scene.children.find(child=>child.name==="wood-and-felt-blackboard-eraser")!.visible).toBe(false);
 expect(scene.children.filter(child=>child.visible)).toHaveLength(3);
 const screen={id:"s",kind:"screen" as const};let frame=motion.update(screen,true,0);
 for(let i=0;i<120;i++)frame=motion.update(screen,true,1/60);
 visuals.update(screen,frame,new THREE.Vector3(10,10,10));
 const cord=scene.children.find(child=>child instanceof THREE.Line) as import("three").Line;
 const points=cord.geometry.getAttribute("position");
 expect(points.getX(0)).toBeCloseTo(points.getX(1));
 expect(points.getZ(0)).toBeCloseTo(points.getZ(1));
 expect(points.getY(0)).toBeGreaterThan(points.getY(1));
 const ring=scene.children.find(child=>child instanceof THREE.Mesh)!;
 expect(ring.position.distanceTo(frame!.handle)).toBeLessThan(1e-8);
 visuals.dispose();expect(scene.children).toHaveLength(0);
});


it("keeps the cord still before grasp, pulls down, releases, then lowers the hand independently",()=>{
 const motion=new StagePropMotion(),action={id:"s",kind:"screen" as const};
 const samples=new Map<number,NonNullable<ReturnType<StagePropMotion["update"]>>>();
 for(let i=0;i<=480;i++){const f=motion.update(action,true,i===0?0:1/60)!;if([60,210,258,360,480].includes(i))samples.set(i,f);}
 expect(samples.get(60)!.handle.y).toBeCloseTo(2.55);
 expect(samples.get(60)!.pose.grip).toBe(0);
 expect(samples.get(210)!.handle.y).toBeLessThan(1.9);
 expect(samples.get(210)!.pose.grip).toBe(1);
 expect(samples.get(258)!.handle.y).toBeCloseTo(1.6);
 expect(samples.get(360)!.pose.target.y).toBeLessThan(1.3);
 expect(samples.get(360)!.handle.y).toBeGreaterThan(2.5);
 expect(samples.get(360)!.pose.grip).toBe(0);
 expect(samples.get(480)!.progress).toBe(1);
 expect(samples.get(480)!.weight).toBe(0);
});

it("retracts a projected screen with a short tug before starting a looping write",()=>{
 const motion=new StagePropMotion(),action={id:"w",kind:"write" as const};
 expect(motion.destination(action,true).x).toBe(rightStageX);
 let frame=motion.update(action,true,0,true)!;
 for(let i=0;i<150;i++)frame=motion.update(action,true,1/60,true)!;
 expect(frame.kind).toBe("screen");expect(frame.handle.y).toBeCloseTo(2.25);expect(frame.progress).toBe(1);
 for(let i=0;i<210;i++)frame=motion.update(action,true,1/60,true)!;
 expect(frame.kind).toBe("write");expect(frame.progress).toBe(0);
 for(let i=0;i<1800;i++)frame=motion.update(action,true,1/60)!;
 expect(frame.done).toBe(false);expect(frame.weight).toBe(1);
 for(let i=0;i<80;i++)frame=motion.update({...action,writingComplete:true},true,1/60)!;
 expect(frame.done).toBe(true);expect(frame.weight).toBe(0);
});
it("returns smoothly across handwriting loop boundaries",async()=>{
 const {loopingHandwritingPoint}=await import("./stage-prop-motion.ts");
 let previous=loopingHandwritingPoint(0);
 for(let t=0;t<40;t+=1/60){const p=loopingHandwritingPoint(t);expect(p.distanceTo(previous)).toBeLessThan(.11);previous=p;}
});
it("uses the ordinary right standing position to operate the screen without an extra step",async()=>{
 const {stageStandingPose}=await import("./stage-locomotion.ts");
 const motion=new StagePropMotion();
 expect(motion.destination({id:"pull",kind:"screen"}).x).toBe(stageStandingPose("right").x);
 expect(motion.destination({id:"up",kind:"screen-up"},true).x).toBe(stageStandingPose("right").x);
});

it("retracts, erases existing ink, and only then starts the new writing clock",()=>{
 const motion=new StagePropMotion(),action={id:"replace",kind:"write" as const,eraseFirst:true,writingDuration:2};
 const kinds:string[]=[];let sawErase=false,sawWrite=false,complete=false;
 for(let i=0;i<4800;i++){
  const frame=motion.update(action,true,1/60,true)!;
  if(kinds.at(-1)!==frame.kind)kinds.push(frame.kind);
  if(frame.kind==="erase"){sawErase=true;expect(frame.writingElapsed).toBe(0);expect(frame.done).toBe(false);}
  if(frame.kind==="write")sawWrite=true;
  if(frame.done){complete=true;break;}
 }
 expect(kinds).toEqual(["screen","erase","write"]);expect(sawErase&&sawWrite&&complete).toBe(true);
});
it("does not erase before arrival and does not repeat erasing after completion",()=>{
 const motion=new StagePropMotion(),action={id:"replace",kind:"write" as const,eraseFirst:true,writingDuration:1};
 for(let i=0;i<120;i++)expect(motion.update(action,false,1/60)!.eraseElapsed).toBe(0);
 for(let i=0;i<4800;i++)motion.update(action,true,1/60);
 expect(motion.update(action,true,1/60)!.kind).toBe("write");
 expect(motion.update(action,true,1/60)!.done).toBe(true);
 expect(motion.update({id:"fresh",kind:"write"},true,0)!.kind).toBe("write");
});
it("finishes screen return, real travel, erasure and maximum writing within the stage deadline",async()=>{
 const {StageLocomotion}=await import("./stage-locomotion.ts");
 const movement=new StageLocomotion(rightStageX,-.26),motion=new StagePropMotion();
 const action={id:"replace",kind:"write" as const,eraseFirst:true,writingDuration:30.45,eraseArea:{left:200,top:100,right:1080,bottom:620}};
 let complete=false;
 for(let i=0;i<90*60;i++){
  const destination=motion.destination(action,true);
  const ready=movement.phase==="idle" && Math.abs(movement.x-destination.x)<.01 && Math.abs(Math.atan2(Math.sin(movement.yaw-destination.yaw),Math.cos(movement.yaw-destination.yaw)))<.05;
  const frame=motion.update(action,ready,1/60,true)!;
  movement.update(1/60,frame.x,frame.yaw,1.1,1.1);
  if(frame.done){complete=true;break;}
 }
 expect(complete).toBe(true);
});

it("keeps screen return grip and release outside the sheet and in front of it",()=>{
 const motion=new StagePropMotion(),action={id:"raise",kind:"screen-up" as const};
 for(let i=0;i<360;i++){
  const frame=motion.update(action,true,1/60,true)!;
  expect(frame.handle.x).toBeGreaterThan(.908+.18);
  expect(frame.pose.target.x).toBeGreaterThan(.908+.18);
  expect(frame.pose.target.z).toBeGreaterThanOrEqual(.48);
 }
});
it("starts writing after a short erase including travel between reachable working positions",async()=>{
 const {StageLocomotion}=await import("./stage-locomotion.ts");
 const movement=new StageLocomotion(rightStageX,-.26),motion=new StagePropMotion();
 const action={id:"short",kind:"write" as const,eraseFirst:true,eraseArea:{left:250,top:160,right:1030,bottom:550}};
 let elapsed=0;
 for(;elapsed<45;elapsed+=1/60){
  const dest=motion.destination(action);
  const ready=movement.phase==="idle" && Math.abs(movement.x-dest.x)<.01 && Math.abs(Math.atan2(Math.sin(movement.yaw-dest.yaw),Math.cos(movement.yaw-dest.yaw)))<.05;
  const frame=motion.update(action,ready,1/60)!;
  if(frame.kind==="write")break;
  movement.update(1/60,frame.x,frame.yaw,1.1,1.1);
 }
 expect(elapsed).toBeLessThan(45);
});

it("keeps holding the eraser when stepping across the board",()=>{
 const motion=new StagePropMotion(),action={id:"hold",kind:"write" as const,eraseFirst:true};
 for(let i=0;i<120;i++)motion.update(action,true,1/60);
 let frame=motion.update(action,false,1/60)!;
 for(let i=0;i<120;i++)frame=motion.update(action,false,1/60)!;
 expect(frame.pose.weight).toBeLessThan(.01);
 expect(frame.pose.grip).toBeGreaterThan(.99);
});

it("writes around the center of the blackboard with the hand within reach",async()=>{
 const {boardWritingX,loopingHandwritingPoint}=await import("./stage-prop-motion.ts");
 const motion=new StagePropMotion();
 expect(motion.destination({id:"center",kind:"write"}).x).toBeCloseTo((-3.7865+.8465)/2);
 for(let t=0;t<12;t+=.1)expect(Math.abs(loopingHandwritingPoint(t).x-boardWritingX)).toBeLessThan(.8);
});
