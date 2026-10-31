import {useState} from 'react';
import {motionIssues,motionNames,type MotionCue} from '@aituber/contracts';
import type {EditableBeat} from './package-beats.ts';
export function MotionEditor({beat,text,update}:{beat:EditableBeat;text:string;update:(edit:(beat:EditableBeat)=>void)=>void}){
 const [selection,setSelection]=useState({start:0,end:0}),[kind,setKind]=useState<MotionCue['kind']>('board'),[markdown,setMarkdown]=useState(''),[reason,setReason]=useState('');
 const cues=beat.motions??[],issues=motionIssues({...beat,text});
 const overlaps=cues.some(c=>selection.start<c.end&&selection.end>c.start);
 function add(){update(b=>{b.motions=[...b.motions??[],{id:`motion.${crypto.randomUUID()}`,...selection,quote:text.slice(selection.start,selection.end),kind,...(kind==='board'?{markdown,reason}:{})}].sort((a,b)=>a.start-b.start);b.walkWhileSpeaking=true;});}
 return <details className="beat-settings"><summary>台本に合わせた動作{cues.length?` · ${cues.length}か所`:''}</summary><div className="beat-settings-body">
 {beat.transitionText&&<div><p>以前の準備中の台本：{beat.transitionText}</p><button onClick={()=>update(b=>{const prefix=b.transitionText!;b.text=prefix+b.text;b.motions=[{id:`motion.${crypto.randomUUID()}`,start:0,end:prefix.length,quote:prefix,kind:'board',markdown:b.blackboardMarkdown??'',reason:b.boardReason??''}];b.surface='slides';b.blackboardMarkdown=null;b.pointing={mode:'off',cues:[]};delete b.transitionText;})}>本文に統合して動作を対応づける</button></div>}
 <label className="field">動作中に話す文章を選択<textarea readOnly rows={5} value={text} onSelect={e=>setSelection({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})}/></label>
 <div className="button-row" role="group" aria-label="文章に合わせる動作">{Object.entries(motionNames).map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value as MotionCue['kind'])}>{label}</button>)}</div>
 {kind==='board'&&<><label className="field">黒板に書く内容<textarea rows={4} value={markdown} onChange={e=>setMarkdown(e.target.value)}/></label><label className="field">この板書で補うこと<input value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label><p className="muted">選んだ文章の間にスクリーンを上げ、黒板へ移動します。続きの文章に合わせて書き、説明後に横へよけます。</p></>}
 <button disabled={selection.end<=selection.start||overlaps||!!beat.transitionText||(kind==='board'&&(!markdown.trim()||!reason.trim()||!text.slice(selection.end).trim()))} onClick={add}>選択した文章に動作を追加</button>
 {overlaps&&<p role="status">指定済みの動作と重なっています。</p>}
 {!cues.length&&<p className="muted">開始時：{beat.surface==='board'?'スクリーンを上げる → 黒板へ移動 → 板書':'必要に応じてスライドを表示'}。区間を追加すると、開始する文章を指定できます。</p>}
 <ol className="pointing-cues">{cues.map(c=><li key={c.id}><strong>{motionNames[c.kind]}</strong><p>「{c.quote}」</p>{c.kind==='board'&&<div><label className="field">板書<textarea value={c.markdown??''} onChange={e=>update(b=>{b.motions!.find(x=>x.id===c.id)!.markdown=e.target.value;})}/></label><label className="field">この板書で補うこと<input value={c.reason??''} maxLength={300} onChange={e=>update(b=>{b.motions!.find(x=>x.id===c.id)!.reason=e.target.value;})}/></label></div>}<button onClick={()=>update(b=>{b.motions=b.motions!.filter(x=>x.id!==c.id);})}>この動作を削除</button></li>)}</ol>
 {issues.map(issue=><p key={issue} role="alert">{issue}</p>)}
 <p className="muted">文章の順に動きます。動作が終わってから次の区間へ進みます。指差す場所は「指差しを編集」で指定できます。</p>
 </div></details>;
}
