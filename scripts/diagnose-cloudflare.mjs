import { spawn } from 'node:child_process';
const tail = spawn('pnpm', ['exec', 'wrangler', 'tail', 'aituber', '--format', 'json'], {stdio:['ignore','pipe','pipe']});
let output = '';
tail.stdout.on('data', chunk => { output += chunk; });
tail.stderr.on('data', () => {});
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
