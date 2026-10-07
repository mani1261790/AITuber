import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { japanesePdf } from './fixtures/japanese-pdf.mjs';

// Real workerd + SQLite DO + local R2; never uses Cloudflare credentials or paid APIs.
const directory=await mkdtemp(join(tmpdir(),'aituber-worker-test-'));
const config=JSON.parse(await readFile('apps/cloudflare/wrangler.jsonc','utf8'));
config.name='aituber-native-test';delete config.account_id;
config.main=resolve('apps/cloudflare/src/index.ts');
config.assets.directory=resolve('dist/cloudflare');
config.alias=Object.fromEntries(Object.entries(config.alias).map(([key,value])=>[key,resolve('apps/cloudflare',value)]));
config.vars={...config.vars,OPERATOR_PASSWORD:'native-runtime-test-password',FISH_API_KEY:'',FISH_VOICE_ID:'',OPENAI_API_KEY:''};
await writeFile(join(directory,'wrangler.json'),JSON.stringify(config));
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`;
let child,log='',cookie='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
  child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',join(directory,'wrangler.json'),'--port',String(port),'--inspector-port','0','--local','--persist-to',join(directory,'state')],{detached:true,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log+=chunk.toString();});
  for(let attempt=0;attempt<90;attempt++){try{if((await fetch(base+'/login')).status===200)return;}catch{/* Starting workerd. */}if(child.exitCode!==null)break;await delay(500);}
  throw new Error('Local Worker did not start');
}
async function stop(){if(!child||child.exitCode!==null)return;const closed=once(child,'exit');process.kill(-child.pid,'SIGTERM');await closed;child=undefined;}
async function api(path,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,`${path}: ${response.status} ${response.ok?'':await response.text()}`);return response.json();}
try{
 await start();
 assert.equal((await fetch(base+'/api/courses')).status,401);
 assert.equal((await fetch(base+'/_internal/state')).status,404);
 const login=await fetch(base+'/login',{method:'POST',headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:config.vars.OPERATOR_PASSWORD}),redirect:'manual'});assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+'/api/sessions',{method:'POST',headers:{cookie,origin:'https://untrusted.example'},body:'{}'})).status,403);
 const {courses}=await api('/api/courses');assert.ok(courses.length>0);
 const {session,classroom}=await api('/api/sessions',{coursePackageId:courses[0].id,durationMinutes:5});
 await api(`/api/sessions/${session.id}/commands`,{command:'pause'});
 const joined=await api('/api/classrooms/join',{code:classroom.code});const accessToken=joined.participant.accessToken;
 const socket=new WebSocket(base.replace('http:','ws:')+`/api/classrooms/${classroom.code}/stream?token=${accessToken}`);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket snapshot timeout')),10000);socket.onmessage=event=>{try{assert.equal(JSON.parse(event.data).type,'snapshot');clearTimeout(timer);socket.close();resolve();}catch(error){reject(error);}};socket.onerror=reject;});
 const {job}=await api('/api/authoring/jobs',{durationMinutes:5,sources:[{fileName:'japanese.pdf',mimeType:'application/pdf',dataBase64:japanesePdf('二次関数'),rights:{basis:'owned'}}]});assert.equal(job.sourceCount,1);
 await stop();await start();
 const restored=await api('/api/sessions/current');assert.equal(restored.session.id,session.id);assert.equal(restored.session.status,'PAUSED');assert.equal(restored.classroom.code,classroom.code);assert.ok(restored.session.epoch>session.epoch);
 const reconnected=await api(`/api/classrooms/${classroom.code}/reconnect`,{accessToken});assert.equal(reconnected.participant.id,joined.participant.id);
 assert.equal((await api(`/api/authoring/jobs/${job.id}`)).job.sourceCount,1);
 assert.equal((await fetch(base+`/api/classrooms/${classroom.code}/reconnect`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({accessToken:'invalid'})})).status,401);
 console.log('PASS: Worker auth, origin checks, SQLite session, WebSocket, Japanese PDF, job persistence, restart, participant reconnect.');
} catch(error){console.error(log.slice(-12000));throw error;}
finally{await stop();await rm(directory,{recursive:true,force:true});}
