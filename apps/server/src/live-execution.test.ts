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
 service.prepareSupplementAudio(session.id,session.epoch,candidate.speechText);
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

it("prepares opening audio once while waiting without spending lesson time or publishing playback",async()=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 const planner=vi.fn<LessonPlanner>(async input=>({source:"generated",reason:null,actions:[{type:"speak",text:input.unit.speechText}]}));
 const speechProvider=new TestToneSpeechProvider(1000), synthesize=vi.spyOn(speechProvider,"synthesize");
 const service=new FixedLectureService({store,requireLiveExecution:true,waitForClassroom:true,planner,speechProvider,voiceId:"test.voice"});resources.push(service);
 const session=service.createSession(request);
 expect(session).toMatchObject({status:"PREPARING",progress:{completed:0},speech:{playing:false}});
 expect(session.displayUnitId).toBe(session.course.schedule.orderedUnitIds[0]);
 await vi.advanceTimersByTimeAsync(3_600_000);
 expect(service.getSession(session.id).status).toBe("PREPARING");
 expect(service.getRemainingTimeMs(session.id)).toBe(360_000);expect(planner).toHaveBeenCalledTimes(1);
 expect(synthesize).toHaveBeenCalledTimes(1);
 expect(service.getSession(session.id).speech).toMatchObject({playing:false,audioUrl:null});
 service.classroomReady(session.id,session.epoch+1,"owner");service.classroomReady(session.id,session.epoch,"");
 expect(planner).toHaveBeenCalledTimes(1);
 service.classroomReady(session.id,session.epoch,"owner");
 await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id).status).toBe("TEACHING");
 expect(service.getRemainingTimeMs(session.id)).toBe(360_000);
 expect(planner.mock.calls.filter(([input])=>input.unit.id===session.displayUnitId)).toHaveLength(1);
 expect(synthesize.mock.calls.filter(([input])=>input.text===synthesize.mock.calls[0]![0].text)).toHaveLength(1);
 const count=planner.mock.calls.length;
 service.classroomReady(session.id,session.epoch,"owner");service.classroomReady(session.id,session.epoch,"other");
 expect(planner).toHaveBeenCalledTimes(count);
});

it.each(["pause","finish"] as const)("discards late opening plans after %s while waiting",async command=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 let resolve!: (plan:Awaited<ReturnType<LessonPlanner>>)=>void;
 const planner=vi.fn<LessonPlanner>(()=>new Promise(done=>{resolve=done;}));
 const provider=new TestToneSpeechProvider(1000),synthesize=vi.spyOn(provider,"synthesize");
 const service=new FixedLectureService({store,waitForClassroom:true,planner,speechProvider:provider,voiceId:"test.voice"});resources.push(service);
 const session=service.createSession(request);
 const signal=planner.mock.calls[0]![1];
 service.command(session.id,{command});
 expect(signal.aborted).toBe(true);
 resolve({source:"generated",reason:null,actions:[{type:"speak",text:"古い冒頭です。"}]});
 await vi.advanceTimersByTimeAsync(0);
 expect(synthesize).not.toHaveBeenCalled();
 expect(service.getSession(session.id).speech.playing).toBe(false);
 if(command==="pause"){
  service.command(session.id,{command:"resume"});
  expect(planner).toHaveBeenCalledTimes(2);
  expect(service.getSession(session.id).status).toBe("PREPARING");
 }
});

it("joins an in-flight opening plan when the classroom becomes ready",async()=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 let resolve!: (plan:Awaited<ReturnType<LessonPlanner>>)=>void;
 const planner=vi.fn<LessonPlanner>(()=>new Promise(done=>{resolve=done;}));
 const provider=new TestToneSpeechProvider(1000),synthesize=vi.spyOn(provider,"synthesize");
 const service=new FixedLectureService({store,waitForClassroom:true,planner,speechProvider:provider,voiceId:"test.voice"});resources.push(service);
 const session=service.createSession(request);
 service.classroomReady(session.id,session.epoch,"owner");
 expect(planner).toHaveBeenCalledTimes(1);
 resolve({source:"generated",reason:null,actions:[{type:"speak",text:"最初の説明です。"}]});
 await vi.advanceTimersByTimeAsync(0);
 expect(synthesize.mock.calls.filter(([input])=>input.text==="最初の説明です。")).toHaveLength(1);
 expect(service.getSession(session.id).speech).toMatchObject({playing:true,text:"最初の説明です。"});
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

 it("keeps speculative answer audio private and aborts rejected, replaced and paused candidates",async()=>{
  vi.useFakeTimers();const provider=new TestToneSpeechProvider(1000),synthesize=vi.spyOn(provider,"synthesize");
  const service=create(async()=>({source:"generated",reason:null,actions:[{type:"speak",text:"本編です。"}]}),provider);
  const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
  const before=service.getSession(session.id).speech;
  const discard=service.prepareSupplementAudio(session.id,session.epoch,"候補Aです。");
  const first=synthesize.mock.calls.at(-1)!;
  await vi.advanceTimersByTimeAsync(0);
  expect(service.getSession(session.id).speech).toEqual(before);
  service.prepareSupplementAudio(session.id,session.epoch,"候補Bです。");
  const second=synthesize.mock.calls.at(-1)!;
  expect(first[1]?.signal?.aborted).toBe(true);
  discard();expect(second[1]?.signal?.aborted).toBe(false);
  service.command(session.id,{command:"pause"});expect(second[1]?.signal?.aborted).toBe(true);
  const count=synthesize.mock.calls.length;
  service.prepareSupplementAudio(session.id,session.epoch,"古い候補です。");
  expect(synthesize).toHaveBeenCalledTimes(count);
 });

it("reuses reviewed candidate audio on playback instead of synthesizing it again",async()=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 const provider=new TestToneSpeechProvider(1000),synthesize=vi.spyOn(provider,"synthesize");
 const service=new FixedLectureService({store,speechProvider:provider,voiceId:"test.voice",playbackUnitMs:1000});resources.push(service);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const origin=service.captureSupplementOrigin(session.id,"target.math.vertex-form");
 const candidate={speechText:"括弧がゼロになる値を考えます。",captionText:"括弧がゼロになる値",sceneId:"scene.math.form",focusTargetIds:["target.math.vertex-form"],boardPatches:[],sourceIds:["source.quadratic"],knowledgeBasis:"course" as const,calculations:[],corrections:[]};
 service.prepareSupplementAudio(session.id,session.epoch,candidate.speechText);
 expect(service.getSession(session.id).speech.text).not.toBe(candidate.speechText);
 const started=vi.fn();
 service.announceSupplement(session.id,{id:"supplement.reviewed",questionId:"question.reviewed",status:"preparing",attempt:0,origin,candidate:null,failure:null,adoptedAt:new Date().toISOString(),firstAudioAt:null},{interrupt:false,bridgeText:null,bridgeTargetIds:[]});
 service.queueSupplement(session.id,{id:"supplement.reviewed",questionId:"question.reviewed",status:"ready",attempt:1,origin,candidate,failure:null,adoptedAt:new Date().toISOString(),firstAudioAt:null},{onPlaybackStarted:started,onCompleted(){}});
 await vi.advanceTimersByTimeAsync(2000);
 expect(started).toHaveBeenCalledTimes(1);
 expect(synthesize.mock.calls.filter(call=>call[0].text===candidate.speechText)).toHaveLength(1);
});

it.each([[false,false],[true,false],[true,true]])("gates board narration after introduction (arrival first=%s, pause=%s)",async(arrivalFirst,pause)=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 const service=new FixedLectureService({store,playbackUnitMs:1000});resources.push(service);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const origin=service.captureSupplementOrigin(session.id,"target.math.vertex-form");
 const candidate={preparationSpeechText:"検索を行うのは外部のツールです。",speechText:"結果はこの矢印の順番で戻ります。",captionText:"検索結果の戻り道",sceneId:"scene.math.form",focusTargetIds:["target.math.vertex-form"],boardPatches:[],sourceIds:["source.quadratic"],knowledgeBasis:"course" as const,calculations:[],corrections:[],drawing:{id:"board.intro",markdown:"# 戻り道\nツール → アプリ → モデル",purpose:"往復"}};
 const preparing={id:"supplement.intro",questionId:"question.intro",status:"preparing" as const,attempt:0,origin,candidate:null,failure:null,adoptedAt:new Date().toISOString(),firstAudioAt:null};
 service.announceSupplement(session.id,preparing,{interrupt:false,bridgeText:null,bridgeTargetIds:[]});
 const completed=vi.fn();
 service.queueSupplement(session.id,{...preparing,status:"ready",candidate},{onPlaybackStarted(){},onCompleted:completed});
 await vi.advanceTimersByTimeAsync(1000);
 let current=service.getSession(session.id);
 expect(current.speech.text).toBe(candidate.preparationSpeechText);
 expect(current.direction).toMatchObject({phase:"drawing",boardNarrationReady:false});
 const action=current.direction!.actionId;
 if(arrivalFirst)service.reportStageProgress(session.id,current.epoch,action,undefined,true);
 expect(service.getSession(session.id).speech.text).toBe(candidate.preparationSpeechText);
 if(pause){
  service.command(session.id,{command:"pause"});
  service.reportStageProgress(session.id,current.epoch,action,undefined,true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",speech:{playing:false}});
  expect(completed).not.toHaveBeenCalled();return;
 }
 await vi.advanceTimersByTimeAsync(1000);
 if(!arrivalFirst){
  expect(service.getSession(session.id).speech.playing).toBe(false);
  service.reportStageProgress(session.id,current.epoch,action,undefined,true);
 }
 current=service.getSession(session.id);
 expect(current.speech.text).toBe(candidate.speechText);
 expect(current.direction?.boardNarrationReady).toBe(true);
 expect(completed).not.toHaveBeenCalled();
 service.completeStageAction(session.id,current.epoch,action);
 service.completeStageAction(session.id,current.epoch,service.getSession(session.id).direction!.actionId);
 await vi.advanceTimersByTimeAsync(3100);
 expect(completed).toHaveBeenCalledTimes(1);
});

it("holds the lesson clock until the whole script and opening audio are prepared, even after classroom readiness",async()=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 let resolve!: (plan:Awaited<ReturnType<LessonPlanner>>)=>void;
 const planner=Object.assign(vi.fn<LessonPlanner>(()=>new Promise(done=>{resolve=done;})),{preparesWholeLecture:true});
 const provider=new TestToneSpeechProvider(1000);
 const service=new FixedLectureService({store,waitForClassroom:true,planner,speechProvider:provider,voiceId:"test"});resources.push(service);
 const session=service.createSession(request);service.classroomReady(session.id,session.epoch,"owner");
 await vi.advanceTimersByTimeAsync(120000);
 expect(service.getSession(session.id).status).toBe("PREPARING");expect(service.getRemainingTimeMs(session.id)).toBe(360000);
 resolve({source:"generated",reason:null,actions:[{type:"speak",text:"全体台本の最初の説明です。"}]});
 await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id)).toMatchObject({status:"TEACHING",speech:{playing:true,text:"全体台本の最初の説明です。"}});
 expect(service.getRemainingTimeMs(session.id)).toBe(360000);
});
it("makes whole-script preparation failures visible instead of leaving an endless waiting room",async()=>{
 vi.useFakeTimers();const store=new LectureEventStore(":memory:");resources.push(store);
 const planner=Object.assign(vi.fn<LessonPlanner>(async()=>{throw Error("whole script unavailable");}),{preparesWholeLecture:true});
 const service=new FixedLectureService({store,waitForClassroom:true,planner,speechProvider:new TestToneSpeechProvider(100),voiceId:"test"});resources.push(service);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 expect(service.getSession(session.id)).toMatchObject({status:"PAUSED",speech:{playing:false,failure:expect.any(String)}});
});

it("plays exercise guidance through audio receipts and stays at the question after the end",async()=>{
 vi.useFakeTimers();const course=structuredClone(quadraticFunctionsFixture) as import('@aituber/contracts').CoursePackage;
 const question=course.assessments[0]!;question.introductionText='画面下の問題を考えてみましょう。';course.assessments=[question];course.schedule.orderedItemIds=[question.id,...course.schedule.orderedUnitIds];
 const store=new LectureEventStore(':memory:');resources.push(store);
 const service=new FixedLectureService({store,courses:[course],requireLiveExecution:true,speechProvider:new TestToneSpeechProvider(1000),voiceId:'test.voice',planner:async()=>({source:'generated',reason:null,actions:[{type:'speak',text:'説明します。'}]})});resources.push(service);
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const speech=service.getSession(session.id).speech;expect(speech.audioUrl).toBeTruthy();expect(speech.text).toBe(question.introductionText);
 service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,0,'viewer','playing',speech.startedAt!);
 await vi.advanceTimersByTimeAsync(2000);expect(service.getSession(session.id).speech.playing).toBe(true);
 service.reportPlayback(session.id,speech.epoch,speech.audioUrl!,0,'viewer','ended',speech.startedAt!);
 await vi.advanceTimersByTimeAsync(850);expect(service.getSession(session.id)).toMatchObject({status:'CHECKPOINT',speech:{playing:false},progress:{completed:0}});
 await vi.advanceTimersByTimeAsync(30000);expect(service.getSession(session.id).status).toBe('CHECKPOINT');
});
it.each(['left','right'] as const)('continues the same audio through screen lowering and arrival at %s',async(position)=>{
 vi.useFakeTimers();
 const service=create(async()=>({source:'generated',reason:null,actions:[{type:'speak',text:'モデルの使い方を見ていきましょう。',surface:'slides',position}]}),new TestToneSpeechProvider(10000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const projecting=service.getSession(session.id);expect(projecting.direction?.phase).toBe('projecting');expect(projecting.speech.playing).toBe(true);
 service.completeStageAction(session.id,projecting.epoch,projecting.direction!.actionId,'viewer');
 const moving=service.getSession(session.id);expect(moving.direction).toMatchObject({phase:'moving',position,traveling:true});expect(moving.speech).toEqual(projecting.speech);
 service.completeStageAction(session.id,moving.epoch,moving.direction!.actionId,'viewer');
 expect(service.getSession(session.id).direction).toMatchObject({phase:'speaking',position,traveling:false});
 expect(service.getSession(session.id).speech).toEqual(projecting.speech);
});
it('stops arrival acknowledgements while continuing speech and skips a no-op speaking move',async()=>{
 vi.useFakeTimers();let position:'left'|'right'='left';
 const service=create(async()=>({source:'generated',reason:null,actions:[{type:'speak',text:'話しながら移動します。',position}]}),new TestToneSpeechProvider(10000));
 const session=service.createSession(request);await vi.advanceTimersByTimeAsync(0);
 const moving=service.getSession(session.id);expect(moving.direction?.traveling).toBe(true);
 service.completeStageAction(session.id,moving.epoch,moving.direction!.actionId,'viewer');
 expect(service.getSession(session.id).direction?.traveling).toBe(false);
 expect(service.getSession(session.id).speech).toEqual(moving.speech);
 position='right';
 const other=create(async()=>({source:'generated',reason:null,actions:[{type:'speak',text:'同じ場所から説明します。',position}]}),new TestToneSpeechProvider(10000));
 const second=other.createSession(request);await vi.advanceTimersByTimeAsync(0);
 expect(other.getSession(second.id).direction?.traveling).toBe(false);
});
