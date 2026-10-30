import {expect,it} from 'vitest';
import {compilePointingPlan,pointingAnchorValid,pointingIssues} from './pointing-plan.ts';
import type {CoursePackage,PointingPlan} from './course-package.ts';
const text='甘さを見ます。苦さも見ます。';
const plan:PointingPlan={mode:'manual',cues:[{id:'cue.a',start:0,end:7,quote:'甘さを見ます。',targetId:'target.a'},{id:'cue.b',start:7,end:14,quote:'苦さも見ます。',targetId:'target.b'}]};
const segments=[{text:'甘さを見ます。',startMs:500,endMs:4000},{text:'苦さも見ます。',startMs:4500,endMs:8000}];
it('follows the media clock across pauses, seeks and gaps and releases outside authored intervals',()=>{
 const at=compilePointingPlan(plan,text,segments);
 expect(at(499)).toBeNull();expect(at(500)).toBe('target.a');expect(at(2000)).toBe('target.a');expect(at(2000)).toBe('target.a');expect(at(4000)).toBeNull();expect(at(4500)).toBe('target.b');expect(at(8000)).toBeNull();expect(at(500)).toBe('target.a');expect(at(NaN)).toBeNull();
});
it('does not silently point elsewhere after script edits or incomplete transcript alignment',()=>{
 expect(compilePointingPlan(plan,'新しい'+text,segments)(1500)).toBeNull();expect(compilePointingPlan(plan,text,segments.slice(0,1))(1500)).toBeNull();expect(pointingAnchorValid(text,{start:-1,end:7,quote:'甘さを見ます。'})).toBe(false);
});
it('uses offsets to disambiguate repeated words and interpolates only inside aligned transcript segments',()=>{
 const p:PointingPlan={mode:'manual',cues:[{id:'cue.a',start:3,end:5,quote:'甘さ',targetId:'target.a'}]};const at=compilePointingPlan(p,'甘さ。甘さ。',[{text:'甘さ。甘さ。',startMs:0,endMs:6000}]);expect(at(1000)).toBeNull();expect(at(3500)).toBe('target.a');expect(at(5000)).toBeNull();
});
it('preserves legacy automatic pointing and explicit off even without an audio timeline',()=>{
 expect(compilePointingPlan(undefined,text,[])(0)).toBeUndefined();expect(compilePointingPlan({...plan,mode:'auto'},text,[])(0)).toBeUndefined();expect(compilePointingPlan({...plan,mode:'off'},text,[])(0)).toBeNull();
});
it('matches original English with normalized spaces and full width glyphs',()=>{
 const p:PointingPlan={mode:'manual',cues:[{id:'cue.a',start:0,end:2,quote:'AI',targetId:'target.a'}]};expect(compilePointingPlan(p,'AIです',[{text:'ＡＩ です',startMs:0,endMs:4000}])(1000)).toBe('target.a');expect(compilePointingPlan(p,'AIです',[{text:'エーアイです',startMs:0,endMs:4000}])(1000)).toBeNull();
});
it('rejects overlapping cues, stale phrases and targets on another page before publication',()=>{
 const course={teachingUnits:[{id:'unit.a',sceneId:'scene.a'}],scenes:[{id:'scene.a',slide:{sourceId:'source.a',pageNumber:1},targetIds:['target.a','target.b']}],semanticTargets:[{id:'target.a',sceneId:'scene.a',pageRegion:{x:0,y:0,width:.2,height:.2}},{id:'target.b',sceneId:'scene.a',pageRegion:{x:.2,y:.2,width:.2,height:.2}}],performance:{units:[{unitId:'unit.a',beats:[{text,surface:'slides',pointing:structuredClone(plan)}]}]}} as unknown as CoursePackage;
 expect(pointingIssues(course)).toEqual([]);course.performance!.units[0]!.beats[0]!.pointing!.cues[1]!.start=0;expect(pointingIssues(course).join()).toContain('重複');expect(pointingIssues(course).join()).toContain('台本');course.semanticTargets[0]!.sceneId='scene.other';expect(pointingIssues(course).join()).toContain('同じスライド');
});
