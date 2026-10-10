const base='https://aituber.mani1261790.workers.dev';
for(const [path,expected] of [['/login',200],['/api/courses',401],['/api/settings/llm/board-preview',401],['/_internal/state',404]]){
 let actual='unreachable';
 for(let attempt=0;attempt<12;attempt++){
  try{const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(10000)});actual=response.status;await response.body?.cancel();}catch{actual='unreachable';}
  if(actual===expected)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(actual!==expected)throw new Error(`${path}: expected HTTP ${expected}, received ${actual}`);
 console.log(`PASS ${path}: HTTP ${actual}`);
}
// New static assets can lag the Worker rollout. Retry the asset response, but
// still validate its contents so an HTML fallback cannot pass as a model.
async function fetchPublished(path,options={}){
 for(let attempt=0;attempt<12;attempt++){
  const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(30000)});
  if(response.status!==404 || attempt===11)return response;
  await response.body?.cancel();
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}
const model=await fetchPublished('/models/teacher-floral-v10.vrm',{headers:{Range:'bytes=0-11'},signal:AbortSignal.timeout(30000)});
if(!model.ok)throw new Error(`Hosted motion-lab model: HTTP ${model.status}`);
const bytes=new Uint8Array(await model.arrayBuffer());
if(String.fromCharCode(...bytes.slice(0,4))!=='glTF')throw new Error('Hosted model is not a GLB/VRM');
console.log('PASS hosted motion-lab VRM');
const credit=await fetchPublished('/models/teacher-floral-v10-NOTICE.md');
if(!credit.ok || !(await credit.text()).includes('5794724'))throw new Error('Hosted model attribution missing');
console.log('PASS hosted model attribution');
