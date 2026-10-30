import type {ReadonlyCoursePackage,PointingPlan} from './course-package.ts';
export function pointingAnchorValid(text:string,cue:{start:number;end:number;quote:string}){return cue.end>cue.start&&cue.end<=text.length&&text.slice(cue.start,cue.end)===cue.quote;}
export function pointingIssues(course:ReadonlyCoursePackage):string[]{
 const errors:string[]=[];
 for(const script of course.performance?.units??[]){const unit=course.teachingUnits.find(u=>u.id===script.unitId),scene=course.scenes.find(s=>s.id===unit?.sceneId);
  for(const beat of script.beats){const p=beat.pointing;if(!p)continue;
   if(p.mode!=='manual')continue;
   const seen=new Set<string>();let end=0;
   for(const cue of [...p.cues].sort((a,b)=>a.start-b.start)){
    const target=course.semanticTargets.find(t=>t.id===cue.targetId);
    if(seen.has(cue.id)||cue.start<end)errors.push('指差し区間が重複しています');seen.add(cue.id);end=cue.end;
    if(!pointingAnchorValid(beat.text,cue))errors.push('台本が変わったため指差し区間を選び直してください');
    if(beat.surface==='board'||!scene?.slide||!target?.pageRegion||target.sceneId!==scene.id||!scene.targetIds.includes(target.id))errors.push('指差し位置を同じスライド上に指定してください');
   }
  }
 }
 return errors;
}
/** Undefined preserves legacy automatic/beat pointing; null explicitly releases the arm. */
export function compilePointingPlan(plan:{readonly mode:PointingPlan["mode"];readonly cues:readonly Readonly<PointingPlan["cues"][number]>[]}|undefined,text:string,segments:readonly {text:string;startMs:number;endMs:number}[]):(elapsedMs:number)=>string|null|undefined{
 if(!plan||plan.mode==='auto')return ()=>undefined;
 if(plan.mode==='off')return ()=>null;
 if(!segments.length||plan.cues.some(c=>!pointingAnchorValid(text,c)))return ()=>null;
 // ReadingSpeechProvider restores original text. Fail closed if timing cannot be tied to that text.
 const normalize=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
 if(normalize(segments.map(s=>s.text).join(''))!==normalize(text))return ()=>null;
 const position=(index:number)=>normalize(text.slice(0,index)).length;
 let offset=0;const timeline=segments.map(s=>{const start=offset;offset+=normalize(s.text).length;return {...s,start,end:offset};});
 const timeAt=(n:number,end:boolean)=>{const s=timeline.find(s=>end?n>s.start&&n<=s.end:n>=s.start&&n<s.end);return s&&s.end>s.start?s.startMs+(s.endMs-s.startMs)*(n-s.start)/(s.end-s.start):null;};
 const intervals=plan.cues.map(c=>({targetId:c.targetId,start:timeAt(position(c.start),false),end:timeAt(position(c.end),true)}));
 return elapsedMs=>intervals.find(c=>c.start!==null&&c.end!==null&&elapsedMs>=c.start&&elapsedMs<c.end)?.targetId??null;
}

export function pointingTargetAt(plan:Parameters<typeof compilePointingPlan>[0],text:string,segments:Parameters<typeof compilePointingPlan>[2],elapsedMs:number){return compilePointingPlan(plan,text,segments)(elapsedMs);}
