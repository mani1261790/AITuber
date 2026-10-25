import {expect,it} from 'vitest';
import {lessonItemIds,setLessonItemIds} from '@aituber/contracts';
import {parseCoursePackage,type CoursePackage} from '@aituber/contracts';
import {quadraticFunctionsFixture} from '@aituber/content';
it('round-trips mixed pages and questions including first and consecutive questions',()=>{
 const course=structuredClone(quadraticFunctionsFixture) as CoursePackage;
 const q=course.assessments[0]!;course.assessments.push({...structuredClone(q),id:'question.extra'});
 const ids=[q.id,'question.extra',...course.schedule.orderedUnitIds].reverse();
 setLessonItemIds(course,ids);expect(lessonItemIds(parseCoursePackage(course))).toEqual(ids);
 expect(()=>parseCoursePackage({...course,schedule:{...course.schedule,orderedItemIds:ids.slice(1)}})).toThrow();
});
it('expands old packages with consecutive questions after their unit',()=>{
 const course=structuredClone(quadraticFunctionsFixture) as CoursePackage;
 const q=course.assessments[0]!;course.assessments.push({...structuredClone(q),id:'question.extra'});
 const ids=lessonItemIds(course);expect(ids.slice(ids.indexOf(q.afterUnitId)+1,ids.indexOf(q.afterUnitId)+3)).toEqual([q.id,'question.extra']);
});
