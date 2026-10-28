import type { ReadonlyCoursePackage } from '@aituber/contracts';
import type { Beat } from './lesson-director.ts';

/** Give older, single-position PDF scripts a stage plan without rewriting speech.
 * Explicitly varied choreography remains authored. Choices are stable across
 * prefetch, resume and question patches, rather than randomized on each request.
 */
export function stageLectureBeats(course: ReadonlyCoursePackage, script: readonly {unitId:string;beats:readonly Beat[]}[], unitId:string): Beat[] {
 const requested=script.find(unit=>unit.unitId===unitId)?.beats ?? [];
 const slideBeats=script.flatMap(unit=>unit.beats.filter(beat=>beat.surface!=='board'&&!beat.blackboardMarkdown));
 if(new Set(slideBeats.map(beat=>beat.position)).size!==1 || !course.scenes.some(scene=>scene.slide))return requested.map(beat=>({...beat}));
 let side:'left'|'right'='right',heldMs=0,previousGoals='';
 for(const id of course.schedule.orderedUnitIds){
  const unit=course.teachingUnits.find(unit=>unit.id===id),entry=script.find(unit=>unit.unitId===id);
  if(!unit||!entry)continue;
  const scene=course.scenes.find(scene=>scene.id===unit.sceneId);
  const goals=[...unit.learningGoalIds].sort().join('|');
  const topicChanged=goals!==previousGoals;
  const boundary=heldMs>=45_000&&topicChanged;
  if(boundary && scene?.slide){
   const regions=course.semanticTargets.filter(target=>unit.focusTargetIds.includes(target.id)&&target.pageRegion).map(target=>target.pageRegion!);
   const focus=regions.length ? regions.reduce((sum,region)=>sum+region.x+region.width/2,0)/regions.length : .5;
   side=focus<.4?'left':focus>.6?'right':side==='right'?'left':'right';heldMs=0;
  }
  const audience=(id===course.schedule.orderedUnitIds[0]&&unit.kind==='transition')||unit.kind==='checkpoint';
  const beats=entry.beats.map(beat=>{
   if(beat.surface==='board'||beat.blackboardMarkdown)return {...beat};
   const position=audience&&!beat.targetId?'center' as const:side;
   return {...beat,position,camera:position==='center'?'lecture' as const:'material' as const,walkWhileSpeaking:!beat.targetId};
  });
  if(id===unitId)return beats;
  heldMs+=unit.estimatedDurationMs;previousGoals=goals;
 }
 return requested.map(beat=>({...beat}));
}
