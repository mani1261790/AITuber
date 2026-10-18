import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';

// Real workerd + SQLite DO + local R2; never uses Cloudflare credentials or paid APIs.
const directory=await mkdtemp(join(tmpdir(),'aituber-worker-test-'));
await mkdir('output/cloudflare-usage',{recursive:true});
const config=JSON.parse(await readFile('apps/cloudflare/wrangler.jsonc','utf8'));
config.name='aituber-native-test';delete config.account_id;
config.main=resolve('scripts/fixtures/storage-meter-worker.ts');
config.assets.directory=resolve('dist/cloudflare');
config.alias=Object.fromEntries(Object.entries(config.alias).map(([key,value])=>[key,resolve('apps/cloudflare',value)]));
config.vars={...config.vars,OPERATOR_PASSWORD:'native-runtime-test-password',FISH_API_KEY:'',FISH_VOICE_ID:'',OPENAI_API_KEY:'',AITUBER_TTS_TEST_MODE:'tone'};
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
 const report={environment:'local workerd + SQLite, synthetic fixtures, manual alarms, no external AI calls',measurements:{}};
 async function measure(label,fn){await api('/api/__meter');await fn();report.measurements[label]=await api('/api/__meter');console.log(label,JSON.stringify(report.measurements[label]));}
 report.measurements.coldStart=await api('/api/__meter');
 report.scanComparison=await api('/api/__scan_comparison');
 const {courses}=await api('/api/courses');
 const poll=async()=>{const snapshot=await api('/api/operator/snapshot');assert.ok(Array.isArray(snapshot.jobs));assert.ok(snapshot.settings);};
 await measure('emptyOperator100Polls',async()=>{for(let i=0;i<100;i++)await poll();});
 const {session,classroom}=await api('/api/sessions',{coursePackageId:courses[0].id,durationMinutes:5});
 await api(`/api/sessions/${session.id}/commands`,{command:'pause'});
 const joined=await api('/api/classrooms/join',{code:classroom.code});
 const accessToken=joined.participant.accessToken;
 await measure('pausedOperator100Polls',async()=>{for(let i=0;i<100;i++)await poll();});
 await measure('createAndStop20TextJobs',async()=>{for(let i=0;i<20;i++){
  const {job}=await api('/api/authoring/jobs',{durationMinutes:5,costBudgetUsd:0,sources:[{fileName:'note.txt',mimeType:'text/plain',dataBase64:Buffer.from(('教材検証用の資料です。'+i).repeat(100)).toString('base64'),rights:{basis:'owned'}}]});
  await api(`/api/authoring/jobs/${job.id}/stop`,{});
 }});
 await measure('twentyJobsOperator100Polls',async()=>{for(let i=0;i<100;i++)await poll();});
 await measure('idleAlarm',async()=>{await api('/api/__alarm');});
 await measure('reconnect100',async()=>{for(let i=0;i<100;i++)await api(`/api/classrooms/${classroom.code}/reconnect`,{accessToken});});
 await api(`/api/sessions/${session.id}/commands`,{command:'resume'});
 await measure('teachingOperator100Polls',async()=>{for(let i=0;i<100;i++)await poll();});
 await api(`/api/sessions/${session.id}/commands`,{command:'pause'});
 await stop();await start();
 await api('/api/sessions/current');
 report.measurements.restartWith20Jobs=await api('/api/__meter');
 await measure('restoredOperator100Polls',async()=>{for(let i=0;i<100;i++)await poll();});
 for(const label of ['emptyOperator100Polls','pausedOperator100Polls','twentyJobsOperator100Polls','restoredOperator100Polls'])assert.equal(report.measurements[label].sqlReads,0,`${label} must not reread checkpoints`);
 assert.equal(report.scanComparison.oldReads,5000);assert.ok(report.scanComparison.fixedReads<=1);
 const {job:pending}=await api('/api/authoring/jobs',{durationMinutes:5,costBudgetUsd:0,sources:[{fileName:'recovery.txt',mimeType:'text/plain',dataBase64:Buffer.from('停止後の復旧検証').toString('base64'),rights:{basis:'owned'}}]});
 await api('/api/__recovery');await stop();await start();
 const recovered=await api('/api/operator/snapshot');assert.equal(recovered.jobs.find(job=>job.id===pending.id).status,'stopped');assert.equal(recovered.session.status,'PAUSED');report.resetDoesNotResumeWork=true;
 await api('/api/__trip');await stop();await start();
 const blocked=await fetch(base+'/api/operator/snapshot',{headers:{cookie}});assert.equal(blocked.status,503);
 assert.equal((await blocked.json()).error,'storage_quota_exceeded');report.persistedSafetyStop=true;
 await writeFile('output/cloudflare-usage/local-meter.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
} catch(error){await delay(500);await writeFile('output/cloudflare-usage/meter-error.log',log);console.error(log.slice(-2000));throw error;}
finally{await stop();await rm(directory,{recursive:true,force:true});}
