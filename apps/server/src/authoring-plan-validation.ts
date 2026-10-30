import {pointingIssues} from '@aituber/contracts';
import type { CoursePackage, ValidationIssue } from "@aituber/contracts";

/** New authoring output must contain a teaching plan; legacy packages remain readable. */
export function validateAuthoredPlan(course: CoursePackage): ValidationIssue[] {
  const issues: ValidationIssue[]=pointingIssues(course).map(message=>({path:'/performance',message}));
  const pdfIds=new Set(course.sources.filter(s=>s.kind==="pdf").map(s=>s.id));
  for(const [index,unit] of course.teachingUnits.entries()) {
    if(!unit.teachingPlan || !unit.teachingPlan.keyPoints.some(v=>v.trim()) || !unit.teachingPlan.explanationFlow.some(v=>v.trim())) {
      issues.push({path:`/teachingUnits/${index}/teachingPlan`,message:"Newly authored units require keyPoints and explanationFlow"});
    }
    if(!unit.sourceIds.some(id=>pdfIds.has(id)))continue;
    const scene=course.scenes.find(scene=>scene.id===unit.sceneId);
    if(!scene?.slide || !unit.sourceIds.includes(scene.slide.sourceId)) {
      issues.push({path:`/teachingUnits/${index}/sceneId`,message:"A unit using PDF material must project a page from its cited PDF source"});
      continue;
    }
    for(const id of unit.focusTargetIds) {
      const target=course.semanticTargets.find(target=>target.id===id);
      if(!target || target.sceneId!==scene.id || !target.pageRegion) {
        issues.push({path:`/teachingUnits/${index}/focusTargetIds`,message:`PDF pointing target ${id} requires a pageRegion on the projected scene; omit it from focusTargetIds if location is unknown`});
      }
    }
  }
  return issues;
}

export const pdfTeachingInstruction = " For PDF-based units, assign scene.slide={sourceId,pageNumber} using the exact SOURCE identifier and 1-based PAGE number supplied. Keep the original PDF slide: do not replace its layout with generated text. Describe semantic targets for understanding, and provide pageRegion={x,y,width,height} only when its location on that page is known (0..1 normalized coordinates, origin at the top-left of the rotated page, before letterboxing). All focusTargetIds must belong to that scene and have an accurate pageRegion; when location is unknown, leave focusTargetIds empty rather than invent coordinates. Use multiple scenes for multiple pages. Units citing a PDF must reference a scene projecting that PDF. Every newly authored unit must have nonempty teachingPlan.keyPoints and teachingPlan.explanationFlow; these are the instructional outline, not the final spoken script.";
