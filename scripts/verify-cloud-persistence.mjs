import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
let archive=null,saved=0,child;
const state=createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer test-state'){res.writeHead(403);res.end();return;}
 if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);archive=Buffer.concat(chunks);saved++;res.writeHead(204);res.end();}
 else{res.writeHead(archive?200:404);res.end(archive);}
});
await new Promise(r=>state.listen(4392,'0.0.0.0',r));
const directories=[];
async function launch(){
 const directory=await mkdtemp(join(tmpdir(),'aituber-cloud-test-'));directories.push(directory);
 child=process.argv.includes('--container')
  ? spawn('docker',['run','--rm','-p','127.0.0.1:8080:8080','-e','AITUBER_TTS_TEST_MODE=tone','-e','CLOUD_STATE_URL=http://host.docker.internal:4392/state','-e','CLOUD_STATE_SECRET=test-state','aituber-cloud:local'],{stdio:['ignore','pipe','pipe']})
  : spawn(process.execPath,['scripts/cloud-runtime.mjs'],{env:{...process.env,AITUBER_DATA_DIR:directory,AITUBER_PORT:'4391',AITUBER_TTS_TEST_MODE:'tone',CLOUD_STATE_URL:'http://127.0.0.1:4392/state',CLOUD_STATE_SECRET:'test-state'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch('http://127.0.0.1:8080/healthz')).ok)return;}catch{ /* Wait for the child listener. */ }await new Promise(r=>setTimeout(r,100));}
 throw new Error('Startup timeout '+logs);
}
async function stop(){if(!child||child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
try{
 await launch();
 const response=await fetch('http://127.0.0.1:8080/api/settings/llm',{method:'PUT',headers:{'x-aituber-surface':'operator','content-type':'application/json'},body:JSON.stringify({apiKey:'test-api-key',model:'gpt-6-luna',baseUrl:'https://api.openai.com/v1'})});
 assert.equal(response.status,200);assert(saved>0);assert(archive.length>0);
 await stop();await launch();
 const result=await(await fetch('http://127.0.0.1:8080/api/settings/llm',{headers:{'x-aituber-surface':'operator'}})).json();
 assert.equal(result.settings.model,'gpt-6-luna');assert.equal(result.settings.apiKeyConfigured,true);
 console.log('PASS: mutation saved before response; empty replacement runtime restored settings and database.');
}finally{await stop();state.closeAllConnections();await new Promise(r=>state.close(r));for(const d of directories)await rm(d,{recursive:true,force:true});}
