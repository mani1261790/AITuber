import { Container } from "@cloudflare/containers";
import { authenticated, issueSession, loginHtml, sameOrigin, sameSecret } from "./auth.ts";
type AppEnv = Env & { OPERATOR_PASSWORD: string; STATE_SECRET: string; FISH_API_KEY?: string; FISH_VOICE_ID?: string; OPENAI_API_KEY?: string };
export class LectureBackend extends Container<AppEnv> {
 defaultPort=8080;
 sleepAfter="20m";
 enableInternet=true;
 override async fetch(request:Request):Promise<Response> {
  this.envVars={
   CLOUD_STATE_URL:`${new URL(request.url).origin}/_internal/state`,
   CLOUD_STATE_SECRET:this.env.STATE_SECRET,
   AITUBER_LLM_MODEL:this.env.LLM_MODEL,
   AITUBER_LLM_BASE_URL:"https://api.openai.com/v1",
   AITUBER_LLM_API_KEY:this.env.OPENAI_API_KEY??"",
   AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS:this.env.LLM_INPUT_PRICE,
   AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS:this.env.LLM_OUTPUT_PRICE,
   AITUBER_FISH_AUDIO_API_KEY:this.env.FISH_API_KEY??"",
   ...(this.env.FISH_VOICE_ID?{AITUBER_FISH_AUDIO_VOICE_ID:this.env.FISH_VOICE_ID}:{}),
   AITUBER_FISH_AUDIO_MODEL:"s2.1-pro-free",
   AITUBER_AUTHORING_DAILY_BUDGET_USD:"2",
   AITUBER_RUNTIME_DAILY_BUDGET_USD:"2"
  };
  return super.fetch(request);
 }
}
const secureHeaders={"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY"};
export default {
 async fetch(request:Request,env:AppEnv):Promise<Response> {
  const url=new URL(request.url), path=url.pathname;
  if(path==="/_internal/state") {
   if(!await sameSecret(request.headers.get("authorization")??"",`Bearer ${env.STATE_SECRET}`)||!env.STATE_SECRET)return new Response("Not found",{status:404});
   if(request.method==="GET") {const o=await env.STATE.get("state/current.tar.gz");return o?new Response(o.body,{headers:{...secureHeaders,"content-type":"application/gzip"}}):new Response(null,{status:404});}
   if(request.method==="PUT"&&request.body) {
    const length=Number(request.headers.get("content-length"));if(!Number.isSafeInteger(length)||length<1||length>95*1024*1024)return new Response("Invalid length",{status:413});
    await env.STATE.put("state/current.tar.gz",request.body);return new Response(null,{status:204});
   }
   return new Response(null,{status:405});
  }
  if(path==="/login") {
   if(!env.OPERATOR_PASSWORD)return new Response("管理ログインの設定中です。",{status:503,headers:secureHeaders});
   if(request.method==="POST") {
    if(!sameOrigin(request)||Number(request.headers.get("content-length"))>4096)return new Response(null,{status:403});
    const password=(await request.formData()).get("password");
    if(typeof password!=="string"||!await sameSecret(password,env.OPERATOR_PASSWORD))return new Response(loginHtml.replace("管理用パスワードを入力してください。","パスワードが違います。"),{status:401,headers:{...secureHeaders,"content-type":"text/html; charset=utf-8"}});
    return new Response(null,{status:303,headers:{...secureHeaders,location:"/operator/","set-cookie":`__Host-aituber=${await issueSession(env.OPERATOR_PASSWORD)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800`}});
   }
   return new Response(loginHtml,{headers:{...secureHeaders,"content-type":"text/html; charset=utf-8"}});
  }
  const operator=await authenticated(request,env.OPERATOR_PASSWORD);
  const classroomApi=path.startsWith("/api/classrooms/")||/^\/api\/sessions\/[^/]+\/speech\/[a-f0-9]{64}$/.test(path);
  if(path.startsWith("/api/")) {
   if(!classroomApi&&!operator)return Response.json({error:"unauthorized"},{status:401,headers:secureHeaders});
   if(request.method!=="GET"&&request.method!=="HEAD"&&!sameOrigin(request))return new Response(null,{status:403});
   const forwarded=new Request(request);forwarded.headers.set("x-aituber-surface",classroomApi?"classroom":"operator");forwarded.headers.delete("cookie");forwarded.headers.delete("authorization");
   try {return await env.BACKEND.getByName("lecture-v1").fetch(forwarded);}catch {return Response.json({error:"temporarily_unavailable",message:"サーバーを起動しています。少し待って再試行してください。"},{status:503,headers:secureHeaders});}
  }
  if(path==="/aituber-runtime-config.json")return Response.json({classroomOrigin:url.origin},{headers:secureHeaders});
  if(path==="/operator"||path.startsWith("/operator/")) {
   if(!operator)return Response.redirect(`${url.origin}/login`,302);
   if(path==="/operator")return Response.redirect(`${url.origin}/operator/`,302);
  }
  // Static Assets resolves directory indexes and canonical URLs itself.
  const response=await env.ASSETS.fetch(request);
  if(path.startsWith("/operator/")){const privateResponse=new Response(response.body,response);privateResponse.headers.set("cache-control","no-store");return privateResponse;}
  return response;
 }
} satisfies ExportedHandler<AppEnv>;
