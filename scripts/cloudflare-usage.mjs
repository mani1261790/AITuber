import {mkdir,writeFile} from 'node:fs/promises';

// Read-only account diagnostics. Never persist credentials or HTTP headers.
const account='2ea670c2a6ff28e248ef084adf095e8b';
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw Error('CLOUDFLARE_API_TOKEN is required');
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const report={capturedAt:new Date().toISOString(),account};
async function request(path,body){
 const response=await fetch(`https://api.cloudflare.com/client/v4/${path}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const value=await response.json();
 return {status:response.status,...value};
}
for(const [label,path] of [['workers',`accounts/${account}/workers/scripts`],['namespaces',`accounts/${account}/workers/durable_objects/namespaces?per_page=1000`]]){
 const response=await request(path);
 report[label]={status:response.status,errors:response.errors,result_info:response.result_info,result:Array.isArray(response.result)?response.result.map(({id,name,script,class:className,use_sqlite})=>({id,name,script,class:className,use_sqlite})):undefined};
}
const schema=await request('graphql',{query:'{__schema{types{name fields{name type{kind name ofType{kind name ofType{kind name}}}} inputFields{name type{kind name ofType{kind name}}}}}}'});
report.schema={status:schema.status,errors:schema.errors,types:schema.data?.__schema?.types.filter(type=>/Account(DurableObjects|WorkersInvocations)/.test(type.name))};
await mkdir('output/cloudflare-usage',{recursive:true});
await writeFile('output/cloudflare-usage/report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({capturedAt:report.capturedAt,workers:report.workers,namespaces:report.namespaces,schema:{status:report.schema.status,errors:report.schema.errors,types:report.schema.types?.map(t=>t.name)}}));
