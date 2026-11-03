/** Embedded bytes only: PDF actions/JavaScript and external media URLs are never executed. */
export interface PdfMedia {id:string;filename:string;contentType:string;bytes:Uint8Array;x:number;y:number;width:number;height:number}
export interface MediaCue {id:string;filename:string;start:number;end:number;quote:string;muted:boolean}
export interface MediaMoment {key:string;elapsedMs:number;playing:boolean;cues:readonly MediaCue[];text:string;segments:readonly {text:string;startMs:number;endMs:number}[]}
export function mediaCueInterval(cue:MediaCue,moment:MediaMoment):{startMs:number;endMs:number}|null {
 if(moment.text.slice(cue.start,cue.end)!==cue.quote||cue.end<=cue.start)return null;
 const norm=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
 if(norm(moment.segments.map(s=>s.text).join(''))!==norm(moment.text))return null;
 let offset=0;const parts=moment.segments.map(s=>{const start=offset;offset+=norm(s.text).length;return {...s,start,end:offset};});
 const at=(n:number,end:boolean)=>{const s=parts.find(s=>end?n>s.start&&n<=s.end:n>=s.start&&n<s.end);return s&&s.end>s.start?s.startMs+(s.endMs-s.startMs)*(n-s.start)/(s.end-s.start):null;};
 const start=at(norm(moment.text.slice(0,cue.start)).length,false),end=at(norm(moment.text.slice(0,cue.end)).length,true);
 return start!==null&&end!==null?{startMs:start,endMs:end}:null;
}
export function mediaCueTime(cue:MediaCue,moment:MediaMoment):number|null {const range=mediaCueInterval(cue,moment);return range&&moment.elapsedMs>=range.startMs&&moment.elapsedMs<range.endMs?(moment.elapsedMs-range.startMs)/1000:null;}
const elements=new Set<HTMLVideoElement>();const listeners=new Set<(element:HTMLVideoElement,added:boolean)=>void>();
export function observeSlideMedia(listener:(element:HTMLVideoElement,added:boolean)=>void){listeners.add(listener);for(const e of elements)listener(e,true);return()=>{listeners.delete(listener);};}
/** Every instance owns its canvas/media. Shared PDF caches contain immutable source pixels/bytes. */
export function createPdfMediaSurface(base:HTMLCanvasElement,assets:readonly PdfMedia[],read:()=>MediaMoment|null,onError:(message:string)=>void,manual=false){
 const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height;
 const ctx=canvas.getContext('2d')!;ctx.drawImage(base,0,0);let disposed=false,frame=0,revision=0,lastStamp='';
 const fail=(message:string)=>{onError(message);window.dispatchEvent(new CustomEvent('aituber:media-error',{detail:message}));};
 const items=assets.map(asset=>{const video=document.createElement('video');video.playsInline=true;video.preload='auto';video.muted=true;video.dataset.pdfMedia=asset.filename;video.style.display='none';
 const url=URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)],{type:asset.contentType}));video.src=url;document.body.append(video);elements.add(video);for(const fn of listeners)fn(video,true);
 const item={asset,video,url,key:'',pending:false,failed:false};video.addEventListener('error',()=>{if(!disposed&&!item.failed){item.failed=true;fail('PDF内の動画を再生できません。MP4 / H.264形式を確認してください。');}});return item;});
 const tick=()=>{if(disposed)return;const moment=read();ctx.drawImage(base,0,0);
 for(const item of items){const {asset,video}=item;const cue=moment?.cues.find(c=>c.filename===asset.filename);const time=moment&&cue?mediaCueTime(cue,moment):null;
 if(time===null||!moment||item.failed){video.pause();if(item.key&&video.readyState>=2)ctx.drawImage(video,asset.x,asset.y,asset.width,asset.height);continue;}
 video.muted=cue!.muted;
 if(video.readyState>=1){const target=Math.min(time,Math.max(0,video.duration-.001));if(item.key!==moment.key+cue!.id||Math.abs(video.currentTime-target)>.15){video.currentTime=target;item.key=moment.key+cue!.id;}}
 if(moment.playing&&!document.hidden&&time<video.duration){if(video.paused&&!item.pending){item.pending=true;void video.play().catch(()=>{if(!disposed){item.failed=true;fail('動画の再生が許可されませんでした。画面を操作して授業を再開してください。');}}).finally(()=>{item.pending=false;});}}else video.pause();
 if(video.readyState>=2)ctx.drawImage(video,asset.x,asset.y,asset.width,asset.height);
 }const stamp=items.map(({video,key})=>`${key}:${video.readyState}:${Math.floor(video.currentTime*30)}`).join('|');if(stamp!==lastStamp){revision++;lastStamp=stamp;}frame=requestAnimationFrame(tick);};if(!manual)frame=requestAnimationFrame(tick);
 return {canvas,assets,get times(){return items.map(i=>({filename:i.asset.filename,time:i.video.currentTime,duration:i.video.duration}));},async seek(moment:MediaMoment|null){
 ctx.drawImage(base,0,0);
 for(const item of items){const {asset,video}=item;const cue=moment?.cues.find(c=>c.filename===asset.filename);const seconds=moment&&cue?mediaCueTime(cue,moment):null;
 if(item.failed)throw Error('Embedded video failed');
 if(seconds!==null){
  if(video.readyState<2)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Video decode timeout')),30000);video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve();},{once:true});video.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Video decode failed'));},{once:true});});
  const target=Math.min(seconds,Math.max(0,video.duration-1/30));
  if(Math.abs(video.currentTime-target)>.0001)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Video seek timeout')),30000);video.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});video.currentTime=target;});
  item.key=moment!.key;ctx.drawImage(video,asset.x,asset.y,asset.width,asset.height);
 }else if(item.key&&video.readyState>=2)ctx.drawImage(video,asset.x,asset.y,asset.width,asset.height);
 }revision++;
 },get revision(){return revision;},dispose(){disposed=true;cancelAnimationFrame(frame);for(const {video,url} of items){video.pause();elements.delete(video);for(const fn of listeners)fn(video,false);video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);}}};
}
