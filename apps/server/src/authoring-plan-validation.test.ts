import {it,expect} from "vitest";
import {quadraticFunctionsFixture} from "@aituber/content";
import type {CoursePackage} from "@aituber/contracts";
import {validateAuthoredPlan} from "./authoring-plan-validation.ts";
function fixture() {
  const course=structuredClone(quadraticFunctionsFixture) as CoursePackage;
  const source=course.sources[0]!;source.kind="pdf";source.pageCount=2;
  course.scenes.forEach(scene=>scene.slide={sourceId:source.id,pageNumber:1});
  course.semanticTargets.forEach(t=>t.pageRegion={x:.1,y:.2,width:.5,height:.2});
  course.teachingUnits.forEach(unit=>unit.teachingPlan={keyPoints:[unit.postconditions[0]!],explanationFlow:[unit.speechText]});
  return course;
}
it("accepts a planned PDF lecture with page-based pointing",()=>expect(validateAuthoredPlan(fixture())).toEqual([]));
it("rejects absent page projection even if prose and reference IDs are valid",()=>{
  const course=fixture();course.scenes.forEach(scene=>delete scene.slide);
  expect(validateAuthoredPlan(course).some(issue=>issue.message.includes("project a page"))).toBe(true);
});
it("rejects missing plans and unknown pointing locations, but permits no pointing",()=>{
  const course=fixture();delete course.teachingUnits[0]!.teachingPlan;
  course.semanticTargets.forEach(target=>delete target.pageRegion);
  const issues=validateAuthoredPlan(course);
  expect(issues.some(issue=>issue.path.endsWith("teachingPlan"))).toBe(true);
  expect(issues.some(issue=>issue.path.endsWith("focusTargetIds"))).toBe(true);
  course.teachingUnits.forEach(unit=>{unit.focusTargetIds=[];unit.teachingPlan={keyPoints:["要点"],explanationFlow:["説明する"]};});
  expect(validateAuthoredPlan(course)).toEqual([]);
});
