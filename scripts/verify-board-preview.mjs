import {mkdir,writeFile} from 'node:fs/promises';
const base='https://aituber.mani1261790.workers.dev';
if(!process.env.OPERATOR_PASSWORD)throw new Error('Operator credentials required');
const login=await fetch(base+'/login',{method:'POST',headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:process.env.OPERATOR_PASSWORD}),redirect:'manual',signal:AbortSignal.timeout(15000)});
if(login.status!==303)throw new Error(`Login failed: ${login.status}`);
const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('No session cookie');
const results=[];
for(let example=0;example<3;example++){
 const response=await fetch(base+'/api/settings/llm/board-preview',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({example}),signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw new Error(`Preview ${example}: HTTP ${response.status}`);
 const result=await response.json();if(!result.drawing?.markdown || !result.text)throw new Error('Missing generated board or speech');
 results.push(result);console.log(JSON.stringify({example,model:result.model,latencyMs:result.latencyMs,usage:result.usage,lines:result.drawing.markdown.split('\n').length}));
}
await mkdir('output/board-preview',{recursive:true});await writeFile('output/board-preview/results.json',JSON.stringify(results,null,2));
