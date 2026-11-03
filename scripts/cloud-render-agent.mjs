import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {VideoExportService} from '../apps/server/dist/video-export-service.js';
import {CachedSpeechProvider,FishAudioTtsProvider} from '../packages/providers/dist/index.js';
const repo=fileURLToPath(new URL('../',import.meta.url));
const settings=JSON.parse(fs.readFileSync(process.env.AITUBER_RENDER_CONFIG??path.join(repo,'.data/render-agent.json'),'utf8'));
const origin=new URL(settings.origin);if(origin.protocol!=='https:')throw Error('HTTPS required');
const directory=path.join(repo,'.data/cloud-exports');fs.mkdirSync(directory,{recursive:true});
const lock=path.join(directory,'agent.pid');if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));let alive=false;try{process.kill(pid,0);alive=true;}catch{/* Stale PID or removed lock. */}if(alive)throw Error('Render agent already running');}fs.writeFileSync(lock,String(process.pid));process.on('exit',()=>{try{fs.unlinkSync(lock);}catch{/* Stale PID or removed lock. */}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function request(endpoint,options={}){const r=await fetch(new URL('/api/render-agent/'+endpoint,origin),{...options,headers:{authorization:'Bearer '+settings.token,...options.headers},signal:AbortSignal.timeout(120000)});if(!r.ok){const error=new Error('Render relay HTTP '+r.status);error.status=r.status;throw error;}return r;}
const speech=new CachedSpeechProvider(new FishAudioTtsProvider({apiKey:settings.fishApiKey}),path.join(repo,'.data/speech-cache'));
let active=null;
while(true){
 try{
  const {job,course}=await(await request('poll',{method:'POST'})).json();
  if(!job){active=null;await pause(30000);continue;}
  const mapping=path.join(directory,job.id+'.json');
  if(!active||active.remote!==job.id){
   const sources=new Map();for(const source of course.sources.filter(s=>s.kind==='pdf')){const bytes=new Uint8Array(await(await request(job.id+'/source?id='+encodeURIComponent(source.id))).arrayBuffer());sources.set(source.contentHash,bytes);}
   const service=new VideoExportService({directory:path.join(directory,job.id),repo,getCourse:()=>course,readSource:hash=>{const bytes=sources.get(hash);if(!bytes)throw Error('Unknown source');return bytes;},speech,voiceId:settings.voiceId});
   let local;if(fs.existsSync(mapping))local=JSON.parse(fs.readFileSync(mapping,'utf8')).local;else{local=service.start(course.id).id;fs.writeFileSync(mapping,JSON.stringify({local}),{mode:0o600});}
   active={remote:job.id,service,local};
  }
  while(active){
   const {job:remote}=await(await request(job.id+'/status')).json();if(['cancelled','failed'].includes(remote.status)){active.service.cancel(active.local);active=null;break;}
   const local=active.service.get(active.local);
   if(local.status==='complete'){
    const file=path.join(active.service.dir(active.local),'lecture.mp4');const size=fs.statSync(file).size;if(size>95*1024*1024)throw Error('MP4 exceeds cloud transfer limit (95 MB)');
    await request(job.id+'/status',{method:'PUT',body:JSON.stringify({status:'encoding',frames:local.frames}),headers:{'content-type':'application/json'}});
    await request(job.id+'/file',{method:'PUT',body:fs.createReadStream(file),duplex:'half',headers:{'content-type':'video/mp4','content-length':String(size)}});console.log(new Date().toISOString(),'completed',job.id);active=null;break;
   }
   await request(job.id+'/status',{method:'PUT',body:JSON.stringify({status:local.status==='cancelled'?'failed':local.status,frames:local.frames,error:local.error}),headers:{'content-type':'application/json'}});
   if(['failed','cancelled'].includes(local.status)){active=null;break;}
   await pause(5000);
  }
 }catch(error){
  console.error(new Date().toISOString(),error.message);
  if(active&&error.status===409){active.service.cancel(active.local);active=null;}
  else if(active&&error.status===undefined){active.service.cancel(active.local);try{await request(active.remote+'/status',{method:'PUT',body:JSON.stringify({status:'failed',frames:0,error:error.message}),headers:{'content-type':'application/json'}});}catch{/* Leave the recorded job for operator inspection. */}active=null;}
  await pause(30000);
 }
}
