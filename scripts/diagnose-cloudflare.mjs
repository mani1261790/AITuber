import { spawn } from 'node:child_process';
const tail = spawn('pnpm', ['exec', 'wrangler', 'tail', 'aituber', '--format', 'json', '--config', 'apps/cloudflare/wrangler.jsonc'], {stdio:['ignore','pipe','pipe']});
let output = '';
tail.stdout.on('data', chunk => { output += chunk; });
let diagnostics = '';
tail.stderr.on('data', chunk => { diagnostics += chunk; });
try {
  await new Promise(resolve => setTimeout(resolve, 12000));
  const base = 'https://aituber.mani1261790.workers.dev';
  const login = await fetch(base + '/login', {method:'POST',redirect:'manual',headers:{origin:base},body:new URLSearchParams({password:process.env.OPERATOR_PASSWORD}),signal:AbortSignal.timeout(15000)});
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Operator login failed');
  for (const path of ['/api/courses','/api/sessions/current','/api/authoring/jobs','/api/settings/llm']) {
    const response = await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(15000)});
    console.log(`${path}: ${response.status}`);
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
} finally { tail.kill('SIGTERM'); }
// Never publish request headers, bodies, cookies, or the raw tail stream.
const messages = [...output.matchAll(/"message"\s*:\s*(\[[\s\S]*?\])/g)];
for (const match of messages) {
  try { const value=JSON.parse(match[1]); if(value[0]==='lecture_request_failed') console.log(JSON.stringify(value)); } catch { /* Ignore incomplete streaming records. */ }
}
if (!messages.length) console.log('No application log messages captured.');

if (!messages.length) {
  let safe = diagnostics;
  for (const secret of [process.env.CLOUDFLARE_API_TOKEN, process.env.OPERATOR_PASSWORD].filter(Boolean)) safe = safe.split(secret).join('[redacted]');
  console.log('Tail exit:', tail.exitCode, 'diagnostics:', safe.slice(0,3000));
  console.log('Tail output bytes:', output.length);
}

if (!messages.length) {
  const rows = output.split('\n');
  for (let i=0; i<rows.length; i++) {
    if (/lecture_request_failed/.test(rows[i])) console.log(rows.slice(i,i+3).join(' ').slice(0,1000));
  }
  console.log('Log field counts:', JSON.stringify(Object.fromEntries(['message','logs','exceptions','error','outcome'].map(key => [key, output.split('"'+key+'"').length-1]))));
  // Only CLI startup text before the first JSON event, never event request data.
  console.log('Tail startup:', output.split('{')[0].slice(0,1000));
}
