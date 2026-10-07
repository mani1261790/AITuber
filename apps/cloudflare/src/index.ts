import { authenticated, issueSession, loginHtml, sameOrigin, sameSecret } from "./auth.ts";
export type AppEnv = Env & { OPERATOR_PASSWORD: string; FISH_API_KEY?: string; FISH_VOICE_ID?: string; OPENAI_API_KEY?: string };
export { LectureRoom } from "./lecture-room";
const secureHeaders={"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY"};
export default {
 async fetch(request:Request,env:AppEnv):Promise<Response> {
  const url=new URL(request.url), path=url.pathname;
  if(path==="/_internal/state")return new Response("Not found",{status:404});
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
   try {return await env.ROOM.getByName("classroom-v1").fetch(forwarded);}catch {return Response.json({error:"temporarily_unavailable",message:"サーバーを起動しています。少し待って再試行してください。"},{status:503,headers:secureHeaders});}
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
