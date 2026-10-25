import {PackageSlide,usePackageSlides} from './package-slides.tsx';
import {formatRuby,parseRuby,applyRuby} from './script-ruby.ts';
import {useEffect,useRef,useState} from 'react';
import type {CoursePackage,PackageDraft} from '@aituber/contracts';
async function api(id:string,action='',body?:unknown,method='POST'){
 const response=await fetch(`/api/packages/${encodeURIComponent(id)}${action}`,{method:body===undefined?'GET':method,headers:{'x-aituber-surface':'operator','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();if(!response.ok)throw Error(value.message??'パッケージを取得できません');return value.draft as PackageDraft;
}
export function PackageEditor({id}:{id:string}){
 const [draft,setDraft]=useState<PackageDraft|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [tab,setTab]=useState('スライド・台本'),[edits,setEdits]=useState<Record<string,string>>({});const lock=useRef(false);const loadSlide=usePackageSlides(id);
 useEffect(()=>{let mounted=true;void api(id).then(value=>{if(mounted){setDraft(value);}}).catch(error=>{if(mounted)setError(error.message);});return()=>{mounted=false;};},[id]);
 const running=draft?.status==='queued'||draft?.status==='reviewing';
 useEffect(()=>{if(!running)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;const poll=async()=>{if(cancelled)return;try{if(!document.hidden){const next=await api(id);if(cancelled)return;setDraft(next);if(next.status==='published'){setNotice('公開しました。次の講義からこの版を使います。');return;}if(!['queued','reviewing'].includes(next.status))return;}}catch(error){if(!cancelled)setError(error instanceof Error?error.message:'状態を確認できません');return;}timer=setTimeout(()=>void poll(),10000);};timer=setTimeout(()=>void poll(),3000);return()=>{cancelled=true;clearTimeout(timer);};},[id,running]);
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};const guard=(event:MouseEvent)=>{const target=event.target instanceof Element?event.target.closest('a'):null;if(target?.getAttribute('href')?.startsWith('#/')&&target.getAttribute('href')!==window.location.hash){event.preventDefault();event.stopPropagation();setError('未保存の変更があります。下書きを保存してから移動してください。');}};window.addEventListener('beforeunload',warn);document.addEventListener('click',guard,true);return()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('click',guard,true);};},[dirty]);
 function change(update:(course:CoursePackage)=>void){if(!draft)return;const course=structuredClone(draft.course);update(course);setDraft({...draft,course});setDirty(true);setNotice('');}
 async function act(action:'save'|'publish'|'stop'){
  if(!draft||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{let current=draft;if(action!=='stop'&&dirty){const course=structuredClone(draft.course);for(const [key,value] of Object.entries(edits)){const [unitId,index]=JSON.parse(key) as [string,number];applyRuby(course,unitId,index,value);}current=await api(id,'',{revision:draft.revision,course},'PUT');setDraft(current);setEdits({});setDirty(false);}
   if(action==='publish')setDraft(await api(id,'/publish',{revision:current.revision}));
   else if(action==='stop')setDraft(await api(id,'/stop',{}));
   else setNotice('下書きを保存しました。');
  }catch(error){setError(error instanceof Error?error.message:'保存できません');}finally{lock.current=false;setBusy(false);}
 }
 if(!draft)return <section className="card"><a href="#/materials">教材一覧へ</a><p role={error?'alert':'status'}>{error||'読み込み中…'}</p></section>;
 const course=draft.course,performance=course.performance;
 return <div className="package-editor">
  <div className="editor-toolbar"><a href="#/materials" onClick={event=>{if(dirty){event.preventDefault();setError('保存してから教材一覧に戻ってください。');}}}>教材一覧へ</a><span role="status">{running?'台本・読みを確認中':dirty?'未保存':draft.status==='published'?'公開済み':'下書き'}</span><div className="button-row"><button disabled={busy||running||!dirty} onClick={()=>void act('save')}>下書きを保存</button>{running?<button disabled={busy} onClick={()=>void act('stop')}>確認を停止</button>:<button className="primary" disabled={busy||(!dirty&&draft.status==='published')} onClick={()=>void act('publish')}>{busy?'保存中…':performance?'確認して公開':'台本を準備して公開'}</button>}</div></div>
  {(error||draft.error)&&<p className="message danger" role="alert">{error||draft.error}</p>}{notice&&<p className="message success" role="status">{notice}</p>}
  <fieldset disabled={busy||running} className="editor-fields">
   <section className="card"><label className="field">教材名<input value={course.title} onChange={e=>change(course=>{course.title=e.target.value;})}/></label><p className="muted">{course.targetLevel} · {course.durationMinutes}分</p></section>
   <nav className="material-nav" aria-label="編集内容">{['スライド・台本','練習問題'].map(name=><button key={name} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</nav>
   {tab==='スライド・台本'&&<div className="script-sequence">{course.schedule.orderedUnitIds.map((unitId,unitIndex)=>{
    const unit=course.teachingUnits.find(unit=>unit.id===unitId),scene=course.scenes.find(scene=>scene.id===unit?.sceneId),script=performance?.units.find(unit=>unit.unitId===unitId);
    return <section className="script-row" key={unitId} aria-label={scene?.title}>
     <div className="script-slide"><h2>{scene?.title}</h2>{scene?.slide?<><PackageSlide sourceId={scene.slide.sourceId} pageNumber={scene.slide.pageNumber} load={loadSlide}/><p className="muted">{course.sources.find(source=>source.id===scene.slide?.sourceId)?.fileName} · {scene.slide.pageNumber}ページ</p></>:<div className="slide-text">{course.semanticTargets.filter(target=>target.sceneId===scene?.id).map(target=><p key={target.id}>{target.content}</p>)}</div>}
      <div className="button-row">{([-1,1] as const).map(offset=><button key={offset} disabled={unitIndex+offset<0||unitIndex+offset>=course.schedule.orderedUnitIds.length} onClick={()=>change(course=>{const ids=course.schedule.orderedUnitIds;[ids[unitIndex],ids[unitIndex+offset]]=[ids[unitIndex+offset]!,ids[unitIndex]!];if(course.performance)course.performance.units.sort((a,b)=>ids.indexOf(a.unitId)-ids.indexOf(b.unitId));})}>{offset<0?'説明を前へ':'説明を後へ'}</button>)}</div>
     </div>
     <div className="script-speech">{!script?<><h3>台本の準備前</h3><p>{unit?.speechText}</p><p className="muted">「台本を準備して公開」で全体の台本とルビを作成します。</p></>:script.beats.map((beat,index)=>{
      const key=JSON.stringify([unitId,index]),value=edits[key]??formatRuby(beat.text,performance?.readings.find(item=>item.text===beat.text),course.pronunciationDictionary);
      return <div className="script-beat" key={key}><RubyEditor value={value} label={`${scene?.title??'台本'}の説明${index+1}`} onChange={value=>{setEdits(previous=>({...previous,[key]:value}));setDirty(true);setNotice('');}}/>
       <div className="button-row" aria-label="説明に使うもの">{(['slides','board'] as const).map(surface=><button key={surface} aria-pressed={(beat.surface??'slides')===surface} onClick={()=>change(course=>{const target=course.performance!.units.find(unit=>unit.unitId===unitId)!.beats[index]!;target.surface=surface;if(surface==='slides'){target.blackboardMarkdown=null;target.boardReason=null;}else target.targetId=null;})}>{surface==='slides'?'スライド':'黒板'}</button>)}</div>
       {beat.surface==='board'&&<><label className="field">板書<textarea rows={4} value={beat.blackboardMarkdown??''} onChange={event=>change(course=>{course.performance!.units.find(unit=>unit.unitId===unitId)!.beats[index]!.blackboardMarkdown=event.target.value;})}/></label><label className="field">黒板で補う内容<input value={beat.boardReason??''} onChange={event=>change(course=>{course.performance!.units.find(unit=>unit.unitId===unitId)!.beats[index]!.boardReason=event.target.value;})}/></label></>}
      </div>;
     })}</div>
    </section>;
   })}</div>}
   {tab==='練習問題'&&<div className="editor-questions">{course.assessments.length===0&&<section className="card">確認問題はありません。</section>}{course.assessments.map((question,index)=><section className="card" key={question.id}><label className="field">問題<textarea rows={3} value={question.prompt} onChange={event=>change(course=>{course.assessments[index]!.prompt=event.target.value;})}/></label>{question.options.map((option,optionIndex)=><label className="field" key={optionIndex}>選択肢<input value={option} onChange={event=>change(course=>{course.assessments[index]!.options[optionIndex]=event.target.value;})}/></label>)}<label className="field">正解の条件・解説<textarea rows={4} value={question.rubric.criteria.join('\n')} onChange={event=>change(course=>{course.assessments[index]!.rubric.criteria=event.target.value.split('\n');})}/></label><label className="field">間違えやすい点<textarea rows={3} value={question.rubric.commonMistakes.join('\n')} onChange={event=>change(course=>{course.assessments[index]!.rubric.commonMistakes=event.target.value.split('\n').filter(Boolean);})}/></label></section>)}</div>}
  </fieldset>
 </div>;
}

function RubyEditor({value,label,onChange}:{value:string;label:string;onChange:(value:string)=>void}){
 const [editing,setEditing]=useState(false);let error='';let parts:ReturnType<typeof parseRuby>=[];try{parts=parseRuby(value);}catch(cause){error=cause instanceof Error?cause.message:'ルビを確認してください';}
 return <div className="ruby-editor">{editing?<><label className="field">{label}<textarea rows={8} value={value} onChange={event=>onChange(event.target.value)} aria-invalid={Boolean(error)}/></label><p className="muted">ルビ：｜原文《よみ》。ルビのない文章は公開時に自動変換します。</p>{error&&<p role="alert">{error}</p>}<button disabled={Boolean(error)} onClick={()=>setEditing(false)}>表示に戻る</button></>:<><p className="ruby-script" aria-label={label}>{parts.map((part,index)=>part.reading?<ruby key={index}>{part.text}<rp>（</rp><rt>{part.reading}</rt><rp>）</rp></ruby>:<span key={index}>{part.text}</span>)}</p><button className="text-button" onClick={()=>setEditing(true)}>台本・ルビを編集</button></>}</div>;
}
