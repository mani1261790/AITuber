// The container owns one lecture runtime. Durable files are restored before the API
// starts, flushed after mutations, periodically during jobs, and before shutdown.
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, copyFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { LectureEventStore } from '../packages/storage/dist/index.js';
const exec=promisify(execFile);
const directory=process.env.AITUBER_DATA_DIR??'/data';
const stateUrl=process.env.CLOUD_STATE_URL;
const secret=process.env.CLOUD_STATE_SECRET;
if(!stateUrl||!secret)throw new Error('Cloud state connection is required');
const headers={authorization:`Bearer ${secret}`};
await mkdir(directory,{recursive:true});
const restore=await fetch(stateUrl,{headers,signal:AbortSignal.timeout(60000)});
if(restore.ok){
 const temp=await mkdtemp(join(tmpdir(),'aituber-restore-'));
 try {
  const file=join(temp,'state.tar.gz');
  const {createWriteStream}=await import('node:fs');
  await pipeline(restore.body,createWriteStream(file));
  const {stdout}=await exec('tar',['-tzf',file]);
  if(stdout.split('\n').some(p=>p&&(p.startsWith('/')||p.split('/').includes('..'))))throw new Error('Invalid archive path');
  await exec('tar',['-xzf',file,'--no-same-owner','-C',directory]);
 } finally{await rm(temp,{recursive:true,force:true});}
}else if(restore.status!==404){throw new Error(`State restore failed: ${restore.status}`);}
const api=spawn(process.execPath,['apps/server/dist/index.js'],{env:process.env,stdio:'inherit'});
let stopping=false;
api.on('exit',code=>{if(!stopping)process.exit(code??1);});
const apiPort=Number(process.env.AITUBER_PORT??4310);
let healthy=false;
for(let i=0;i<150;i++){
 try{healthy=(await fetch(`http://127.0.0.1:${apiPort}/healthz`)).ok;}catch{ /* API may still be starting. */ }
 if(healthy)break;
 await new Promise(r=>setTimeout(r,200));
}
if(!healthy)throw new Error('API startup failed');
let pending=Promise.resolve();
async function checkpoint(){
 const task=pending.catch(()=>{}).then(async()=>{
  const temp=await mkdtemp(join(tmpdir(),'aituber-save-'));
  try{
   const contents=join(temp,'contents');await mkdir(contents);
   const database=new LectureEventStore(join(directory,'aituber.db'));
   try{await database.backup(join(contents,'aituber.db'));}finally{database.close();}
   for(const name of ['authoring','llm-settings.json','blackboard-svg'])await copyStable(join(directory,name),join(contents,name));
   const archive=join(temp,'state.tar.gz');await exec('tar',['-czf',archive,'-C',contents,'.']);
   const {size}=await stat(archive);
   if(size>95*1024*1024)throw new Error('State archive exceeds 95 MiB');
   const result=await fetch(stateUrl,{method:'PUT',headers:{...headers,'content-type':'application/gzip','content-length':String(size)},body:createReadStream(archive),duplex:'half',signal:AbortSignal.timeout(60000)});
   if(!result.ok)throw new Error(`State save failed: ${result.status}`);
   console.log(JSON.stringify({event:'checkpoint_saved',bytes:size}));
  }finally{await rm(temp,{recursive:true,force:true});}
 });pending=task;return task;
}
async function copyStable(source,destination){
 let info;try{info=await stat(source);}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(info.isDirectory()){
  await mkdir(destination,{recursive:true});
  for(const name of await readdir(source))if(!name.endsWith('.tmp'))await copyStable(join(source,name),join(destination,name));
 }else if(info.isFile())await copyFile(source,destination);
}
let timerBusy=false;
const timer=setInterval(()=>{
 if(timerBusy||stopping)return;
 timerBusy=true;checkpoint().catch(e=>console.error(JSON.stringify({event:'checkpoint_failed',message:e.message}))).finally(()=>{timerBusy=false;});
},15000);
const server=createServer((req,res)=>{
 if(req.url==='/healthz'){res.writeHead(200);res.end('ok');return;}
 if(!req.url?.startsWith('/api/')){res.writeHead(404);res.end();return;}
 const upstream=httpRequest({host:'127.0.0.1',port:apiPort,path:req.url,method:req.method,headers:req.headers},async incoming=>{
  // Do not report a successful management mutation before its durable checkpoint.
  const durable=req.headers['x-aituber-surface']==='operator'&&!['GET','HEAD'].includes(req.method??'GET')&&(incoming.statusCode??500)<400;
  if(durable){
   try{
    const chunks=[];let size=0;
    for await(const chunk of incoming){size+=chunk.length;if(size>16*1024*1024)throw new Error('Response too large');chunks.push(chunk);}
    await checkpoint();res.writeHead(incoming.statusCode??200,incoming.headers);res.end(Buffer.concat(chunks));
   }catch{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'persistence_failed',message:'保存の確認に失敗しました。状態を再読み込みしてください。'}));}
  }else{res.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(res);}
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
 if(!req.url?.startsWith('/api/classrooms/')){socket.destroy();return;}
 const upstream=connect(apiPort,'127.0.0.1',()=>{
  upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).flatMap(([key,value])=>Array.isArray(value)?value.map(v=>`${key}: ${v}`):value===undefined?[]:[`${key}: ${value}`]).join('\r\n')}\r\n\r\n`);
  if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
 });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});
server.listen(8080,'0.0.0.0');
async function shutdown(){
 if(stopping)return;stopping=true;clearInterval(timer);server.close();
 const deadline=setTimeout(()=>process.exit(1),120000);
 try{
  await new Promise(resolve=>{api.once('exit',resolve);api.kill('SIGTERM');});
  await checkpoint();clearTimeout(deadline);process.exit(0);
 }catch(e){console.error(e.message);process.exit(1);}
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
