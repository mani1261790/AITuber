import {expect,it} from "vitest";
import {StagePropMotion} from "./stage-prop-motion.ts";
it("waits until the teacher arrives before writing or lowering the screen, then releases the pose",()=>{
 for(const kind of ["write","screen"] as const){
  const motion=new StagePropMotion(),action={id:"a",kind};
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

it("never adds an ink layer, and aligns the pull ring with the final rendered grip",async()=>{
 const THREE=await import("three"),{StagePropVisuals}=await import("./stage-prop-motion.ts");
 const scene=new THREE.Scene(),visuals=new StagePropVisuals(scene),motion=new StagePropMotion();
 const writing={id:"w",kind:"write" as const};visuals.update(writing,motion.update(writing,true,0));
 expect(scene.children.filter(child=>child.visible)).toHaveLength(0);
 const screen={id:"s",kind:"screen" as const};let frame=motion.update(screen,true,0);
 for(let i=0;i<120;i++)frame=motion.update(screen,true,1/60);
 const grip=new THREE.Vector3(.93,2.31,.19);visuals.update(screen,frame,grip);
 const ring=scene.children.find(child=>child instanceof THREE.Mesh)!;
 expect(ring.position.distanceTo(grip)).toBeLessThan(1e-8);
 visuals.dispose();expect(scene.children).toHaveLength(0);
});
