import fs from 'node:fs';
import path from 'node:path';
import {VideoExportService} from '../apps/server/dist/video-export-service.js';
import {CachedSpeechProvider,FishAudioTtsProvider} from '../packages/providers/dist/index.js';
const id=process.env.RENDER_JOB_ID;
if(!/^export\.[a-f0-9-]{36}$/.test(id??''))throw Error('Invalid job');
const root=process.cwd(), directory=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'aituber-'));
const endpoint='https://aituber.mani1261790.workers.dev/api/render-agent/'+id+'/';
const request=async(action,options={})=>fetch(endpoint+action,{...options,headers:{authorization:'Bearer '+process.env.RENDER_AGENT_TOKEN,...options.headers},signal:AbortSignal.timeout(120000)});
const checked=async(action,options)=>{const r=await request(action,options);if(!r.ok)throw Error(action.split('?')[0]+' HTTP '+r.status);return r;};
const status=(status,frames,error)=>checked('status',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({status,frames,error})});
const claim=await request('claim',{method:'POST'});
if(claim.status===409){console.log('Job no longer queued');process.exit(0);}
if(!claim.ok)throw Error('Claim HTTP '+claim.status);
let service,local;
try{
 const {course}=await claim.json(),sources=new Map();
 for(const s of course.sources.filter(s=>s.kind==='pdf'))sources.set(s.contentHash,new Uint8Array(await(await checked('source?id='+encodeURIComponent(s.id))).arrayBuffer()));
 service=new VideoExportService({directory:path.join(directory,'jobs'),repo:root,getCourse:()=>course,readSource:hash=>sources.get(hash),speech:new CachedSpeechProvider(new FishAudioTtsProvider({apiKey:process.env.FISH_API_KEY}),path.join(directory,'audio')),voiceId:process.env.FISH_VOICE_ID});
 local=service.start(course.id).id;
 for(;;){
  const remote=await(await checked('status')).json();if(remote.job.status==='cancelled'){service.cancel(local);break;}
  const j=service.get(local);
  if(j.status==='failed'||j.status==='cancelled')throw Error(j.error??'Render failed');
  if(j.status==='complete'){
   const file=path.join(service.dir(local),'lecture.mp4'),size=fs.statSync(file).size;
   if(size>95*1024*1024)throw Error('MP4 exceeds 95 MB');
   await status('encoding',j.frames);
   await checked('file',{method:'PUT',body:fs.createReadStream(file),duplex:'half',headers:{'content-type':'video/mp4','content-length':String(size)}});
   console.log('Uploaded',id,j.frames,'frames');break;
  }
  await status(j.status,j.frames);
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}catch(e){
 if(local)service.cancel(local);
 await status('failed',0,'クラウドでの書き出しに失敗しました。').catch(()=>{});
 throw e;
}
