import type {CoursePackage} from '@aituber/contracts';
export type EditableBeat=NonNullable<CoursePackage['performance']>['units'][number]['beats'][number];
export function ensurePerformance(course:CoursePackage){
 if(!course.performance)course.performance={version:1,readings:[],units:course.schedule.orderedUnitIds.map(id=>({unitId:id,beats:[{text:course.teachingUnits.find(unit=>unit.id===id)!.speechText,targetId:null,camera:'lecture',position:'center',surface:'slides'}]}))};
 return course.performance;
}
export function syncUnitSpeech(course:CoursePackage){for(const script of course.performance?.units??[]){const unit=course.teachingUnits.find(u=>u.id===script.unitId);if(unit){unit.speechText=script.beats.map(b=>b.text).join('\n');unit.captionText=unit.speechText;}}}
/** Preserve each beat's own pointing, ruby text, board and staging when changing order. */
export function arrangeBeats(course:CoursePackage,unitId:string,indices:(number|null)[]){
 const script=ensurePerformance(course).units.find(u=>u.unitId===unitId);if(!script)throw Error('台本がありません');
 if(indices.length<1||indices.length>3)throw Error('1枚につき台本は1〜3個です');
 const seen=new Set<number>();for(const i of indices){if(i!==null&&(!Number.isInteger(i)||i<0||i>=script.beats.length||seen.has(i)))throw Error('台本の順番を確認してください');if(i!==null)seen.add(i);}
 script.beats=indices.map(i=>i===null?{text:'ここに説明を入力してください。',targetId:null,camera:'lecture',position:'right',surface:'slides',gesture:'explain',walkWhileSpeaking:false,staging:'manual'}:script.beats[i]!);
 syncUnitSpeech(course);
}
