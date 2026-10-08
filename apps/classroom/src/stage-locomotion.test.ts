import {expect,it} from "vitest";
import {StageLocomotion,stageStandingPose} from "./stage-locomotion.ts";
it("keeps the first half-turn step planted and merges the last step into travel without a yaw jump",()=>{
 for(const fps of [30,60,120]) for(const sign of [-1,1]){
  const motion=new StageLocomotion(0,-sign*Math.PI/2);
  let cycles=0,previousProgress=0;
  for(let i=0;i<fps*5;i++){
   const yaw=motion.yaw;
   motion.update(1/fps,sign*3,0,2,2);
   if(motion.turnProgress<previousProgress)cycles++;
   previousProgress=motion.turnProgress;
   expect(Math.abs(motion.yaw-yaw)).toBeLessThan(.06);
   if(cycles===0)expect(motion.x).toBe(0);
   else expect(Math.abs(motion.x)).toBeLessThan(.5);
   if(motion.phase==="walk")break;
  }
  expect(cycles).toBe(1);
  expect(motion.phase).toBe("walk");
  expect(Math.sin(motion.yaw)).toBeCloseTo(sign);
 }
});
it("blends departure into translation and faces the audience after arriving",()=>{
 const motion=new StageLocomotion(2.35,0);let sawWalk=false,sawArrivalTurn=false;
 for(let i=0;i<1200;i++){
  const oldX=motion.x,oldPhase=motion.phase;
  motion.update(1/60,-.65,0,1.4,1.2);
  if(oldPhase==="turn" && motion.walkBlend===0)expect(motion.x).toBe(oldX);
  expect(Math.abs(motion.x-oldX)).toBeLessThanOrEqual(1.75/60+1e-9);
  if(motion.phase==="walk")sawWalk=true;
  if(sawWalk&&motion.phase==="turn")sawArrivalTurn=true;
 }
 expect(sawWalk).toBe(true);expect(sawArrivalTurn).toBe(true);
 expect(motion.x).toBe(-.65);expect(motion.yaw).toBeCloseTo(0);expect(motion.phase).toBe("idle");
});
it("can redirect an interrupted journey without teleporting",()=>{
 const motion=new StageLocomotion(2.35,0);
 for(let i=0;i<160;i++)motion.update(1/60,-4.2,.26,1,1);
 const before=motion.x,speed=motion.speed;
 motion.update(1/60,2.35,-.26,1,1);
 expect(motion.phase).toBe("brake");
 expect(motion.x).toBeLessThan(before);
 expect(speed-motion.speed).toBeCloseTo(1.8/60);
 for(let i=0;i<900;i++)motion.update(1/60,2.35,-.26,1,1);
 expect(motion.x).toBe(2.35);expect(motion.yaw).toBeCloseTo(-.26);expect(motion.phase).toBe("idle");
});
it("keeps momentum for an extension and brakes before an interrupted pivot at different frame rates",()=>{
 for(const fps of [30,60,120]){
  const motion=new StageLocomotion(2.35,0),dt=1/fps;
  while(motion.speed<.8)motion.update(dt,-.65,0,1,1);
  const speed=motion.speed;
  motion.update(dt,-4.2,.26,1,1);
  expect(motion.phase).toBe("walk");expect(motion.speed).toBeGreaterThanOrEqual(speed);
  const yaw=motion.yaw;
  let sawBrake=false;
  for(let i=0;i<fps;i++){
   const phase=motion.phase,before=motion.speed;
   motion.update(dt,2.35,-.26,1,1);
   if(motion.phase==="brake"){
    sawBrake=true;expect(motion.yaw).toBe(yaw);
    expect(before-motion.speed).toBeLessThanOrEqual(1.8*dt+1e-9);
   }
   if(phase==="brake"&&motion.phase==="turn"){
    expect(before).toBeLessThanOrEqual(1.8*dt+1e-9);break;
   }
  }
  expect(sawBrake).toBe(true);expect(motion.phase).toBe("turn");
 }
});
it("does not snap the last centimetre or jump after a delayed frame",()=>{
 const motion=new StageLocomotion(2.35,0);
 for(let i=0;i<1600;i++){
  const before=motion.x;
  const dt=i===400?3:1/120;
  motion.update(dt,-4.2,.26,1,1);
  expect(Math.abs(motion.x-before)).toBeLessThanOrEqual(1.75*Math.min(dt,1/30)+1e-10);
 }
 expect(motion.x).toBe(-4.2);
 expect(motion.phase).toBe("idle");
});
it("brakes almost to rest before starting the arrival pivot",()=>{
 for(const fps of [30,60,120]) for(const goal of [2.05,-.65,-4.2]){
  const motion=new StageLocomotion(2.35,0);let arrivalSpeed:number|undefined;
  for(let i=0;i<3600;i++){
   const phase=motion.phase,speed=motion.speed;
   motion.update(1/fps,goal,0,1,1);
   if(phase==="walk"&&motion.phase!=="walk"){arrivalSpeed=speed;break;}
  }
  expect(arrivalSpeed).toBeDefined();
  expect(arrivalSpeed!).toBeLessThan(.1);
 }
});

it("starts a joined central explanation already facing the audience without an entrance walk",()=>{
 const pose=stageStandingPose("center"),motion=new StageLocomotion(pose.x,pose.yaw);
 for(let i=0;i<120;i++){
  motion.update(1/60,stageStandingPose("center").x,0,1.5,1.5);
  expect(motion.phase).toBe("idle");expect(motion.x).toBe(-.65);expect(motion.yaw).toBe(0);
 }
 // A central cue with a pointing target still uses the side reserved for clear projection.
 expect(stageStandingPose("center",true)).toEqual(stageStandingPose("right"));
});


it("uses the matching authored rotation clock while the departure overlaps a first step", () => {
 for(const sign of [-1,1]) {
  const motion=new StageLocomotion(0,0);
  const observed: number[]=[];
  const timing=(progress:number,direction:number)=>{observed.push(direction);return progress*progress;};
  for(let i=0;i<30;i++) {
   motion.update(1/60,sign*3,0,1,1,timing);
   expect(motion.phase).toBe("turn");
   if(motion.turnProgress<=.45)expect(motion.x).toBe(0);
   expect(motion.yaw).toBeCloseTo(sign*Math.PI/2*motion.turnProgress**2);
  }
  expect(observed.every(direction=>direction===sign)).toBe(true);
 }
});

it("takes a small continuous first step before finishing the departure rotation at 30, 60 and 120 fps",()=>{
 for(const fps of [30,60,120])for(const sign of [-1,1]){
  const motion=new StageLocomotion(0,0);let overlap=false,arrival=false;
  for(let i=0;i<fps*12;i++){
   const before=motion.x,oldSpeed=motion.speed,oldPhase=motion.phase;
   motion.update(1/fps,sign*3,0,1.4,1.4);
   if(motion.phase==="turn" && motion.turnProgress<.4)expect(motion.x).toBe(before);
   if(motion.phase==="turn" && Math.abs(motion.x-before)>1e-6){
    overlap ||= Math.abs(motion.yaw)<1.4;expect(motion.walkBlend).toBeGreaterThan(0);expect(motion.speed).toBeLessThan(.66);
    expect(Math.abs(motion.yaw)).toBeLessThanOrEqual(Math.PI/2);
   }
   if(oldPhase==="turn" && motion.phase==="walk")expect(motion.speed).toBeGreaterThanOrEqual(oldSpeed);
   if(motion.phase==="idle"){arrival=true;break;}
  }
  expect(overlap).toBe(true);expect(arrival).toBe(true);expect(motion.x).toBe(sign*3);
 }
});

it("brakes continuously if a new command interrupts the overlapping departure step",()=>{
 const motion=new StageLocomotion(0,0);
 for(let i=0;i<100;i++){
  motion.update(1/60,3,0,1.4,1.4);
  if(motion.phase==="turn" && motion.speed>.15)break;
 }
 expect(motion.phase).toBe("turn");const before=motion.speed,x=motion.x;
 motion.update(1/60,-3,0,1.4,1.4);
 expect(motion.phase).toBe("brake");expect(motion.speed).toBeCloseTo(before-1.8/60);expect(motion.x).toBeGreaterThan(x);
 for(let i=0;i<1200;i++)motion.update(1/60,-3,0,1.4,1.4);
 expect(motion.phase).toBe("idle");expect(motion.x).toBe(-3);
});

it("turns toward the board and back without changing standing position",()=>{
 const motion=new StageLocomotion(-.6,0);
 for(const target of [Math.PI,0]){
  for(let i=0;i<600;i++)motion.update(1/60,-.6,target,1.4,1.4);
  expect(motion.x).toBe(-.6);expect(motion.phase).toBe("idle");
  expect(Math.atan2(Math.sin(motion.yaw-target),Math.cos(motion.yaw-target))).toBeCloseTo(0);
 }
});
