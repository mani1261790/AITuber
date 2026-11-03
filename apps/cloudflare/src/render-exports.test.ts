import {it,expect} from 'vitest';
import {renderExports} from './render-exports';
import type {AppEnv} from './index';
function setup(){
 let serial=0;const store=new Map<string,{text:string;etag:string;customMetadata?:Record<string,string>}>();
 const bucket={async get(key:string){const row=store.get(key);return row?{...row,json:async()=>JSON.parse(row.text),text:async()=>row.text,body:row.text,size:row.text.length}:null;},async put(key:string,text:string,options?:{onlyIf?:{etagMatches?:string;etagDoesNotMatch?:string};customMetadata?:Record<string,string>}){const previous=store.get(key);if(options?.onlyIf?.etagMatches&&previous?.etag!==options.onlyIf.etagMatches||options?.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;const row={text,etag:String(++serial),customMetadata:options?.customMetadata};store.set(key,row);return row;},async list(){return {objects:[...store].filter(([key])=>key.startsWith('render/jobs/')).map(([key,row])=>({key,...row}))};}};
 const env={STATE:bucket,RENDER_AGENT_TOKEN:'private-agent',ROOM:{getByName:()=>({fetch:async()=>Response.json({course:{id:'course',title:'test',durationMinutes:1,performance:{units:[]},sources:[{id:'pdf',kind:'pdf',contentHash:'sha256:hash'}]}})})}} as unknown as AppEnv;
 const call=(path:string,method='GET',body?:unknown,agent=false)=>renderExports(new Request('https://example.com/api/'+path,{method,headers:agent?{authorization:'Bearer private-agent'}:{},...(body?{body:JSON.stringify(body)}:{})}),env,agent);
 return {store,env,call};
}
it('rejects agent credentials before accessing storage',async()=>{const env={RENDER_AGENT_TOKEN:'secret'} as AppEnv;expect((await renderExports(new Request('https://example.com/api/render-agent/poll',{method:'POST'}),env,true)).status).toBe(401);});
it('requires an online worker and serializes start; cancellation prevents upload',async()=>{
 const {call}=setup();expect((await call('video-exports','POST',{courseId:'course'})).status).toBe(503);
 await call('render-agent/poll','POST',undefined,true);const start=await call('video-exports','POST',{courseId:'course'});expect(start.status).toBe(202);const {job}=await start.json() as {job:{id:string}};
 expect((await call('video-exports','POST',{courseId:'course'})).status).toBe(409);
 const claim=await call('render-agent/poll','POST',undefined,true);expect((await claim.json() as {job:{status:string}}).job.status).toBe('preparing');
 expect((await call(`render-agent/${job.id}/source?id=other`,'GET',undefined,true)).status).toBe(404);
 await call(`video-exports/${job.id}/cancel`,'POST');expect((await call(`render-agent/${job.id}/file`,'PUT',{},true)).status).toBe(409);expect((await call(`video-exports/${job.id}/file`)).status).toBe(409);
});
it('limits worker status updates and does not allow completion without a file',async()=>{const {call}=setup();await call('render-agent/poll','POST',undefined,true);const {job}=await(await call('video-exports','POST',{courseId:'course'})).json() as {job:{id:string}};expect((await call(`render-agent/${job.id}/status`,'PUT',{status:'complete',frames:30},true)).status).toBe(400);expect((await call(`render-agent/${job.id}/status`,'PUT',{status:'rendering',frames:-1},true)).status).toBe(400);});
