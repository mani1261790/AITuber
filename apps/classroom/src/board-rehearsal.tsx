import { useState } from "react";
import { boardExamples, type LessonDirectionView } from "@aituber/contracts";
import { LessonStage } from "./lesson-texture.tsx";

/** Uses the same rasterization, reveal, stage acknowledgements as a real lesson. */
export function BoardRehearsal({index}:{index:number}){
 const example=boardExamples[index]!;
 const [direction,setDirection]=useState<LessonDirectionView>({actionId:"ready",phase:"resting",position:"right",targetId:null,camera:"lecture",surface:"slides",source:"reference",reason:null});
 const [text,setText]=useState<string>(example.blackboardMarkdown);
 const [started,setStarted]=useState(false);
 return <>
  <LessonStage scene={{id:"board-preview",title:example.title,templateId:"document",targets:[],focusedTargetId:null,focusedTargetIds:new Set()}}
   presentation={{state:"normal",mouthOpen:false,targetId:null,announcement:"板書の確認"}} projecting={direction.surface==="slides"} onSelect={()=>{}} direction={direction}
   onStageComplete={id=>{if(id!==direction.actionId)return;
    if(direction.phase==="drawing")setDirection(current=>({...current,actionId:crypto.randomUUID(),phase:"moving",position:"right"}));
    else if(direction.phase==="moving")setDirection(current=>({...current,actionId:crypto.randomUUID(),phase:"speaking"}));
   }}/>
  <div className="board-rehearsal-control">
   {!started && <textarea aria-label="試す板書Markdown" value={text} rows={4} maxLength={700} onChange={e=>setText(e.target.value)}/>}
   <button onClick={()=>{setStarted(true);setDirection({actionId:crypto.randomUUID(),phase:"drawing",position:"right",targetId:null,camera:"lecture",surface:"board",source:"reference",reason:null,drawing:{id:crypto.randomUUID(),markdown:text,purpose:example.title}});}}>板書を開始</button>
   <p role="status">{direction.phase==="speaking" ? `説明開始（音声なしの確認）：${example.text}` : started ? "板書中 — 説明は表示と移動の完了後" : "スクリーンを戻すところから確認できます"}</p>
  </div>
 </>;
}
