import {afterEach,it,expect,vi} from "vitest";
import {LectureEventStore} from "@aituber/storage";
import {TestToneSpeechProvider} from "@aituber/providers";
import {FixedLectureService} from "./fixed-lecture-service.ts";
import {quadraticFunctionsFixture} from "@aituber/content";
import type {LessonPlanner} from "./lesson-director.ts";
const resources: {close():void}[]=[];
afterEach(()=>{resources.reverse().forEach(r=>r.close());resources.length=0;vi.useRealTimers();});
function create(planner?:LessonPlanner,speechProvider?:TestToneSpeechProvider) {
 const store=new LectureEventStore(":memory:");resources.push(store);
 const service=new FixedLectureService({store,requireLiveExecution:true,...(planner?{planner}:{}),...(speechProvider?{speechProvider,voiceId:"test.voice"}:{})});resources.push(service);return service;
}
const request={coursePackageId:quadraticFunctionsFixture.id,durationMinutes:6};
it("does not start a production lesson without live dependencies",()=>{
 expect(()=>create().createSession(request)).toThrow("無音のテスト進行");
});
it("pauses on reference fallback without completing a unit and retries on resume",async()=>{
 vi.useFakeTimers();let fail=true;
 const service=create(async()=>fail?{source:"reference",reason:"LLM unavailable",actions:[{type:"speak",text:"fallback"}]}:{source:"generated",reason:null,actions:[{type:"speak",text:"生成した説明"}]},new TestToneSpeechProvider(100));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",progress:{completed:0},speech:{playing:false,failure:expect.stringContaining("LLM unavailable")}});
 await vi.advanceTimersByTimeAsync(20000);expect(service.getSession(session.id).progress.completed).toBe(0);
 fail=false;service.command(session.id,{command:"resume"});await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id).speech).toMatchObject({playing:true,text:"生成した説明",failure:null});
});
it("pauses on TTS failure rather than advancing with invisible captions",async()=>{
 vi.useFakeTimers();const speech=new TestToneSpeechProvider(100);vi.spyOn(speech,"synthesize").mockRejectedValue(new Error("voice unavailable"));
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"speak",text:"声にする説明"}]}),speech);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",progress:{completed:0},speech:{playing:false,failure:expect.stringContaining("voice unavailable")}});
});
it("keeps the production failure visible after a runtime restart",async()=>{
 vi.useFakeTimers();const service=create(async()=>({source:"reference",reason:"接続切断",actions:[{type:"speak",text:"fallback"}]}),new TestToneSpeechProvider(100));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const checkpoint=service.exportCheckpoint()!;
 const restored=new FixedLectureService({store:resources[0] as LectureEventStore});resources.push(restored);
 expect(restored.restoreCheckpoint(checkpoint)).toBe(false);
 expect(restored.getSession(session.id).speech.failure).toContain("接続切断");
 expect(restored.getSession(session.id).status).toBe("PAUSED");
});
it("waits past duration for the elected playback end, then leaves a pause",async()=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"speak",text:"読み切ってから進む"}]}),new TestToneSpeechProvider(1000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const speech=service.getSession(session.id).speech;
 const report=(who:string,state:string,start=speech.startedAt!)=>service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,0,who,state,start);
 report("first","playing");
 await vi.advanceTimersByTimeAsync(2000);expect(service.getSession(session.id).progress.completed).toBe(0);
 report("late-viewer","ended");await vi.advanceTimersByTimeAsync(1000);expect(service.getSession(session.id).progress.completed).toBe(0);
 report("first","ended","old-utterance");await vi.advanceTimersByTimeAsync(1000);expect(service.getSession(session.id).progress.completed).toBe(0);
 report("first","ended");await vi.advanceTimersByTimeAsync(849);expect(service.getSession(session.id).progress.completed).toBe(0);
 report("first","ended");await vi.advanceTimersByTimeAsync(1);expect(service.getSession(session.id).progress.completed).toBe(1);
});
it("halts instead of completing an utterance when autoplay never starts",async()=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"speak",text:"再生待ち"}]}),new TestToneSpeechProvider(1000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 await vi.advanceTimersByTimeAsync(30001);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",progress:{completed:0},speech:{failure:expect.stringContaining("再生開始")}});
});
it("halts when the playback owner disconnects, without another viewer taking over",async()=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"speak",text:"接続を確認"}]}),new TestToneSpeechProvider(1000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const speech=service.getSession(session.id).speech;
 service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,1000,"owner","playing",speech.startedAt!);
 await vi.advanceTimersByTimeAsync(10000);
 service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,0,"another","ended",speech.startedAt!);
 await vi.advanceTimersByTimeAsync(5001);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",progress:{completed:0}});
});
it("prepares speech early but waits for explicit projection before dependent explanation",async()=>{
 vi.useFakeTimers();const voice=new TestToneSpeechProvider(1000);const synthesize=vi.spyOn(voice,"synthesize");
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"show_slides"},{type:"speak",text:"投影ができました"}]}),voice);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const view=service.getSession(session.id);expect(view.direction?.phase).toBe("projecting");
 await vi.advanceTimersByTimeAsync(3000);expect(synthesize).toHaveBeenCalledTimes(1);expect(service.getSession(session.id).speech.playing).toBe(false);
 service.completeStageAction(session.id,view.epoch,"old-action");expect(service.getSession(session.id).speech.playing).toBe(false);
 service.completeStageAction(session.id,view.epoch,view.direction!.actionId,"owner");await vi.advanceTimersByTimeAsync(0);
 expect(synthesize).toHaveBeenCalledTimes(1);
 expect(service.getSession(session.id).speech.text).toBe("投影ができました");
});
it("does not skip failed projection",async()=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"show_slides"},{type:"speak",text:"まだ見えていない説明"}]}),new TestToneSpeechProvider(1000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(12001);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",progress:{completed:0},speech:{failure:expect.stringContaining("投影")}});
});

it("halts a disconnected move instead of starting speech",async()=>{
 vi.useFakeTimers();const voice=new TestToneSpeechProvider(1000);const synthesize=vi.spyOn(voice,"synthesize");
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"move_to",position:"left"},{type:"speak",text:"到着後の説明"}]}),voice);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const view=service.getSession(session.id);
 await vi.advanceTimersByTimeAsync(10000);
 service.reportStageProgress(session.id,view.epoch,view.direction!.actionId,"owner");
 await vi.advanceTimersByTimeAsync(11999);expect(service.getSession(session.id).status).toBe("TEACHING");
 await vi.advanceTimersByTimeAsync(2);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",progress:{completed:0},speech:{failure:expect.stringContaining("移動完了")}});
 expect(synthesize).toHaveBeenCalledTimes(1);
 expect(synthesize.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
it("bounds a continually reported move to ninety seconds",async()=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"move_to",position:"left"}]}),new TestToneSpeechProvider(1000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);const view=service.getSession(session.id);
 for(let i=0;i<44;i++){await vi.advanceTimersByTimeAsync(2000);service.reportStageProgress(session.id,view.epoch,view.direction!.actionId,"owner");}
 await vi.advanceTimersByTimeAsync(2001);expect(service.getSession(session.id).status).toBe("PAUSED");
});

it("uses the same classroom for projection, movement and speech",async()=>{
 vi.useFakeTimers();const service=create(async()=>({source:"generated",reason:null,actions:[{type:"show_slides"},{type:"move_to",position:"left"},{type:"speak",text:"同じ画面で完了を待つ"}]}),new TestToneSpeechProvider(1000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 let view=service.getSession(session.id);
 service.reportStageProgress(session.id,view.epoch,view.direction!.actionId,"owner");
 service.completeStageAction(session.id,view.epoch,view.direction!.actionId,"other");
 expect(service.getSession(session.id).direction?.phase).toBe("projecting");
 service.completeStageAction(session.id,view.epoch,view.direction!.actionId,"owner");
 view=service.getSession(session.id);
 service.completeStageAction(session.id,view.epoch,view.direction!.actionId,"other");
 expect(service.getSession(session.id).direction?.phase).toBe("moving");
 service.completeStageAction(session.id,view.epoch,view.direction!.actionId,"owner");await vi.advanceTimersByTimeAsync(0);
 const speech=service.getSession(session.id).speech;
 for(const state of ["playing","ended"])service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,0,"other",state,speech.startedAt!);
 await vi.advanceTimersByTimeAsync(1000);expect(service.getSession(session.id).progress.completed).toBe(0);
 for(const state of ["playing","ended"])service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,0,"owner",state,speech.startedAt!);
 await vi.advanceTimersByTimeAsync(850);expect(service.getSession(session.id).progress.completed).toBe(1);
});

it.each([false,true])("bounds slow drawing and still stops a disconnected renderer (heartbeats=%s)",async heartbeats=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"show_blackboard",drawing:{id:"board.test",markdown:"# 補足",purpose:"補足"}},{type:"speak",text:"説明"}]}),new TestToneSpeechProvider(100));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const view=service.getSession(session.id);
 if(heartbeats){
  for(let i=0;i<59;i++){service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"owner");await vi.advanceTimersByTimeAsync(2000);}
  expect(service.getSession(view.id).status).toBe("TEACHING");
  service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"owner");await vi.advanceTimersByTimeAsync(2001);
 }else await vi.advanceTimersByTimeAsync(12001);
 expect(service.getSession(view.id)).toMatchObject({status:"PAUSED",progress:{completed:0},speech:{playing:false}});
});

it("starts board speech only once from the rendering owner and cancels it on pause",async()=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:"generated",reason:null,actions:[{type:"show_blackboard",drawing:{id:"board.test",markdown:"# 補足",purpose:"補足"}},{type:"speak",text:"関係を順に整理します。"}]}),new TestToneSpeechProvider(1000));
 const initial=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const view=service.getSession(initial.id);
 service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"owner");
 service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"other",true);
 await vi.advanceTimersByTimeAsync(0);expect(service.getSession(view.id).speech.playing).toBe(false);
 service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"owner",true);
 await vi.advanceTimersByTimeAsync(0);const started=service.getSession(view.id).speech.startedAt;
 expect(service.getSession(view.id).speech.playing).toBe(true);
 await vi.advanceTimersByTimeAsync(100);
 service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"owner",true);
 expect(service.getSession(view.id).speech.startedAt).toBe(started);
 service.command(view.id,{command:"pause"});
 service.reportStageProgress(view.id,view.epoch,view.direction!.actionId,"owner",true);
 expect(service.getSession(view.id)).toMatchObject({status:"PAUSED",speech:{playing:false}});
});

it("retains prewarmed answer audio when the main-unit planner finishes later",async()=>{
 vi.useFakeTimers();
 let resolvePlan!: (plan: import("./lesson-director.ts").DirectedPlan)=>void;
 const firstPlan=new Promise<import("./lesson-director.ts").DirectedPlan>(resolve=>{resolvePlan=resolve;});
 let calls=0;
 const provider=new TestToneSpeechProvider(1000),synthesize=vi.spyOn(provider,"synthesize");
 const service=create(async input=>++calls===1?firstPlan:{source:"generated",reason:null,actions:[{type:"speak",text:input.unit.speechText}]},provider);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const origin=service.captureSupplementOrigin(session.id,"target.math.vertex-form");
 const preparing={id:"supplement.prewarm",questionId:"question.prewarm",status:"preparing" as const,attempt:1,origin,candidate:null,failure:null,adoptedAt:new Date().toISOString(),firstAudioAt:null};
 service.announceSupplement(session.id,preparing,{interrupt:false,bridgeText:null,bridgeTargetIds:[]});
 const candidate={speechText:"括弧がゼロになる値を考えます。",captionText:"括弧がゼロになる値",sceneId:"scene.math.form",focusTargetIds:["target.math.vertex-form"],boardPatches:[],sourceIds:["source.quadratic"],knowledgeBasis:"course" as const,calculations:[],corrections:[]};
 service.queueSupplement(session.id,{...preparing,status:"ready",candidate},{onPlaybackStarted(){},onCompleted(){}});
 await vi.advanceTimersByTimeAsync(0);
 const prepared=synthesize.mock.calls.find(call=>call[0].text===candidate.speechText)!;
 expect(prepared).toBeDefined();
 resolvePlan({source:"generated",reason:null,actions:[{type:"speak",text:"本編の説明です。"}]});
 await vi.advanceTimersByTimeAsync(0);
 expect(prepared[1]?.signal?.aborted).toBe(false);
 expect(synthesize.mock.calls.filter(call=>call[0].text===candidate.speechText)).toHaveLength(1);
 service.command(session.id,{command:"pause"});
 expect(prepared[1]?.signal?.aborted).toBe(true);
});

it("waits for a rendered classroom without spending lesson time or generating speech",async()=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 const planner=vi.fn<LessonPlanner>(async input=>({source:"generated",reason:null,actions:[{type:"speak",text:input.unit.speechText}]}));
 const service=new FixedLectureService({store,requireLiveExecution:true,waitForClassroom:true,planner,speechProvider:new TestToneSpeechProvider(1000),voiceId:"test.voice"});resources.push(service);
 const session=service.createSession(request);
 expect(session).toMatchObject({status:"PREPARING",progress:{completed:0},speech:{playing:false}});
 expect(session.displayUnitId).toBe(session.course.schedule.orderedUnitIds[0]);
 await vi.advanceTimersByTimeAsync(3_600_000);
 expect(service.getSession(session.id).status).toBe("PREPARING");
 expect(service.getRemainingTimeMs(session.id)).toBe(360_000);expect(planner).not.toHaveBeenCalled();
 service.classroomReady(session.id,session.epoch+1,"owner");service.classroomReady(session.id,session.epoch,"");
 expect(planner).not.toHaveBeenCalled();
 service.classroomReady(session.id,session.epoch,"owner");
 await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id).status).toBe("TEACHING");
 expect(service.getRemainingTimeMs(session.id)).toBe(360_000);
 const count=planner.mock.calls.length;
 service.classroomReady(session.id,session.epoch,"owner");service.classroomReady(session.id,session.epoch,"other");
 expect(planner).toHaveBeenCalledTimes(count);
});

it.each([false,true])("preserves classroom waiting across restart, including operator pause=%s",async paused=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 const first=new FixedLectureService({store,waitForClassroom:true});resources.push(first);
 const session=first.createSession(request);
 if(paused)first.command(session.id,{command:"pause"});
 const saved=first.exportCheckpoint()!;first.close();
 const restored=new FixedLectureService({store,waitForClassroom:true});resources.push(restored);
 expect(restored.restoreCheckpoint(saved)).toBe(false);
 if(paused)restored.command(session.id,{command:"resume"});
 await vi.advanceTimersByTimeAsync(60_000);
 expect(restored.getSession(session.id).status).toBe("PREPARING");
 expect(restored.getRemainingTimeMs(session.id)).toBe(360_000);
 const epoch=restored.getSession(session.id).epoch;
 restored.classroomReady(session.id,epoch,"owner");
 expect(restored.getSession(session.id).status).toBe("TEACHING");
});
