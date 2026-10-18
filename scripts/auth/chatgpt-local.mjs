import {createServer} from 'node:http';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const requireServer=createRequire(new URL('../../apps/server/package.json',import.meta.url));
const {createRemoteJWKSet,jwtVerify}=await import(pathToFileURL(requireServer.resolve('jose')).href);
const directory=resolve('.data/chatgpt');await mkdir(directory,{recursive:true,mode:0o700});
const registrationPath=resolve(directory,'registration.json'), credentialPath=resolve(directory,'transfer.json');
let registration;try{registration=JSON.parse(await readFile(registrationPath,'utf8'));}catch{registration={hostId:`urn:uuid:${randomUUID()}`};}
await writeFile(registrationPath,JSON.stringify(registration),{mode:0o600});
const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
const issuer='https://auth.openai.com', resource='https://api.openai.com/v1';
let callback,authorization,used=false;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,callback);
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/'){res.end('<!doctype html><meta charset="utf-8"><title>AITuber ChatGPT接続</title><h1>AITuberをChatGPTに接続</h1><p>認証後、この接続を自分のCloudflareへ渡して教材・台本・板書を生成します。Macの常時起動は不要です。</p><a href="/start">Continue with ChatGPT</a>');return;}
  if(url.pathname==='/start'){res.writeHead(302,{Location:authorization});res.end();return;}
  if(url.pathname!=='/auth/callback'){res.writeHead(404);res.end();return;}
  if(used||url.searchParams.get('state')!==state)throw new Error('認証を開始した画面からやり直してください。');
  used=true;
  if(url.searchParams.has('error'))throw new Error('ChatGPT接続が許可されませんでした。');
  const clientId=url.searchParams.get('client_id')||registration.clientId;
  if(!clientId||clientId==='dynamic_agent_client'||registration.clientId&&registration.clientId!==clientId)throw new Error('認証クライアントを確認できませんでした。');
  const code=url.searchParams.get('code');if(!code)throw new Error('認証コードがありません。');
  const response=await fetch(`${issuer}/api/accounts/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:callback,resource}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`認証コードの交換に失敗しました（HTTP ${response.status}）。`);
  const tokens=await response.json();
  const {payload}=await jwtVerify(tokens.id_token,createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),{issuer,audience:clientId,requiredClaims:['sub','exp','iat']});
  if(registration.subject && registration.subject!==payload.sub)throw new Error('認証アカウントが以前の接続と異なります。');
  if(payload.nonce!==nonce)throw new Error('認証nonceが一致しません。');
  if(!tokens.scope?.split(' ').includes('chatgpt.tokens.use.direct'))throw new Error('ChatGPTプラン利用が許可されていません。');
  if(!tokens.refresh_token||!tokens.access_token)throw new Error('更新可能な認証情報がありません。');
  const saved={clientId,nonce,tokens,savedAt:Date.now()};
  await writeFile(credentialPath+'.tmp',JSON.stringify(saved),{mode:0o600});await rename(credentialPath+'.tmp',credentialPath);
  await writeFile(registrationPath,JSON.stringify({...registration,clientId,subject:payload.sub}),{mode:0o600});
  res.end('<!doctype html><meta charset="utf-8"><h1>認証できました</h1><p>この画面を閉じて構いません。Cloudflareへの接続と教材生成を確認します。</p>');
  console.log('CHATGPT_AUTH_SUCCESS: protected transfer file saved; no credentials logged.');server.close();clearTimeout(timeout);
 }catch(error){process.exitCode=1;res.statusCode=400;res.end('<!doctype html><meta charset="utf-8"><h1>接続できませんでした</h1><p>Codexで接続状況を確認してください。</p>');console.error('CHATGPT_AUTH_FAILED',error instanceof Error&&/^(認証|ChatGPT|更新)/.test(error.message)?error.message:'認証情報を検証できませんでした。');server.close();clearTimeout(timeout);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;callback=`http://127.0.0.1:${port}/auth/callback`;
const auth=new URL(`${issuer}/api/accounts/authorize`);auth.search=new URLSearchParams({client_id:registration.clientId||'dynamic_agent_client',...(!registration.clientId?{agent_name_hint:'AITuber'}:{}),ext_agent_host_id:registration.hostId,response_type:'code',redirect_uri:callback,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();authorization=auth.toString();
const timeout=setTimeout(()=>{console.error('CHATGPT_AUTH_EXPIRED');process.exitCode=1;server.close();},15*60*1000);
console.log(`Open http://127.0.0.1:${port}/ on this Mac to connect AITuber.`);
spawn('open',[`http://127.0.0.1:${port}/`],{stdio:'ignore'});
