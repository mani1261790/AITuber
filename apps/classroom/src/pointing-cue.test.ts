import {expect,it} from "vitest";
import {Vector3} from "three";
import {PointingCue} from "./pointing-cue.ts";
it("rests during a long speech wait and indicates once when speech actually starts",()=>{
 const cue=new PointingCue(),target=new Vector3(-2,2,0);
 for(let i=0;i<120;i++)expect(cue.update(1/60,target,false)).toBe(true);
 for(let i=0;i<180;i++)cue.update(1/60,target,false);
 for(let i=0;i<300;i++)expect(cue.update(1/60,target,false)).toBe(false);
 for(let i=0;i<60;i++)expect(cue.update(1/60,target,true)).toBe(true);
 for(let i=0;i<240;i++)cue.update(1/60,target,true);
 expect(cue.update(1/60,target,true)).toBe(false);
 for(let i=0;i<300;i++)expect(cue.update(1/60,target,false)).toBe(false);
 // A breath or a second sentence must not trigger another periodic arm lift.
 expect(cue.update(1/60,target,true)).toBe(false);
 expect(cue.update(1/60,new Vector3(-2,1,0),true)).toBe(true);
 expect(cue.update(1/60,null,false)).toBe(false);
 expect(cue.update(1/60,target,true)).toBe(true);
});

it("repeats a deliberate pointing command at the same target, but not its continuing speech",()=>{
 const cue=new PointingCue(),target=new Vector3(-2,1,0);
 for(let i=0;i<300;i++)cue.update(1/60,target,false,"point-1");
 expect(cue.update(1/60,target,false,"point-1")).toBe(false);
 expect(cue.update(1/60,target,false,"point-2")).toBe(true);
 for(let i=0;i<90;i++)expect(cue.update(1/60,target,false,"point-2")).toBe(true);
 // The following speak action has no new pointing command. Audio start may
 // indicate once, but a later breath or a re-render must not restart it.
 expect(cue.update(1/60,target,true)).toBe(true);
 for(let i=0;i<300;i++)cue.update(1/60,target,true);
 expect(cue.update(1/60,target,false)).toBe(false);
 expect(cue.update(1/60,target,true)).toBe(false);
 expect(cue.update(1/60,target,true,"point-2")).toBe(false);
 expect(cue.update(1/60,target,true,"point-3")).toBe(true);
});


it("rests during an overlong authored interval without renewing at each breath",()=>{
 const cue=new PointingCue(),target=new Vector3(-2,2,0);
 for(let i=0;i<180;i++)expect(cue.update(1/60,target,i%100>20,undefined,true)).toBe(true);
 for(let i=0;i<60;i++)cue.update(1/60,target,false,undefined,true);
 for(let i=0;i<600;i++)expect(cue.update(1/60,target,i%100>20,undefined,true)).toBe(false);
 expect(cue.update(1/60,null,false,undefined,true)).toBe(false);
 expect(cue.update(1/60,target,true,undefined,true)).toBe(true);
});

it("lowers the arm between an uninterrupted chain of different targets",()=>{
 const cue=new PointingCue();let run=0,longest=0,rest=0,longestRest=0;
 for(let i=0;i<600;i++){
  const raised=cue.update(1/60,new Vector3(-2,Math.floor(i/60)%2+1,0),true,undefined,true);
  if(raised){run++;rest=0;}else{run=0;rest++;}
  longest=Math.max(longest,run);longestRest=Math.max(longestRest,rest);
 }
 expect(longest).toBeLessThanOrEqual(192);
 expect(longestRest).toBeGreaterThanOrEqual(71);
});
