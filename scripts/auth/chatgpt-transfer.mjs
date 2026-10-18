import {readFile,unlink} from 'node:fs/promises';
import {emitKeypressEvents} from 'node:readline';
const base='https://aituber.mani1261790.workers.dev';
const path='.data/chatgpt/transfer.json';
async function password(){
 if(process.env.AITUBER_OPERATOR_PASSWORD)return process.env.AITUBER_OPERATOR_PASSWORD;
 try{return JSON.parse(await readFile('.data/cloudflare/secrets.json','utf8')).OPERATOR_PASSWORD;}catch{/* Fall through to the hidden terminal prompt. */}
 if(!process.stdin.isTTY)throw new Error('管理用パスワードを入力できるターミナルで実行してください。');
 process.stdout.write('AITuber管理用パスワード（非表示）: ');emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const finish=()=>{process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};const key=(text,k)=>{if(k.ctrl&&k.name==='c'){finish();reject(new Error('中止しました。'));}else if(k.name==='return'){finish();resolve(value);}else if(k.name==='backspace')value=value.slice(0,-1);else if(text&&!k.ctrl&&!k.meta)value+=text;};process.stdin.on('keypress',key);});
}
try{
 const input=JSON.parse(await readFile(path,'utf8'));
 if(Date.now()-input.savedAt>30*60*1000)throw new Error('認証から30分以上経過しています。再認証してください。');
 const secret=await password();if(!secret)throw new Error('管理用パスワードがありません。');
 const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{origin:base},body:new URLSearchParams({password:secret}),signal:AbortSignal.timeout(30000)});
 if(login.status!==303)throw new Error(`管理ログインに失敗しました（HTTP ${login.status}）。`);
 const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('管理セッションを取得できませんでした。');
 const response=await fetch(base+'/api/settings/llm/chatgpt/import',{method:'POST',redirect:'error',headers:{origin:base,cookie,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`Cloudflareへの引き継ぎに失敗しました（HTTP ${response.status}）。認証情報は保護ファイルに残しています。`);
 const result=await response.json();if(result.settings?.chatgpt?.status!=='connected')throw new Error('Cloudflareの接続を確認できませんでした。');
 await unlink(path);
 console.log('Cloudflareへ接続を引き継ぎました。モデル: gpt-6-luna。Macを終了して構いません。');
}catch(error){console.error(error instanceof Error?error.message:'引き継ぎに失敗しました。');process.exitCode=1;}
