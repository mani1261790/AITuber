// Verify the authenticated API, including Durable Object rollout, without creating jobs.
const base = 'https://aituber.mani1261790.workers.dev';
const password = process.env.OPERATOR_PASSWORD;
if (!password) throw new Error('OPERATOR_PASSWORD is required for operator rollout verification.');
const login = await fetch(`${base}/login`, {method:'POST',redirect:'manual',headers:{origin:base},body:new URLSearchParams({password}),signal:AbortSignal.timeout(20000)});
if (login.status !== 303) throw new Error(`Operator login failed (HTTP ${login.status}).`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Operator login did not issue a session.');
const probe = 'authoring.00000000-0000-0000-0000-000000000000';
for (let attempt = 1; attempt <= 60; attempt++) {
  // A nonexistent ID exercises the stop handler without changing persistent state.
  const response = await fetch(`${base}/api/authoring/jobs/${probe}/stop`, {method:'POST',headers:{cookie,origin:base},signal:AbortSignal.timeout(20000)});
  const value = await response.json();
  if (response.status === 404 && value.message === 'Unknown authoring job') {
    const jobs = await fetch(`${base}/api/authoring/jobs`, {headers:{cookie},signal:AbortSignal.timeout(20000)});
    if (!jobs.ok) throw new Error(`Operator jobs read failed (HTTP ${jobs.status}).`);
    const {jobs: items} = await jobs.json();
    if (!Array.isArray(items)) throw new Error('Operator jobs response is invalid.');
    console.log('PASS: authenticated operator API and Durable Object stop handler are live; no job was created or modified.');
    process.exit(0);
  }
  if (response.status !== 404 && response.status !== 503) throw new Error(`Unexpected rollout probe response (HTTP ${response.status}).`);
  if (attempt % 6 === 1) console.log(`Waiting for Durable Object rollout (${attempt}/60).`);
  if (attempt < 60) await new Promise(resolve => setTimeout(resolve, 10000));
}
throw new Error('Worker assets deployed, but the Durable Object stop handler did not become available within the rollout check window.');
