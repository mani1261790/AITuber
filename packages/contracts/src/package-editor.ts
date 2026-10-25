import type {CoursePackage} from './course-package.ts';
export interface PackageDraft {
 course:CoursePackage;
 revision:string;
 baseHash:string;
 status:'draft'|'queued'|'reviewing'|'published'|'failed';
 error:string|null;
}

/** Legacy packages are expanded without changing their stored order. */
export function lessonItemIds(course: Pick<CoursePackage,'schedule'|'assessments'> | import('./course-package.ts').ReadonlyCoursePackage): string[]{
 return course.schedule.orderedItemIds ? [...course.schedule.orderedItemIds] : course.schedule.orderedUnitIds.flatMap(id=>[id,...course.assessments.filter(question=>question.afterUnitId===id).map(question=>question.id)]);
}
export function setLessonItemIds(course:CoursePackage,ids:string[]){
 course.schedule.orderedItemIds=ids;
 const units=new Set(course.teachingUnits.map(unit=>unit.id));
 course.schedule.orderedUnitIds=ids.filter(id=>units.has(id));
 let previous=course.schedule.orderedUnitIds[0]!;
 for(const id of ids){if(units.has(id))previous=id;else {const question=course.assessments.find(item=>item.id===id);if(question)question.afterUnitId=previous;}}
 if(course.performance)course.performance.units.sort((a,b)=>ids.indexOf(a.unitId)-ids.indexOf(b.unitId));
}
