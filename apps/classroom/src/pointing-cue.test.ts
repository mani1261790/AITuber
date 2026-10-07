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
