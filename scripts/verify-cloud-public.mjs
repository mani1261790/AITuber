const base='https://aituber.mani1261790.workers.dev';
for(const [path,expected] of [['/login',200],['/api/courses',401],['/_internal/state',404]]){
 let actual='unreachable';
 for(let attempt=0;attempt<12;attempt++){
  try{const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(10000)});actual=response.status;await response.body?.cancel();}catch{actual='unreachable';}
  if(actual===expected)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(actual!==expected)throw new Error(`${path}: expected HTTP ${expected}, received ${actual}`);
 console.log(`PASS ${path}: HTTP ${actual}`);
}
