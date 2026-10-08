import { teacherModelUrl } from "./teacher-model.ts";
import {useEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import type {LessonDirectionView,StagePosition} from "@aituber/contracts";
import {VrmAvatar} from "./vrm-avatar.tsx";
import type {LessonImage} from "./lesson-texture.tsx";
import {VrmaPreview} from "./vrma-preview.tsx";
import {MotionLibraryPreview} from "./motion-library-preview.tsx";
import {motionPacks,recommendedMotions,motionLabels,type HandPose} from "./motion-catalog.ts";
import {LabSelect,LabGroup,LabToggle} from "./motion-lab-controls.tsx";
import "./motion-lab.css";

function MotionLab(){
  useEffect(()=>{const previous=document.title;document.title="モーションラボ | AITuber";return()=>{document.title=previous;};},[]);
  const [showDiagnostics,setShowDiagnostics]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const [modelUrl,setModelUrl]=useState("/models/teacher-floral-v8.vrm");
  const [look,setLook]=useState<"anime"|"original">("anime");
  const [speaking,setSpeaking]=useState(false);
  const [inspectFeet,setInspectFeet]=useState(false);
  const [inspectFace,setInspectFace]=useState(false);
  const [mode,setMode]=useState(()=>!import.meta.env.DEV || new URLSearchParams(window.location.search).get("mode")==="current"?"current":"library"),[files,setFiles]=useState<File[]>([]),[fileIndex,setFileIndex]=useState(0),[speed,setSpeed]=useState(1),[paused,setPaused]=useState(false);
  const [packId,setPackId]=useState("quaternius"),[clipName,setClipName]=useState("Walk_Loop"),[travel,setTravel]=useState(true),[hand,setHand]=useState<HandPose>("original"),[view,setView]=useState<"body"|"hand">("body"),[tour,setTour]=useState(false);
  const pack=motionPacks.find(p=>p.id===packId)!;
  useEffect(()=>{if(!tour || paused || mode!=="library")return;const timer=setTimeout(()=>{const choices=recommendedMotions[packId]!;setClipName(choices[(choices.indexOf(clipName)+1)%choices.length]!);},8000);return()=>clearTimeout(timer);},[tour,paused,mode,packId,clipName]);
  const [direction,setDirection]=useState<LessonDirectionView>({actionId:"initial",phase:"resting",position:"right",targetId:null,camera:"lecture",source:"reference",reason:null});
  const [telemetry,setTelemetry]=useState<Record<string,string>>({});const [elapsed,setElapsed]=useState<number|null>(null);
  const samples=useRef<object[]>([]),started=useRef(0);
  const image=useMemo<LessonImage>(()=>{
    const canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#1d342e";ctx.fillRect(0,0,1280,720);ctx.fillStyle="#fff";ctx.font="44px sans-serif";ctx.fillText("動きの検証 — 上・中・下の指差し",70,95);
    const regions=[.25,.5,.75].map((y,i)=>{ctx.fillStyle="#ffe69c";ctx.fillRect(160,y*720,600,60);return {id:`test.${i}`,x:.125,y,width:.47,height:.083,anchorX:.35};});
    return {canvas,boardCanvas:canvas,regions,boardRegions:regions};
  },[]);
  useEffect(()=>{const timer=setInterval(()=>{const canvas=document.querySelector<HTMLCanvasElement>(".motion-stage canvas");if(!canvas)return;const data={...canvas.dataset} as Record<string,string>;if(showDiagnostics)setTelemetry(data);if(samples.current.length<6000)samples.current.push({time:performance.now(),...data});},100);return()=>clearInterval(timer);},[showDiagnostics]);
  const move=(position:StagePosition)=>{started.current=performance.now();setElapsed(null);setDirection({...direction,actionId:crypto.randomUUID(),phase:"moving",gesture:speaking?"explain":"idle",targetId:null,position});};
  const exportData=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({mode,samples:samples.current},null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="motion-audit.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const resetModel=(value:string)=>{setModelUrl(value);setSpeaking(false);setDirection({actionId:crypto.randomUUID(),phase:"resting",position:"right",targetId:null,camera:"lecture",source:"reference",reason:null});samples.current=[];setElapsed(null);};
  return <main className="motion-lab">
    <header className="lab-header"><div className="lab-brand"><span className="lab-brand-mark" aria-hidden="true">M</span><div><span className="lab-eyebrow">AITUBER / STUDIO</span><h1>モーションラボ</h1></div></div><span className="lab-header-note">動きを試す、見比べる。</span><button className="lab-export" onClick={exportData}><span aria-hidden="true">↓</span> 記録を保存</button></header>
    <div className="lab-workspace">
    <section className="lab-preview" aria-label="3Dプレビュー">
      <div className="lab-preview-bar"><span><i aria-hidden="true"/> {mode==="current"?"講義での動き":mode==="library"?"モーション比較":"VRMAプレビュー"}</span><span>{mode==="current"?(inspectFace?"表情":inspectFeet?"全身":"講義の画角"):paused?"一時停止中":"プレビュー"}</span></div>
      <div className="motion-stage">{mode==="library" ? <MotionLibraryPreview file={pack.files?.[clipName] ?? pack.file} clipName={clipName} speed={speed} paused={paused} travel={travel} hand={hand} view={view}/> : mode==="vrma" ? <VrmaPreview file={files[fileIndex] ?? null} speed={speed} paused={paused}/> : <VrmAvatar key={modelUrl} modelUrl={modelUrl} inspectFace={inspectFace} inspectFeet={inspectFeet} look={look} state={speaking ? "mouth-open" : "normal"} mouthOpen={speaking} targetId={null} lessonImage={image} projecting={false} direction={direction} onStageComplete={id=>{if(id===direction.actionId){setElapsed((performance.now()-started.current)/1000);setDirection(current=>({...current,phase:"resting"}));}}}/>}</div>
      <div className="lab-preview-footer"><span>{mode==="current"?"講義と同じモデル・モーションで確認できます。":"ドラッグで回転 · スクロールでズーム"}</span>{mode==="current" && <span className="lab-timing">移動完了 <strong>{elapsed===null?"—":`${elapsed.toFixed(2)}秒`}</strong></span>}</div>
    </section>
    <aside className="lab-panel" aria-label="モーション操作">
      <LabGroup title="検証対象"><LabSelect label="比較対象" value={mode} onChange={value=>{setMode(value);samples.current=[];setPaused(false);}} options={[...(import.meta.env.DEV?[{value:"library",label:"無料モーションライブラリ"}]:[]),{value:"current",label:"講義での動き"},{value:"vrma",label:"VRMAファイル"}]}/>
      {mode==="current" && <LabSelect label="先生モデル" value={modelUrl} onChange={resetModel} options={[
        {value:"/models/teacher-floral-v8.vrm",label:"顔まわり・結び髪調整版 v8（最新）"},{value:"/models/teacher-floral-v7.vrm",label:"ハーフアップ・靴調整版 v7"},{value:"/models/teacher-floral-v6.vrm",label:"顔・瞳調整版 v6"},{value:"/models/teacher-floral-v5.vrm",label:"髪・リボン調整版 v5"},{value:"/models/teacher-floral-v4.vrm",label:"質感調整版 v4"},{value:teacherModelUrl,label:"講義中の先生"},{value:"/models/tutor-refined.vrm?v=proportions-1",label:"体型改訂・元の袖"},{value:"/models/tutor.vrm?v=aituber-teacher-v1",label:"元の先生（保存版）"},
        ...(import.meta.env.DEV?[{value:"/models/candidates/teacher-floral-v3.vrm",label:"上着・髪・体型 調整版（ローカル）"},{value:"/models/candidates/teacher-floral-v2.vrm",label:"衣装リメイク版（ローカル）"},{value:"/models/candidates/cardigan-fitting.vrm",label:"カーディガン移植（試着）"},{value:"/models/candidates/clothing-donor.vrm",label:"衣装提供モデル（原本）"},{value:"/models/candidates/summer-oneesan-original.vrm",label:"夏向けおねえさん（受領原本）"},{value:"/models/candidates/AvatarSample_A.vrm",label:"VRoid公式 A"},{value:"/models/candidates/AvatarSample_B.vrm",label:"VRoid公式 B"}]:[])]}/>}
      {mode==="current" && <p className="lab-help"><a href="/models/teacher-floral-v8-NOTICE.md" target="_blank" rel="noreferrer">モデル・衣装の出典</a></p>}
      {mode==="library" && <><LabSelect label="素材集" value={packId} options={motionPacks.map(p=>({value:p.id,label:p.label}))} onChange={id=>{setPackId(id);setClipName(recommendedMotions[id]![0]!);}}/><LabSelect label="モーション" value={clipName} options={recommendedMotions[packId]!.map(value=>({value,label:motionLabels[value]??value}))} onChange={setClipName}/></>}
      {mode==="vrma" && <><input ref={fileInput} className="lab-file-input" aria-label="VRMAファイルを選ぶ" type="file" accept=".vrma" multiple onChange={event=>{setFiles(Array.from(event.target.files??[]));setFileIndex(0);}}/><button className="lab-upload" onClick={()=>fileInput.current?.click()}><span aria-hidden="true">＋</span> VRMAファイルを選ぶ<small>複数選択可 · 端末内だけで再生</small></button>{files.length>0 && <LabSelect label="再生ファイル" value={String(fileIndex)} onChange={value=>setFileIndex(Number(value))} options={files.map((file,i)=>({value:String(i),label:file.name}))}/>}</>}
      </LabGroup>
      {mode==="current" ? <>
        <LabGroup title="移動"><div className="lab-grid three">{([["left","左へ歩く","←"],["center","中央へ歩く","↔"],["right","右へ歩く","→"]] as const).map(([position,label,icon])=><button key={position} onClick={()=>move(position)}><span className="lab-action-icon" aria-hidden="true">{icon}</span>{label}</button>)}</div></LabGroup>
        <LabGroup title="指差し"><div className="lab-grid three">{["上","中","下"].map((label,i)=><button key={label} onClick={()=>setDirection({...direction,actionId:crypto.randomUUID(),phase:"pointing",gesture:speaking?"explain":"idle",targetId:`test.${i}`})}><span className="lab-point-icon" data-level={i} aria-hidden="true"><i/><i/><i/></span>{label}を指す</button>)}</div></LabGroup>
        <LabGroup title="仕草"><div className="lab-grid two"><button onClick={()=>{setSpeaking(false);setDirection({...direction,actionId:crypto.randomUUID(),phase:"resting",targetId:null,gesture:"idle"});}}>待機</button><button aria-pressed={speaking && direction.gesture==="explain"} onClick={()=>{const next=!(speaking && direction.gesture==="explain");setSpeaking(next);setDirection(current=>({...current,actionId:crypto.randomUUID(),phase:"speaking",targetId:null,gesture:next?"explain":"idle"}));}}>説明</button></div><div className="lab-grid three">{([["listen","傾聴"],["nod","頷き"],["emphasize","強調"]] as const).map(([gesture,label])=><button key={gesture} onClick={()=>{setSpeaking(gesture!=="listen");setDirection({...direction,actionId:crypto.randomUUID(),phase:"speaking",targetId:null,gesture});}}>{label}</button>)}</div></LabGroup>
        <LabGroup title="表示"><span className="lab-label">画角</span><div className="lab-segments" role="group" aria-label="画角">{([["lecture","講義"],["body","全身"],["face","表情"]] as const).map(([value,label])=><button key={value} aria-pressed={value===(inspectFace?"face":inspectFeet?"body":"lecture")} onClick={()=>{setInspectFeet(value==="body");setInspectFace(value==="face");}}>{label}</button>)}</div><LabSelect label="描画" value={look} onChange={value=>setLook(value as typeof look)} options={[{value:"anime",label:"アニメ調"},{value:"original",label:"従来の描画"}]}/></LabGroup>
      </> : <LabGroup title="再生"><LabSelect label="再生速度" value={String(speed)} options={[.5,.75,1,1.25].map(value=>({value:String(value),label:`${value}倍`}))} onChange={value=>setSpeed(Number(value))}/><button className="lab-play" onClick={()=>setPaused(!paused)}>{paused?"▶ 再生":"Ⅱ 一時停止"}</button>{mode==="library" && <><LabToggle label="素材の移動を再生" checked={travel} onChange={setTravel}/><LabToggle label="8秒ずつ順番に比較" checked={tour} onChange={setTour}/><LabSelect label="右手の比較" value={hand} onChange={value=>setHand(value as HandPose)} options={[{value:"original",label:"素材の動き"},{value:"point",label:"人差し指で指す"},{value:"relaxed",label:"自然に緩める"},{value:"open",label:"手を開く"}]}/><div className="lab-segments" role="group" aria-label="比較画角"><button aria-pressed={view==="body"} onClick={()=>setView("body")}>全身</button><button aria-pressed={view==="hand"} onClick={()=>setView("hand")}>手元</button></div><p className="lab-help">{pack.license??"CC0"}。移動なしの素材はその場で再生します。</p></>}</LabGroup>}
      <section className="lab-diagnostics"><button aria-expanded={showDiagnostics} aria-controls="lab-diagnostic-data" onClick={()=>setShowDiagnostics(!showDiagnostics)}>診断データ<span aria-hidden="true">{showDiagnostics?"−":"＋"}</span></button>{showDiagnostics && <pre id="lab-diagnostic-data">{JSON.stringify(telemetry,null,2)}</pre>}</section>
      <footer className="lab-resources"><span>モーション素材</span><a href="https://quaternius.com/packs/universalanimationlibrary.html" target="_blank" rel="noreferrer">Quaternius ↗</a><a href="https://www.rokoko.com/resources/rokoko-mocap-10-free-everyday-idle-animations" target="_blank" rel="noreferrer">Rokoko ↗</a></footer>
    </aside></div>
  </main>;
}
export function mountMotionLab(root:HTMLElement){createRoot(root).render(<MotionLab/>);}
