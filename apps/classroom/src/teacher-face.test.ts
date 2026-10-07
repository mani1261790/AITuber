import { expect, it } from "vitest";
import { TeacherFace } from "./teacher-face.ts";

it("moves from listening to speech without keeping the listening expression or snapping", () => {
  const face = new TeacherFace();
  let values = face.update(0, false, false, "listen");
  for (let i = 0; i < 120; i++) values = face.update(1 / 60, false, false, "listen");
  expect(values.relaxed).toBeCloseTo(.16, 3);
  const previous = values;
  values = face.update(1 / 60, true, false, "listen");
  expect(values.relaxed).toBeGreaterThan(.14);
  expect(values.happy - previous.happy).toBeLessThan(.01);
  for (let i = 0; i < 120; i++) values = face.update(1 / 60, true, false, "listen");
  expect(values.happy).toBeCloseTo(.12, 3);
  expect(values.relaxed).toBeLessThan(.001);
});

it("gives a nod a gentle acknowledgement and limits changes after a late frame", () => {
  const face = new TeacherFace();
  let values = face.update(3, false, true);
  expect(values.happy).toBeLessThan(.07);
  for (let i = 0; i < 120; i++) values = face.update(1 / 60, false, false, "nod", 1);
  expect(values.happy).toBeCloseTo(.22, 3);
  for (let i = 0; i < 120; i++) values = face.update(1 / 60, false, false, "idle");
  expect(values.happy).toBeCloseTo(.02, 3);
});

it("does not hold a nod smile during buffering or after the head finishes nodding",()=>{
 const face=new TeacherFace();
 let values=face.update(0,false,false,"nod",0);
 for(let i=0;i<120;i++)values=face.update(1/60,false,false,"nod",0);
 expect(values.happy).toBeCloseTo(.02,3);
 for(let i=0;i<60;i++)values=face.update(1/60,true,false,"nod",1);
 expect(values.happy).toBeGreaterThan(.2);
 const previous=values.happy;
 values=face.update(1/60,true,false,"nod",0);
 expect(previous-values.happy).toBeLessThan(.01);
 for(let i=0;i<180;i++)values=face.update(1/60,true,false,"nod",0);
 expect(values.happy).toBeCloseTo(.12,3);
});
