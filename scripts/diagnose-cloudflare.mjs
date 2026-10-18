import {spawn} from 'node:child_process';
// Observe traffic only. Never send probe requests or print raw events/credentials.
const tail=spawn('pnpm',['exec','wrangler','tail','aituber','--format','json','--config','apps/cloudflare/wrangler.jsonc'],{detached:true,stdio:['ignore','pipe','pipe']});
let buffer='',captured=0;const counts=new Map();
function record(event){
 const request=event.event?.request;
 if(!request?.url)return;
 let path;try{path=new URL(request.url).pathname;}catch{return;}
 path=path.replace(/\/api\/classrooms\/[^/]+/,'/api/classrooms/[room]').replace(/\/api\/sessions\/(?!current)[^/]+/,'/api/sessions/[id]').replace(/\/api\/authoring\/jobs\/[^/]+/,'/api/authoring/jobs/[id]');
 const key=JSON.stringify({method:request.method,path,status:event.event?.response?.status??null,outcome:event.outcome??null});
 counts.set(key,(counts.get(key)??0)+1);captured++;
}
function drain(){
 let start=-1,depth=0,quoted=false,escaped=false,last=0;
 for(let i=0;i<buffer.length;i++){
  const ch=buffer[i];
  if(start<0){if(ch==='{'){start=i;depth=1;}continue;}
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){try{record(JSON.parse(buffer.slice(start,i+1)));}catch{/* Incomplete CLI output is not published. */}last=i+1;start=-1;}
 }
 if(last)buffer=buffer.slice(last);if(buffer.length>1_000_000)buffer='';
}
tail.stdout.on('data',chunk=>{buffer+=chunk.toString();drain();});
tail.stderr.on('data',()=>{});
await new Promise(resolve=>setTimeout(resolve,30000));
try{process.kill(-tail.pid,'SIGTERM');}catch{/* Already exited. */}
console.log(JSON.stringify({observedSeconds:30,captured,routes:[...counts].map(([key,count])=>({...JSON.parse(key),count}))},null,2));
if(!captured)console.log('No request events observed; this does not prove zero traffic.');
