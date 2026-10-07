import { teacherModelUrl } from "./teacher-model.ts";
import {useEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import type {LessonDirectionView,StagePosition} from "@aituber/contracts";
import {VrmAvatar} from "./vrm-avatar.tsx";
import type {LessonImage} from "./lesson-texture.tsx";
import {VrmaPreview} from "./vrma-preview.tsx";
import {MotionLibraryPreview} from "./motion-library-preview.tsx";
import {motionPacks,recommendedMotions,motionLabels,type HandPose} from "./motion-catalog.ts";
import "./motion-lab.css";

function MotionLab(){
  const [modelUrl,setModelUrl]=useState(teacherModelUrl);
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
  useEffect(()=>{const timer=setInterval(()=>{const canvas=document.querySelector<HTMLCanvasElement>(".motion-stage canvas");if(!canvas)return;const data={...canvas.dataset} as Record<string,string>;setTelemetry(data);if(samples.current.length<6000)samples.current.push({time:performance.now(),...data});},100);return()=>clearInterval(timer);},[]);
  const move=(position:StagePosition)=>{started.current=performance.now();setElapsed(null);setDirection({...direction,actionId:crypto.randomUUID(),phase:"moving",gesture:speaking?"explain":"idle",targetId:null,position});};
  const exportData=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({mode,samples:samples.current},null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="motion-audit.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <main className="motion-lab"><aside><h1>モーション検証</h1><p>{import.meta.env.DEV ? "授業向け20候補を比較できます。「講義での動き」は本編と同じ実装です。" : "講義と同じ先生モデルで、歩行・指差し・仕草を確認できます。"}</p>
    <label>比較対象<select value={mode} onChange={event=>{setMode(event.target.value);samples.current=[];}}>{import.meta.env.DEV && <option value="library">無料モーションライブラリ</option>}<option value="current">講義での動き</option><option value="vrma">VRMAファイル</option></select></label>
    {mode==="current" && <label>先生モデル<select aria-label="先生モデル" value={modelUrl} onChange={e=>{setModelUrl(e.target.value);setSpeaking(false);setDirection({actionId:crypto.randomUUID(),phase:"resting",position:"right",targetId:null,camera:"lecture",source:"reference",reason:null});samples.current=[];setElapsed(null);}}><option value="/models/tutor.vrm?v=aituber-teacher-v1">元の先生（保存版）</option>{import.meta.env.DEV && <option value="/models/candidates/AvatarSample_A.vrm">VRoid公式 A（比較候補）</option>}<option value="/models/tutor-refined.vrm?v=proportions-1">体型改訂・袖は元の形（比較）</option><option value={teacherModelUrl}>先生・体型と袖口改訂（現在）</option>{import.meta.env.DEV && <option value="/models/candidates/AvatarSample_B.vrm">VRoid公式 B（比較候補）</option>}</select></label>}
    {mode==="library" ? <>
      <label>素材集<select aria-label="素材集" value={packId} onChange={e=>{const id=e.target.value;if(id===packId)return;setPackId(id);setClipName(recommendedMotions[id]![0]!);}}>{motionPacks.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label>モーション<select aria-label="モーション" value={clipName} onChange={e=>setClipName(e.target.value)}>{recommendedMotions[packId]!.map(name=><option key={name} value={name}>{motionLabels[name]?`${motionLabels[name]}（${name}）`:name}</option>)}</select></label>
      <label><input type="checkbox" checked={travel} onChange={e=>setTravel(e.target.checked)}/>素材に記録された移動を再生</label>
      <label><input type="checkbox" checked={tour} onChange={e=>setTour(e.target.checked)}/>8秒ずつ順番に比較</label>
      <p>移動なしの素材はその場で再生します。歩幅や歩数を強制変更していません。</p>
      <label>再生速度<select aria-label="再生速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,.75,1,1.25].map(v=><option key={v} value={v}>{v}倍</option>)}</select></label>
      <button onClick={()=>setPaused(!paused)}>{paused?"再生":"一時停止"}</button>
      <label>右手の比較<select aria-label="右手の比較" value={hand} onChange={e=>setHand(e.target.value as HandPose)}><option value="original">素材の動き</option><option value="point">人差し指で指す</option><option value="relaxed">自然に緩める</option><option value="open">手を開く</option></select></label>
      <div className="motion-buttons"><button onClick={()=>setView("body")}>全身</button><button onClick={()=>setView("hand")}>手元</button></div>
      <p>{pack.license ?? "CC0"}。先生への変換結果を比較中です。指差しは手の形の試作で、黒板への照準は別途調整が必要です。</p>
      <button onClick={exportData}>記録を保存</button>
    </> : mode!=="vrma" ? <><div className="motion-buttons"><button onClick={()=>move("left")}>左へ歩く</button><button onClick={()=>move("right")}>右へ歩く</button><button onClick={()=>move("center")}>中央へ歩く</button></div><div className="motion-buttons">{["上","中","下"].map((label,i)=><button key={label} onClick={()=>setDirection({...direction,actionId:crypto.randomUUID(),phase:"pointing",gesture:speaking?"explain":"idle",targetId:`test.${i}`})}>{label}を指す</button>)}</div><button onClick={()=>{setSpeaking(false);setDirection({...direction,phase:"resting",targetId:null,gesture:"idle"});}}>待機</button><button aria-pressed={speaking} onClick={()=>{const next=!speaking;setSpeaking(next);setDirection(current=>({...current,gesture:next?"explain":"idle"}));}}>{speaking ? "発話を止める" : "説明中の動き"}</button><label><input type="checkbox" checked={inspectFeet} onChange={e=>{setInspectFeet(e.target.checked);setInspectFace(false);}}/>足元まで表示して確認</label><label><input type="checkbox" checked={inspectFace} onChange={e=>{setInspectFace(e.target.checked);setInspectFeet(false);}}/>表情を拡大して確認</label><label>描画<select value={look} onChange={e=>setLook(e.target.value as "anime"|"original")}><option value="anime">アニメ調</option><option value="original">従来の描画</option></select></label><div className="motion-buttons">{([ ["listen","傾聴"],["nod","頷き"],["emphasize","強調"] ] as const).map(([gesture,label])=><button key={gesture} onClick={()=>{setSpeaking(gesture!=="listen");setDirection({...direction,actionId:crypto.randomUUID(),phase:"speaking",targetId:null,gesture});}}>{label}</button>)}</div><p>移動完了：{elapsed===null ? "—" : `${elapsed.toFixed(2)}秒`}</p><pre>{JSON.stringify(telemetry,null,2)}</pre><button onClick={exportData}>記録を保存</button></> : <><label>モーションを選択<input type="file" accept=".vrma" multiple onChange={event=>{setFiles(Array.from(event.target.files ?? []));setFileIndex(0);}}/></label>{files.length>0 && <select aria-label="再生ファイル" value={fileIndex} onChange={event=>setFileIndex(Number(event.target.value))}>{files.map((file,i)=><option key={i} value={i}>{file.name}</option>)}</select>}<label>再生速度<select value={speed} onChange={event=>setSpeed(Number(event.target.value))}>{[.5,.75,1,1.25].map(value=><option key={value} value={value}>{value}倍</option>)}</select></label><button onClick={()=>setPaused(!paused)}>{paused ? "再生" : "一時停止"}</button><p>ファイルはブラウザー内だけで再生します。ドラッグで視点を回し、足元を確認できます。</p></>}
    <p><a href="https://quaternius.com/packs/universalanimationlibrary.html" target="_blank" rel="noreferrer">Quaternius（CC0・変換が必要）</a></p><p><a href="https://www.rokoko.com/resources/rokoko-mocap-10-free-everyday-idle-animations" target="_blank" rel="noreferrer">Rokoko（実収録・無料素材）</a></p>
  </aside><section className="motion-stage">{mode==="library" ? <MotionLibraryPreview file={pack.files?.[clipName] ?? pack.file} clipName={clipName} speed={speed} paused={paused} travel={travel} hand={hand} view={view}/> : mode==="vrma" ? <VrmaPreview file={files[fileIndex] ?? null} speed={speed} paused={paused}/> : <VrmAvatar key={modelUrl} modelUrl={modelUrl} inspectFace={inspectFace} inspectFeet={inspectFeet} look={look} state={speaking ? "mouth-open" : "normal"} mouthOpen={speaking} targetId={null} lessonImage={image} projecting={false} direction={direction} onStageComplete={id=>{if(id===direction.actionId){setElapsed((performance.now()-started.current)/1000);setDirection(current=>({...current,phase:"resting"}));}}}/>}</section></main>;
}
export function mountMotionLab(root:HTMLElement){createRoot(root).render(<MotionLab/>);}
