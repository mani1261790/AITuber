import {expect,it} from 'vitest';
import {quadraticFunctionsFixture} from '@aituber/content';
import {stageLectureBeats} from './lecture-staging.ts';
import {compileBeats,type Beat} from './lesson-director.ts';
const beat=(text:string):Beat=>({text,position:'right',camera:'lecture',targetId:null,surface:'slides',walkWhileSpeaking:false});
function fixture(){
 const original=quadraticFunctionsFixture.teachingUnits[0]!;
 const units=Array.from({length:5},(_,i)=>({...original,id:`unit.${i}`,kind:i===0?'transition' as const:'main' as const,estimatedDurationMs:30_000,learningGoalIds:[i<2?'goal.one':'goal.two']}));
 const course={...quadraticFunctionsFixture,teachingUnits:units,schedule:{...quadraticFunctionsFixture.schedule,orderedUnitIds:units.map(u=>u.id)},scenes:quadraticFunctionsFixture.scenes.map(scene=>({...scene,slide:{sourceId:quadraticFunctionsFixture.sources[0]!.id,pageNumber:1}}))};
 const script=units.map(unit=>({unitId:unit.id,beats:[beat(unit.speechText)]}));return {course,script};
}
it('varies old single-side PDF scripts at topic boundaries without rewriting speech or pacing within a topic',()=>{
 const {course,script}=fixture();const result=script.map(unit=>stageLectureBeats(course,script,unit.unitId)[0]!);
 expect(result.map(beat=>beat.position)).toEqual(['center','right','left','left','left']);
 expect(result.map(beat=>beat.text)).toEqual(script.map(unit=>unit.beats[0]!.text));
 expect(result.every(beat=>beat.walkWhileSpeaking)).toBe(true);
 expect(script.every(unit=>unit.beats[0]!.position==='right')).toBe(true);
});
it('preserves deliberately varied authored choreography',()=>{
 const {course,script}=fixture();script[2]!.beats[0]!.position='left';
 expect(stageLectureBeats(course,script,script[0]!.unitId)).toEqual(script[0]!.beats);
});
it('keeps camera and destination through projection/speech coalescing and permits deliberate movement between untargeted beats',()=>{
 const actions=compileBeats([{...beat('導入です'),position:'center',walkWhileSpeaking:true},{...beat('図を見ましょう'),position:'left',camera:'material',walkWhileSpeaking:true}],undefined,'board');
 expect(actions).toContainEqual({type:'speak',text:'導入です',gesture:'explain',surface:'slides',position:'center'});
 expect(actions).toContainEqual({type:'speak',text:'図を見ましょう',gesture:'explain',position:'left'});
 expect(actions).toContainEqual({type:'camera',view:'material'});
});
