import type {LecturePerformance, MotionCue} from './course-package.ts';
type Beat=LecturePerformance['units'][number]['beats'][number];
export const motionNames:Record<MotionCue['kind'],string>={board:'黒板を使う',slides:'スライドに戻す',left:'左へ移動',center:'中央へ移動',right:'右へ移動',explain:'説明する',emphasize:'強調する',nod:'うなずく',idle:'腕を休める'};
export function motionIssues(beat:{text:string;motions?:readonly Readonly<MotionCue>[];transitionText?:string}):string[]{
 const errors:string[]=[];let end=0;const ids=new Set<string>();
 if(beat.motions?.length&&beat.transitionText)errors.push('準備中の台本を本文に統合してください');
 for(const c of [...beat.motions??[]].sort((a,b)=>a.start-b.start)){
  if(!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end<=c.start||c.end>beat.text.length||beat.text.slice(c.start,c.end)!==c.quote)errors.push('台本が変わっています。動作の区間を選び直してください');
  if(c.start<end||ids.has(c.id))errors.push('動作の区間が重複しています');end=c.end;ids.add(c.id);
  if(c.kind==='board'&&(!c.markdown?.trim()||!beat.text.slice(c.end).trim()))errors.push('黒板の内容と、準備後に話す説明が必要です');
 }
 return [...new Set(errors)];
}
/** Expand text-anchored cues into serial speech/motion joins. Never rewrite narration.
 * A board cue's selected span is spoken during preparation; its following span
 * waits for writing readiness. Screen/limb operations remain in the stage queue.
 */
export function expandMotionBeat(beat:Beat):Beat[]{
 if(!beat.motions?.length)return [beat];
 const errors=motionIssues(beat);if(errors.length)throw new Error(errors.join('。'));
 const cues=[...beat.motions].sort((a,b)=>a.start-b.start),out:Beat[]=[];
 let state:Beat={...beat,walkWhileSpeaking:true},offset=0;delete state.motions;delete state.transitionText;
 const segment=(start:number,end:number,overrides:Partial<Beat>={})=>{
  const text=beat.text.slice(start,end);if(!text.trim())return;
  const pointing=beat.pointing?.mode==='manual'?{mode:'manual' as const,cues:beat.pointing.cues.filter(c=>c.start<end&&c.end>start).map(c=>{const a=Math.max(start,c.start),b=Math.min(end,c.end);return {...c,start:a-start,end:b-start,quote:beat.text.slice(a,b)};})}:beat.pointing;
  out.push({...state,text,...(pointing?{pointing}:{}),...overrides});state={...state,blackboardMarkdown:null};
 };
 for(let i=0;i<cues.length;i++){
  const c=cues[i]!;segment(offset,c.start);
  if(c.kind==='board'){
   const next=cues[i+1]?.start??beat.text.length;
   if(!beat.text.slice(c.end,next).trim())throw new Error('黒板の準備区間の後に、板書を説明する文章を残してください');
   state={...state,surface:'board',targetId:null,position:'right',blackboardMarkdown:c.markdown!,boardReason:c.reason??beat.boardReason??null,staging:'manual'};
   segment(c.end,next,{transitionText:beat.text.slice(c.start,c.end),pointing:{mode:'off',cues:[]}});offset=next;
  }else{
   if(c.kind==='slides')state={...state,surface:'slides',blackboardMarkdown:null,targetId:null};
   else if(['left','center','right'].includes(c.kind))state={...state,position:c.kind as Beat['position'],targetId:null,staging:'manual'};
   else state={...state,targetId:null,gesture:c.kind as NonNullable<Beat['gesture']>};
   segment(c.start,c.end,{pointing:{mode:'off',cues:[]}});offset=c.end;
   if(['explain','emphasize','nod','idle'].includes(c.kind))state={...state,gesture:beat.gesture??'explain'};
  }
 }
 segment(offset,beat.text.length);return out;
}
