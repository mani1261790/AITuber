import type {EditableBeat} from './package-beats.ts';
export function BeatSettings({beat,update}:{beat:EditableBeat;update:(edit:(beat:EditableBeat)=>void)=>void}){
 const board=beat.surface==='board',pointing=Boolean(beat.targetId||beat.pointing?.mode==='manual'&&beat.pointing.cues.length);
 return <details className="beat-settings"><summary>立ち位置・カメラ・身振り</summary><div className="beat-settings-body">
 <div className="button-row" role="group" aria-label="動きの設定"><button aria-pressed={beat.staging!=='manual'} onClick={()=>update(b=>{b.staging='auto';})}>自動で調整</button><button aria-pressed={beat.staging==='manual'} onClick={()=>update(b=>{b.staging='manual';})}>この設定を使う</button></div>
 {board?<p className="muted">黒板では、板書が見える位置へ自動で移動します。</p>:<div><span>立ち位置</span><div className="button-row" role="group" aria-label="立ち位置">{(['left','center','right'] as const).map((p,i)=><button key={p} aria-pressed={beat.position===p} disabled={p==='center'&&pointing} onClick={()=>update(b=>{b.position=p;b.staging='manual';})}>{['左','中央','右'][i]}</button>)}</div></div>}
 <div><span>カメラの優先</span><div className="button-row" role="group" aria-label="カメラの優先">{(['lecture','material'] as const).map((camera,i)=><button key={camera} aria-pressed={beat.camera===camera} onClick={()=>update(b=>{b.camera=camera;b.staging='manual';})}>{['講師と教材','教材を大きく'][i]}</button>)}</div></div>
 <div><span>身振り</span><div className="button-row" role="group" aria-label="身振り">{(['explain','emphasize','nod','idle'] as const).map((gesture,i)=><button key={gesture} aria-pressed={(beat.gesture??'explain')===gesture} onClick={()=>update(b=>{b.gesture=gesture;b.staging='manual';})}>{['説明する','強調する','うなずく','控えめ'][i]}</button>)}</div>{beat.gesture==='listen'&&<p className="muted">既存設定は「聞く」です。発話中は「説明する」で再生されます。</p>}</div>
 {!board&&<label className="beat-checkbox"><input type="checkbox" checked={beat.walkWhileSpeaking??false} disabled={pointing} onChange={e=>update(b=>{b.walkWhileSpeaking=e.target.checked;b.staging='manual';})}/>移動しながら話す</label>}
 {pointing&&<p className="muted">指差す間は教材の横に立ち、移動を終えてから説明します。</p>}
 </div></details>;
}
