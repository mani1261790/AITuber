import {expect,it} from "vitest";
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
 expect(scene.children.filter(child=>child.visible)).toHaveLength(0);
 const screen={id:"s",kind:"screen" as const};let frame=motion.update(screen,true,0);
 for(let i=0;i<120;i++)frame=motion.update(screen,true,1/60);
 visuals.update(screen,frame);
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
 expect(motion.destination(action,true).x).toBe(1.35);
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
