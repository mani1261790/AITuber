import type {AppEnv} from './index';
import {sameSecret} from './auth';
import type {ReadonlyCoursePackage} from '@aituber/contracts';
interface Job {id:string;courseId:string;title:string;status:string;frames:number;createdAt:string;updatedAt:string;duration?:number;error?:string}
const activeKey='render/active',jobsPrefix='render/jobs/';
const terminal=(j:Job)=>['complete','failed','cancelled'].includes(j.status);
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
async function read<T>(request:Request,max=65536):Promise<T>{const body=await request.text();if(body.length>max)throw Error('Request too large');return JSON.parse(body) as T;}
export async function renderExports(request:Request,env:AppEnv,agent=false,dispatch:typeof fetch=fetch):Promise<Response>{
 const path=new URL(request.url).pathname,bucket=env.STATE;
 if(agent&&(!env.RENDER_AGENT_TOKEN||!await sameSecret(request.headers.get('authorization')??'',`Bearer ${env.RENDER_AGENT_TOKEN}`)))return json({error:'unauthorized'},401);
 const currentObject=await bucket.get(activeKey);let etag=currentObject?.etag;let current=currentObject?await currentObject.json<Job>():null;
 const save=async(job:Job)=>{const result=await bucket.put(activeKey,JSON.stringify(job),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});if(!result)return false;etag=result.etag;await bucket.put(jobsPrefix+job.id,JSON.stringify(job),{customMetadata:{job:JSON.stringify(job)}});current=job;return true;};
 const claim=path.match(/^\/api\/render-agent\/(export\.[a-f0-9-]{36})\/claim$/);
 if(agent&&claim&&request.method==='POST'){
  if(!current||current.id!==claim[1]||current.status!=='queued')return json({error:'not_queued'},409);
  const job={...current,status:'preparing',updatedAt:new Date().toISOString()};
  const course=await bucket.get(`render/packages/${job.id}`);
  if(!course)return json({error:'package_missing'},404);
  return await save(job)?json({job,course:await course.json()}):json({error:'conflict'},409);
 }
 const agentMatch=path.match(/^\/api\/render-agent\/(export\.[a-f0-9-]{36})\/(status|source|file)$/);
 if(agentMatch&&agent){
  const [,id,action]=agentMatch;if(!current||current.id!==id)return json({error:'unknown_job'},404);
  if(action==='status'&&request.method==='GET')return json({job:current});
  if(terminal(current))return json({job:current},409);
  if(action==='source'&&request.method==='GET'){
   const course=await (await bucket.get(`render/packages/${id}`))!.json<ReadonlyCoursePackage>();const source=course.sources.find(s=>s.id===new URL(request.url).searchParams.get('id')&&s.kind==='pdf');if(!source)return json({error:'unknown_source'},404);
   const object=await bucket.get('sources/'+source.contentHash.slice(7));return object?new Response(object.body,{headers:{'content-type':'application/pdf'}}):json({error:'source_missing'},404);
  }
  if(action==='status'&&request.method==='PUT'){
   const body=await read<Partial<Job>>(request);if(!['preparing','rendering','encoding','failed'].includes(body.status??'')||!Number.isSafeInteger(body.frames)||body.frames!<0||body.frames!>54000)return json({error:'invalid_status'},400);
   const job={...current,status:body.status!,frames:body.frames!,updatedAt:new Date().toISOString(),...(body.error?{error:String(body.error).slice(0,500)}:{})};return await save(job)?json({job}):json({error:'conflict'},409);
  }
  if(action==='file'&&request.method==='PUT'){
   const size=Number(request.headers.get('content-length'));if(!Number.isFinite(size)||size<=0||size>95*1024*1024)return json({error:'MP4 must be under 95 MB'},413);
   await bucket.put(`render/files/${id}.mp4`,request.body,{httpMetadata:{contentType:'video/mp4'}});
   const job={...current,status:'complete',duration:current.frames/30,updatedAt:new Date().toISOString()};return await save(job)?json({job}):json({error:'conflict'},409);
  }
  return json({error:'method'},405);
 }
 if(agent)return json({error:'not_found'},404);
 if(path==='/api/video-exports'){
  if(request.method==='GET'){
   const listed=await bucket.list({prefix:jobsPrefix,limit:100,include:['customMetadata']});const jobs=listed.objects.flatMap(o=>o.customMetadata?.job?[JSON.parse(o.customMetadata.job) as Job]:[]).map(j=>j.id===current?.id?current:j).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   return json({available:!!env.RENDER_AGENT_TOKEN&&!!env.RENDER_DISPATCH_TOKEN,jobs});
  }
  if(request.method==='POST'){
   if(!env.RENDER_DISPATCH_TOKEN||!env.RENDER_AGENT_TOKEN)return json({message:'クラウド書き出しの接続設定がありません。'},503);
   if(current&&!terminal(current))return json({message:'別のMP4を書き出しています。'},409);
   const {courseId}=await read<{courseId:string}>(request);if(typeof courseId!=='string')return json({error:'invalid_course'},400);
   const response=await env.ROOM.getByName('classroom-v1').fetch(new Request(new URL('/api/render-package/'+encodeURIComponent(courseId),request.url),{headers:{'x-aituber-surface':'operator'}}));if(!response.ok)return response;
   const {course}=await response.json<{course:ReadonlyCoursePackage}>();if(!course.performance||course.durationMinutes>30)return json({message:'台本を保存した30分以内の教材を指定してください。'},400);
   const now=new Date().toISOString(),job:Job={id:'export.'+crypto.randomUUID(),courseId:course.id,title:course.title,status:'queued',frames:0,createdAt:now,updatedAt:now};
   await bucket.put(`render/packages/${job.id}`,JSON.stringify(course));if(!await save(job))return json({message:'別の書き出しが開始されました。'},409);
   try{
    const result=await dispatch('https://api.github.com/repos/mani1261790/AITuber/actions/workflows/render-mp4.yml/dispatches',{method:'POST',headers:{authorization:'Bearer '+env.RENDER_DISPATCH_TOKEN,'user-agent':'AITuber-Cloudflare','content-type':'application/json'},body:JSON.stringify({ref:'main',inputs:{job_id:job.id}}),signal:AbortSignal.timeout(15000)});
    if(!result.ok)throw Error('dispatch');
   }catch{
    await save({...job,status:'failed',error:'クラウド描画を開始できませんでした。',updatedAt:new Date().toISOString()});
    return json({message:'クラウド描画を開始できませんでした。'},502);
   }
   return json({job},202);
  }
 }
 const match=path.match(/^\/api\/video-exports\/(export\.[a-f0-9-]{36})(?:\/(file|cancel))?$/);
 if(match){const [,id,action]=match;const obj=current?.id===id?current:await (await bucket.get(jobsPrefix+id))?.json<Job>();if(!obj)return json({error:'unknown_job'},404);
  if(action==='cancel'&&request.method==='POST'){if(current?.id!==id||terminal(obj))return json({job:obj});const job={...obj,status:'cancelled',updatedAt:new Date().toISOString()};return await save(job)?json({job}):json({error:'conflict'},409);}
  if(action==='file'&&request.method==='GET'){if(obj.status!=='complete')return json({error:'not_complete'},409);const file=await bucket.get(`render/files/${id}.mp4`);return file?new Response(file.body,{headers:{'content-type':'video/mp4','content-length':String(file.size),'content-disposition':`attachment; filename="lecture.mp4"; filename*=UTF-8''${encodeURIComponent(obj.title+'.mp4')}`,'cache-control':'private, no-store'}}):json({error:'missing'},404);}
  if(!action&&request.method==='GET')return json({job:obj});
 }
 return json({error:'not_found'},404);
}
