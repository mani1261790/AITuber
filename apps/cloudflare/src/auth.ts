const encoder=new TextEncoder();
export async function sameSecret(left: string, right: string): Promise<boolean> {
  if (!right) return false;
  const [a,b]=await Promise.all([left,right].map(v=>crypto.subtle.digest("SHA-256",encoder.encode(v))));
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let difference=0;
  for(let i=0;i<aa.length;i++)difference|=aa[i]!^bb[i]!;
  return difference===0;
}
async function sign(value: string, secret: string) {
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function issueSession(secret:string,now=Date.now()) {
 const expires=String(now+7*86400_000);return `${expires}.${await sign(expires,secret)}`;
}
export async function authenticated(request:Request,secret:string,now=Date.now()) {
 if(!secret)return false;
 const token=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).find(v=>v.startsWith("__Host-aituber="))?.slice(15);
 if(!token)return false;const [expires,signature]=token.split(".");
 if(!expires||!signature||!/^\d+$/.test(expires)||Number(expires)<=now||Number(expires)>now+7*86400_000)return false;
 return sameSecret(signature,await sign(expires,secret));
}
export function sameOrigin(request:Request) {
 return request.headers.get("origin")===new URL(request.url).origin;
}
export const loginHtml=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AITuber 管理ログイン</title><style>body{background:#121426;color:#f2f2fa;font:16px system-ui;margin:0;display:grid;min-height:100dvh;place-items:center}form{padding:24px;width:min(340px,80vw)}input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;border:1px solid #555;margin:12px 0;font:inherit}button{background:#c4baff;color:#151525;cursor:pointer}</style><form method="post" action="/login"><h1>AITuber</h1><p>管理用パスワードを入力してください。</p><label>パスワード<input type="password" name="password" required autocomplete="current-password"></label><button>ログイン</button></form></html>`;
