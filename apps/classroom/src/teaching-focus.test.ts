import {expect,it} from "vitest";
import {TeachingFocus} from "./teaching-focus.ts";
it("introduces a detail then addresses the audience, retaining focus across short speech gaps",()=>{
 const focus=new TeachingFocus(); let weight=1;
 const run=(seconds:number,speaking:boolean,cue="a")=>{for(let i=0;i<seconds*60;i++)weight=focus.update(1/60,cue,speaking);return weight;};
 expect(run(1,true)).toBe(1);
 expect(run(2,true)).toBeLessThan(.18);
 expect(run(.3,false)).toBeLessThan(.18);
 expect(run(.5,true)).toBeLessThan(.18);
 expect(run(1.5,false)).toBeGreaterThan(.9);
});
it("new cues restore board attention smoothly and repeated frames do not restart it",()=>{
 const focus=new TeachingFocus(); let weight=1;
 for(let i=0;i<240;i++)weight=focus.update(1/60,"a",true);
 const next=focus.update(1/60,"b",true);
 expect(next).toBeGreaterThan(weight);expect(next-weight).toBeLessThan(.05);
 for(let i=0;i<60;i++)weight=focus.update(1/60,"b",true);
 expect(weight).toBeGreaterThan(.95);
 for(let i=0;i<180;i++)weight=focus.update(1/60,"b",true);
 expect(weight).toBeLessThan(.16);
});

it("retains the glance through speech actions but renews an explicit point at the same detail",()=>{
 const focus=new TeachingFocus();let weight=1;
 for(let i=0;i<60;i++)weight=focus.update(1/60,"detail",false,"point-1");
 for(let i=0;i<150;i++)weight=focus.update(1/60,"detail",true);
 expect(weight).toBeLessThan(.18);
 const next=focus.update(1/60,"detail",true,"point-2");
 expect(next).toBeGreaterThan(weight);expect(next-weight).toBeLessThan(.05);
 for(let i=0;i<60;i++)weight=focus.update(1/60,"detail",true,"point-2");
 expect(weight).toBeGreaterThan(.95);
 for(let i=0;i<180;i++)weight=focus.update(1/60,"detail",true);
 expect(weight).toBeLessThan(.16);
});
