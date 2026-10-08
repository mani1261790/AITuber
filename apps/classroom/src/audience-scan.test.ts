import {expect,it} from "vitest";
import {AudienceScan} from "./audience-scan.ts";

it("dwells for seconds between slow bounded looks, with varying pauses and both sides visited",()=>{
 const scan=new AudienceScan(42),moves:number[]=[],holds:number[]=[];let previous=0,holding=0,moving=false;const visited:number[]=[];
 for(let i=0;i<60*180;i++){
  const angle=scan.update(1/60,true),velocity=Math.abs(angle-previous)*60;
  expect(Math.abs(angle)).toBeLessThanOrEqual(.220001);expect(velocity).toBeLessThan(.46);
  if(velocity>.00001){if(!moving){moves.push(i/60);holds.push(holding);holding=0;}moving=true;}else{moving=false;holding+=1/60;}
  visited.push(angle);previous=angle;
 }
 expect(moves.length).toBeGreaterThan(8);expect(moves.length).toBeLessThan(22);
 expect(Math.min(...holds)).toBeGreaterThan(5);
 expect(Math.max(...holds)-Math.min(...holds)).toBeGreaterThan(1);
 expect(Math.min(...visited)).toBeLessThan(-.14);expect(Math.max(...visited)).toBeGreaterThan(.14);
});

it("settles to centre continuously when speech stops or another focus takes priority",()=>{
 const scan=new AudienceScan(42);let previous=0;
 for(let i=0;i<60*12;i++)previous=scan.update(1/60,true);
 expect(Math.abs(previous)).toBeGreaterThan(.1);
 const first=scan.update(1/60,false);expect(Math.abs(first-previous)).toBeLessThan(.0001);
 for(let i=0;i<60*6;i++){
  const angle=scan.update(1/60,false);expect(Math.abs(angle)).toBeLessThanOrEqual(Math.abs(previous)+1e-8);previous=angle;
 }
 expect(previous).toBe(0);
 for(let i=0;i<60*5;i++)expect(scan.update(1/60,true)).toBe(0);
});
