import {it,expect} from "vitest";
import {planBoardReveal} from "./board-reveal.ts";
it("orders characters and intact formula blocks with a pause between lines",()=>{
 const marks=[{x:0,y:0,width:20,height:40,line:0,text:"◎",formula:false},{x:20,y:0,width:200,height:50,line:0,text:"x^2+6x+5",formula:true},{x:0,y:60,width:20,height:40,line:1,text:"→",formula:false}];
 const plan=planBoardReveal(marks);
 expect(plan.marks[1]!.end-plan.marks[1]!.start).toBeGreaterThanOrEqual(.8);
 expect(plan.marks[2]!.start-plan.marks[1]!.end).toBeCloseTo(.35);
 expect(plan.duration).toBeGreaterThan(plan.marks[2]!.end);
 const large=planBoardReveal(Array.from({length:700},(_,i)=>({...marks[0]!,line:Math.floor(i/80)})));
 expect(large.duration).toBeCloseTo(30.45);
});
