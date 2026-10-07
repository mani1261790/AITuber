import { DurableObject } from 'cloudflare:workers';
import type { AppEnv } from './index';
import { runtimeContext } from './platform/context';
import { initializeFiles, existsSync, readFileSync, writeFileSync, unlinkSync, flushSourceFiles } from './platform/files';
import { createServices } from './platform/services';
import { ClassroomAccessError, ClassroomCapacityError, ClassroomRegistry } from '../../server/src/classroom-registry';
import type { ClassroomStreamMessage, CreateSessionRequest, SessionCommandRequest, UpdateLlmSettingsRequest, CreateAuthoringRequest, ResumeAuthoringRequest, SubmitQuestionRequest, SubmitLearningEvidenceRequest, SubmitAfterClassSurveyRequest } from '@aituber/contracts';

export class LectureRoom extends DurableObject<AppEnv> {
  private services!: ReturnType<typeof createServices>;
  private classrooms = new ClassroomRegistry();
  private needsResume = false;
  private context;
  private savedLecture = "";
  private savedRooms = "";
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.context = { storage: ctx.storage, bucket: env.STATE, assets: env.ASSETS };
    runtimeContext.run(this.context, () => {
      initializeFiles();
      this.services = createServices({
        AITUBER_LLM_MODEL:env.LLM_MODEL, AITUBER_LLM_BASE_URL:'https://api.openai.com/v1', AITUBER_LLM_API_KEY:env.OPENAI_API_KEY ?? '',
        AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS:env.LLM_INPUT_PRICE, AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS:env.LLM_OUTPUT_PRICE,
        AITUBER_FISH_AUDIO_API_KEY:env.FISH_API_KEY, AITUBER_FISH_AUDIO_VOICE_ID:env.FISH_VOICE_ID, AITUBER_FISH_AUDIO_MODEL:'s2.1-pro-free',
        AITUBER_AUTHORING_DAILY_BUDGET_USD:'2', AITUBER_RUNTIME_DAILY_BUDGET_USD:'2',
      }, () => this.schedule(1000));
      if(existsSync('/data/rooms.json')) this.classrooms.restoreState(JSON.parse(readFileSync('/data/rooms.json','utf8')));
      if(existsSync('/data/lecture.json')) this.savedLecture=readFileSync('/data/lecture.json','utf8');
      if(this.savedLecture) this.needsResume=this.services.lecture.restoreCheckpoint(JSON.parse(readFileSync('/data/lecture.json','utf8'))) || ctx.storage.kv.get<boolean>('resumeNeeded')===true;
      if(this.needsResume)ctx.storage.kv.put('resumeNeeded',true);
      this.services.lecture.subscribe((id)=>this.publish(id));
      this.services.questions.subscribe((id)=>this.publish(id));
      // Interrupted classifiers must not leave questions permanently pending.
      ctx.storage.sql.exec("UPDATE question_threads SET triage='later',status='accepted',disposition='after-class' WHERE triage='pending' OR status='answering'");
      if(this.needsResume || this.services.lecture.getCurrentSession()?.status==='FINISHED' || this.services.authoring.list().some(job=>job.status==='running')) this.schedule(1000);
    });
  }
  private schedule(delay:number) {
    this.ctx.waitUntil((async()=>{ const at=Date.now()+delay; const previous=await this.ctx.storage.getAlarm(); if(previous===null || previous>at) await this.ctx.storage.setAlarm(at); })());
  }
  private persist() {
    const checkpoint=this.services.lecture.exportCheckpoint();
    const serialized = checkpoint ? JSON.stringify(checkpoint) : '';
    if(serialized!==this.savedLecture){if(serialized)writeFileSync('/data/lecture.json',serialized);else unlinkSync('/data/lecture.json');this.savedLecture=serialized;}
    const rooms=JSON.stringify(this.classrooms.exportState());
    if(rooms!==this.savedRooms){writeFileSync('/data/rooms.json',rooms);this.savedRooms=rooms;}
  }
  private publish(id:string) {
    this.persist();
    const current=this.services.lecture.getSession(id);
    if(['TEACHING','RECOVERING'].includes(current.status)) this.schedule(15000);
    let room; try {room=this.classrooms.getBySession(id);} catch {return;}
    const message:ClassroomStreamMessage={type:'snapshot',snapshot:this.services.lecture.getSnapshot(id),room,questions:this.services.questions.list(id)};
    for(const socket of this.ctx.getWebSockets(id)) {try{socket.send(JSON.stringify(message));}catch{/* Closed clients reconnect using their persisted token. */}}
  }
  override async alarm() {
    return runtimeContext.run(this.context,async()=>{
      // Schedule a watchdog before external calls, so an interrupted alarm can recover.
      await this.ctx.storage.setAlarm(Date.now()+60000);
      if(this.needsResume) {this.needsResume=false;const current=this.services.lecture.getCurrentSession();if(current?.status==='PAUSED')this.services.lecture.command(current.id,{command:'resume'});this.ctx.storage.kv.delete('resumeNeeded');}
      await this.services.authoring.runPendingStep();
      const lastPurge=await this.ctx.storage.get<number>('lastPurge')??0;
      if(Date.now()-lastPurge>86400000){await this.services.dataRetention.purgeNow();
        const ids=new Set(this.ctx.storage.sql.exec<{id:string}>('SELECT id FROM lecture_sessions').toArray().map(row=>row.id));
        this.services.lecture.forgetSessionsExcept(ids);this.classrooms.forgetSessionsExcept(ids);
        await this.ctx.storage.put('lastPurge',Date.now());}
      await flushSourceFiles(); this.persist();
      const current=this.services.lecture.getCurrentSession();
      if(current?.status==='FINISHED'){this.services.afterClass.consider(current.id);await this.services.afterClass.drain(current.id);}
      if(this.services.authoring.list().some(job=>job.status==='running') || current && ['TEACHING','RECOVERING'].includes(current.status)) await this.ctx.storage.setAlarm(Date.now()+15000);
      else {const alarm=await this.ctx.storage.getAlarm();if(alarm===null || alarm>Date.now()+30000)await this.ctx.storage.setAlarm(Date.now()+86400000);}
    });
  }
  override async fetch(request:Request):Promise<Response> {
    return runtimeContext.run(this.context,async()=>{
      try {
        const response=await this.route(request);
        await flushSourceFiles();this.persist();return response;
      } catch(error) {
        if(error instanceof ClassroomCapacityError)return json(409,{error:'classroom_full',message:'この教室は参加上限の5人に達しています。'});
        if(error instanceof ClassroomAccessError)return json(401,{error:'invalid_participant',message:'教室コードから入り直してください。'});
        if(error instanceof RangeError)return json(404,{error:'not_found',message:error.message});
        if(error instanceof TypeError || error instanceof SyntaxError)return json(400,{error:'invalid_request',message:error.message});
        console.error('lecture_request_failed',error instanceof Error?error.message:'unknown');
        return json(500,{error:'internal_error'});
      }
    });
  }
  private async route(request:Request):Promise<Response> {
    const url=new URL(request.url), path=url.pathname;
    const {lecture,settings,authoring,questions,pedagogy,afterClass}=this.services;
    const read=<T>()=>readJson<T>(request,path==='/api/authoring/jobs'?28*1024*1024:64*1024);
    if(path==='/api/settings/llm') {
      if(request.method==='GET')return json(200,{settings:settings.get()});
      if(request.method==='PUT')return json(200,{settings:settings.save(await read<UpdateLlmSettingsRequest>())});
    }
    if(path==='/api/authoring/jobs'){
      if(request.method==='GET')return json(200,{jobs:authoring.list()});
      if(request.method==='POST')return json(202,{job:await authoring.begin(await read<CreateAuthoringRequest>())});
    }
    const job=path.match(/^\/api\/authoring\/jobs\/(authoring\.[a-f0-9-]+)(?:\/(resume|restart))?$/);
    if(job){
      if(request.method==='GET'&&!job[2])return json(200,{job:authoring.get(job[1])});
      if(request.method==='POST'&&job[2]==='restart')return json(202,{job:authoring.beginRestart(job[1])});
      if(request.method==='POST'&&job[2]==='resume'){return json(202,{job:authoring.beginResume(job[1],await readJson<ResumeAuthoringRequest>(request,64*1024,true))});}
    }
    if(path==='/api/courses'&&request.method==='GET')return json(200,{courses:lecture.listCourses()});
    if(path==='/api/sessions/current'&&request.method==='GET'){const session=lecture.getCurrentSession();return json(200,{session,classroom:session?this.classrooms.create(session.id):null});}
    if(path==='/api/sessions'&&request.method==='POST'){const session=lecture.createSession(await read<CreateSessionRequest>());return json(201,{session,classroom:this.classrooms.create(session.id)});}
    const sessionMatch=path.match(/^\/api\/sessions\/([^/]+)(?:\/(commands|speech\/([a-f0-9]{64})))?$/);
    if(sessionMatch){
      const id=decodeURIComponent(sessionMatch[1]);
      if(sessionMatch[3]&&['GET','HEAD'].includes(request.method)){
        const epoch=Number(url.searchParams.get('epoch'));if(!Number.isSafeInteger(epoch)||epoch<1)throw new TypeError('A valid speech epoch is required');
        const audio=lecture.getSpeechAudio(id,epoch,sessionMatch[3]);return audioResponse(request,audio.audio,audio.mimeType);
      }
      if(!sessionMatch[2]&&request.method==='GET'){const session=lecture.getSession(id);return json(200,{session,classroom:this.classrooms.create(id)});}
      if(sessionMatch[2]==='commands'&&request.method==='POST'){const session=lecture.command(id,await read<SessionCommandRequest>());return json(200,{session,classroom:this.classrooms.create(id)});}
    }
    if(path==='/api/classrooms/join'&&request.method==='POST'){
      const access=this.classrooms.join((await read<{code:string}>()).code);this.publish(access.sessionId);
      return json(201,{participant:access.participant,room:access.room,snapshot:lecture.getSnapshot(access.sessionId),questions:questions.list(access.sessionId)});
    }
    const roomMatch=path.match(/^\/api\/classrooms\/([^/]+)\/(reconnect|stream|playback|stage-complete|stage-progress|questions|answer|evidence|survey)$/);
    if(roomMatch){
      const operation=roomMatch[2];
      if(operation==='stream'&&request.headers.get('upgrade')?.toLowerCase()==='websocket'){
        const access=this.classrooms.authenticate(roomMatch[1],url.searchParams.get('token')??'');
        const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1],[access.sessionId]);
        pair[1].serializeAttachment({sessionId:access.sessionId});this.publish(access.sessionId);
        return new Response(null,{status:101,webSocket:pair[0]});
      }
      if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
      const body=await read<SubmitQuestionRequest & SubmitLearningEvidenceRequest & SubmitAfterClassSurveyRequest & {accessToken:string;epoch:number;audioUrl:string;remainingMs:number;actionId:string;answer:string}>();
      const access=this.classrooms.authenticate(roomMatch[1],body.accessToken),id=access.sessionId;
      if(operation==='reconnect')return json(200,{participant:access.participant,room:access.room,snapshot:lecture.getSnapshot(id),questions:questions.list(id)});
      if(operation==='playback')lecture.reportPlayback(id,body.epoch,body.audioUrl,body.remainingMs);
      if(operation==='stage-complete')lecture.completeStageAction(id,body.epoch,body.actionId);
      if(operation==='stage-progress')lecture.reportStageProgress(id,body.epoch,body.actionId);
      if(operation==='questions'){const result=questions.submit({sessionId:id,participantId:access.participant.id,request:body});this.schedule(1000);return json(201,{...result,snapshot:lecture.getSnapshot(id)});}
      if(operation==='answer'){pedagogy.answer({sessionId:id,participantId:access.participant.id,answer:body.answer});return json(200,{snapshot:lecture.getSnapshot(id)});}
      if(operation==='evidence'){pedagogy.submitEvidence({sessionId:id,participantId:access.participant.id,request:body});return json(201,{snapshot:lecture.getSnapshot(id)});}
      if(operation==='survey')return json(201,{survey:afterClass.submitSurvey({sessionId:id,participantId:access.participant.id,request:body})});
      return json(200,{ok:true});
    }
    return json(404,{error:'not_found'});
  }
  override webSocketClose(socket:WebSocket,code:number,reason:string) {socket.close(code===1005||code===1006?1000:code,reason);}
  override webSocketError(socket:WebSocket) {socket.close(1011,'Connection error');}
}
function json(status:number,value:unknown){return Response.json(value,{status,headers:{'cache-control':'no-store'}});}
async function readJson<T>(request:Request,limit:number,allowEmpty=false):Promise<T>{
  if(Number(request.headers.get('content-length'))>limit)throw new TypeError('request body is too large');
  const reader=request.body?.getReader();if(!reader){if(allowEmpty)return {} as T;throw new TypeError('JSON request body is required');}
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new TypeError('request body is too large');}chunks.push(value);}
  if(length===0&&allowEmpty)return {} as T;
  const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(buffer)) as T;
}
function audioResponse(request:Request,bytes:Uint8Array,mimeType:string){
  const headers=new Headers({'content-type':mimeType,'accept-ranges':'bytes','cache-control':'private, max-age=60'});
  const range=request.headers.get('range');let start=0,end=bytes.length-1,status=200;
  if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers:{'content-range':`bytes */${bytes.length}`}});start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;if(start>end)return new Response(null,{status:416,headers:{'content-range':`bytes */${bytes.length}`}});status=206;headers.set('content-range',`bytes ${start}-${end}/${bytes.length}`);}
  headers.set('content-length',String(end-start+1));return new Response(request.method==='HEAD'?null:bytes.slice(start,end+1),{status,headers});
}
