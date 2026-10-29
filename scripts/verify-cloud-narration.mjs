// Read back deployed code; never print the source or credentials.
const response = await fetch('https://api.cloudflare.com/client/v4/accounts/2ea670c2a6ff28e248ef084adf095e8b/workers/scripts/aituber', {
  headers: {Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Deployed code verification failed: HTTP ${response.status}`);
const source = (await response.text()).replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const expected = '問題を読んで、当てはまる答えを選んでください。';
if (!source.includes(expected) || source.includes('画面下の問題を読んで')) {
  throw new Error('Deployed assessment narration does not match the corrected default.');
}
console.log('Verified deployed assessment narration: location-independent instructions.');
