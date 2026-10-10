import { afterEach, describe, expect, it, vi } from "vitest";
import { quadraticFunctionsFixture } from "@aituber/content";
import { LectureEventStore } from "@aituber/storage";
import { FixedResponseLlmProvider } from "@aituber/providers";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import { createLessonPlanner, referencePlan, validatePlan, type LessonPlanner, type DirectedPlan } from "./lesson-director.ts";

afterEach(()=>vi.useRealTimers());
function setup(planner?: LessonPlanner) {
  const store = new LectureEventStore(":memory:");
  const service = new FixedLectureService({store,courses:[quadraticFunctionsFixture],playbackUnitMs:100,...(planner ? {planner} : {})});
  const session = service.createSession({coursePackageId:quadraticFunctionsFixture.id,durationMinutes:6});
  return {service,store,session,close:()=>{service.close();store.close();}};
}

describe("lesson director",()=>{
  it("compiles generated speech beats into ordered stage tools",async()=>{
    const runtime = setup();
    try {
      const unit = quadraticFunctionsFixture.teachingUnits[0]!;
      const llm = new FixedResponseLlmProvider([{beats:[{text:"では、この式の頂点に注目しましょう。",targetId:unit.focusTargetIds[0],camera:"lecture",position:"right",gesture:"explain",blackboardMarkdown:null,walkWhileSpeaking:false}]}]);
      const plan = await createLessonPlanner(()=>llm)({session:runtime.session,unit,previousSpeech:"さきほどの説明",remainingMs:10000},new AbortController().signal);
      expect(plan.source).toBe("generated");
      expect(plan.actions.map(action=>action.type)).toEqual(["camera","move_to","point_at","speak","release_point"]);
      expect(llm.calls[0]?.prompt).toContain("さきほどの説明");
    } finally {runtime.close();}
  });
  it("falls back without a configured provider and validates target and wording",async()=>{
    const runtime = setup();
    try {
      const unit = quadraticFunctionsFixture.teachingUnits[0]!;
      const input = {session:runtime.session,unit,previousSpeech:"",remainingMs:1000};
      const plan = await createLessonPlanner(()=>null)(input,new AbortController().signal);
      expect(plan.source).toBe("reference");
      expect(plan.actions).toContainEqual({type:"speak",text:unit.speechText});
      expect(()=>validatePlan([{type:"point_at",targetId:"missing"},{type:"speak",text:"説明"}],input)).toThrow("Unknown pointing target");
      expect(()=>validatePlan([{type:"speak",text:"説明"}],{...input,unit:{...unit,speakingGuidance:{requiredPhrases:["必須の表現"],avoidPhrases:[],explanationNotes:""}}})).toThrow("Required wording");
    } finally {runtime.close();}
  });

  it.each([
    ["left", false, "left"], ["left", true, "left"],
    ["right", false, "right"], ["right", true, "right"],
    ["center", false, "center"], ["center", true, "right"],
  ] as const)("keeps fallback staging coherent from %s with pointing=%s", async (position, pointing, expected) => {
    const runtime = setup();
    try {
      const original = quadraticFunctionsFixture.teachingUnits.find(unit => unit.focusTargetIds.length)!;
      const unit = {...original, focusTargetIds: pointing ? original.focusTargetIds : []};
      const session = {...runtime.session, direction: {
        actionId: "fallback-test", phase: "planning" as const, position, targetId: null,
        camera: "lecture" as const, source: "generated" as const, reason: null,
      }};
      // Both an unavailable provider and a rejected generated plan must retain the stance.
      for (const provider of [null, new FixedResponseLlmProvider([{beats: []}])]) {
        const plan = await createLessonPlanner(() => provider)({session, unit, previousSpeech: "", remainingMs: 1000}, new AbortController().signal);
        expect(plan.source).toBe("reference");
        expect(plan.actions.filter(action => action.type === "move_to")).toEqual([{type: "move_to", position: expected}]);
        expect(plan.actions).toContainEqual({type: "speak", text: unit.speechText});
        expect(plan.actions.some(action => action.type === "point_at")).toBe(pointing);
      }
    } finally { runtime.close(); }
  });

  it("waits for the correct motion completion, then speaks the generated text",async()=>{
    vi.useFakeTimers();
    const planner: LessonPlanner = async()=>({source:"generated",reason:null,actions:[{type:"move_to",position:"left"},{type:"speak",text:"その場で生成した説明です。"}]});
    const runtime = setup(planner);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const moving = runtime.service.getSession(runtime.session.id);
      expect(moving.direction?.phase).toBe("moving");
      expect(moving.direction?.position).toBe("left");
      expect(moving.speech.playing).toBe(false);
      runtime.service.completeStageAction(moving.id,moving.epoch+1,moving.direction!.actionId);
      expect(runtime.service.getSession(moving.id).speech.playing).toBe(false);
      runtime.service.completeStageAction(moving.id,moving.epoch,moving.direction!.actionId);
      expect(runtime.service.getSession(moving.id).speech.text).toBe("その場で生成した説明です。");
      expect(runtime.service.getSession(moving.id).progress.completed).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(runtime.service.getSession(moving.id).progress.completed).toBe(1);
    } finally {runtime.close();}
  });

  it("discards a plan that resolves after pause",async()=>{
    vi.useFakeTimers(); let resolve!: (plan: DirectedPlan)=>void;
    const runtime = setup(()=>new Promise(done=>{resolve=done;}));
    try {
      runtime.service.command(runtime.session.id,{command:"pause"});
      resolve(referencePlan(quadraticFunctionsFixture.teachingUnits[0]!));
      await vi.advanceTimersByTimeAsync(10_000);
      const paused = runtime.service.getSession(runtime.session.id);
      expect(paused.status).toBe("PAUSED"); expect(paused.speech.playing).toBe(false); expect(paused.progress.completed).toBe(0);
    } finally {runtime.close();}
  });

  it("invalidates prefetched direction when learning context changes",async()=>{
    vi.useFakeTimers();
    const planner = vi.fn<LessonPlanner>(async(input)=>({source:"generated",reason:null,actions:[{type:"speak",text:input.unit.speechText}]}));
    const runtime = setup(planner);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(planner).toHaveBeenCalledTimes(2);
      runtime.service.updateLearningEvidence(runtime.session.id,[{scopeId:"target.math.vertex-form",label:"式",state:"support-requested",evidenceCount:1,lastEvidenceAt:null}]);
      await vi.advanceTimersByTimeAsync(100);
      expect(planner.mock.calls.filter(([input])=>input.unit.id===quadraticFunctionsFixture.schedule.orderedUnitIds[1])).toHaveLength(2);
    } finally {runtime.close();}
  });

  it("completes the lesson after the checkpoint so a future stream host can resume",async()=>{
    vi.useFakeTimers();
    const runtime = setup(async input=>({source:"generated",reason:null,actions:[{type:"speak",text:input.unit.speechText}]}));
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(runtime.service.getSession(runtime.session.id).status).toBe("CHECKPOINT");
      runtime.service.command(runtime.session.id,{command:"answer",answer:"(-3, -4)"});
      await vi.advanceTimersByTimeAsync(1000);
      const completed = runtime.service.getSession(runtime.session.id);
      expect(completed.status).toBe("FINISHED");
      expect(completed.completedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds);
      expect(completed.direction?.phase).toBe("complete");
      expect(runtime.store.loadEvents(completed.id).filter(event=>event.type==="lesson.direction-planned")).toHaveLength(quadraticFunctionsFixture.schedule.orderedUnitIds.length);
    } finally {runtime.close();}
  });
});

it("waits for SVG readiness and movement before speaking, then returns to slides",async()=>{
  vi.useFakeTimers();
  const drawing={id:"blackboard.test",svg:"<svg/>",purpose:"補足"};
  const planner:LessonPlanner=async()=>({source:"generated",reason:null,actions:[{type:"show_blackboard",drawing},{type:"move_to",position:"left"},{type:"point_at",targetId:drawing.id},{type:"speak",text:"生成した図の説明"},{type:"show_slides"}]});
  const runtime=setup(planner);
  try {
    await vi.advanceTimersByTimeAsync(0);
    let session=runtime.service.getSession(runtime.session.id);
    expect(session.direction?.phase).toBe("drawing"); expect(session.speech.playing).toBe(false);
    runtime.service.completeStageAction(session.id,session.epoch+1,session.direction!.actionId);
    expect(runtime.service.getSession(session.id).direction?.phase).toBe("drawing");
    runtime.service.completeStageAction(session.id,session.epoch,session.direction!.actionId);
    session=runtime.service.getSession(session.id); expect(session.direction?.phase).toBe("moving");
    runtime.service.completeStageAction(session.id,session.epoch,session.direction!.actionId);
    await vi.advanceTimersByTimeAsync(550);
    expect(runtime.service.getSession(session.id).speech.text).toBe("生成した図の説明");
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.service.getSession(session.id).direction?.surface).toBe("slides");
  } finally {runtime.close();}
});
it("does not speak diagram-dependent text if rendering is never acknowledged",async()=>{
  vi.useFakeTimers();
  const runtime=setup(async()=>({source:"generated",reason:null,actions:[{type:"show_blackboard",drawing:{id:"blackboard.test",svg:"<svg/>",purpose:"図"}},{type:"speak",text:"見えていない図の説明"}]}));
  try {
    await vi.advanceTimersByTimeAsync(12000);
    const session=runtime.service.getSession(runtime.session.id);
    expect(session.direction?.surface).toBe("slides");
    expect(session.speech.text).not.toBe("見えていない図の説明");
  } finally {runtime.close();}
});

it.each(["arrival-first", "speech-first"])("waits for both speech and concurrent travel: %s", async (order) => {
  vi.useFakeTimers();
  const runtime = setup(async()=>({source:"generated",reason:null,actions:[{type:"speak",text:"中央へ移動しながら説明します。",gesture:"explain",position:"center"}]}));
  try {
    await vi.advanceTimersByTimeAsync(0);
    const view=runtime.service.getSession(runtime.session.id);
    expect(view.direction?.traveling).toBe(true); expect(view.speech.playing).toBe(true);
    const arrive=()=>runtime.service.completeStageAction(view.id,view.epoch,view.direction!.actionId);
    if(order==="arrival-first") { arrive(); expect(runtime.service.getSession(view.id).speech.playing).toBe(true); await vi.advanceTimersByTimeAsync(100); }
    else { await vi.advanceTimersByTimeAsync(100); expect(runtime.service.getSession(view.id).progress.completed).toBe(0); arrive(); }
    expect(runtime.service.getSession(view.id).progress.completed).toBe(1);
  } finally {runtime.close();}
});

it("compiles a semantic gesture and concurrent audience-facing explanation, but blocks pointing from center",async()=>{
  const runtime=setup();
  try {
    const unit=quadraticFunctionsFixture.teachingUnits[0]!;
    const llm=new FixedResponseLlmProvider([{beats:[{text:unit.speechText,targetId:null,camera:"lecture",position:"center",gesture:"emphasize",blackboardMarkdown:null,walkWhileSpeaking:true}]}]);
    const plan=await createLessonPlanner(()=>llm)({session:runtime.session,unit,previousSpeech:"",remainingMs:1000},new AbortController().signal);
    expect(plan.source).toBe("generated");
    expect(plan.actions.some(action=>action.type==="move_to")).toBe(false);
    expect(plan.actions).toContainEqual({type:"speak",text:unit.speechText,gesture:"emphasize",position:"center"});
    const pointing=new FixedResponseLlmProvider([{beats:[{text:unit.speechText,targetId:unit.focusTargetIds[0],camera:"lecture",position:"center",gesture:"explain",blackboardMarkdown:null,walkWhileSpeaking:true}]}]);
    const safe=await createLessonPlanner(()=>pointing)({session:runtime.session,unit,previousSpeech:"",remainingMs:1000},new AbortController().signal);
    expect(safe.actions).toContainEqual({type:"move_to",position:"right"});
    expect(safe.actions.find(action=>action.type==="speak")).not.toHaveProperty("position");
  } finally {runtime.close();}
});

it("keeps the same position while explaining the same focus across consecutive beats",async()=>{
 const runtime=setup();
 try{
  const unit=quadraticFunctionsFixture.teachingUnits[0]!;
  const llm=new FixedResponseLlmProvider([{beats:["left","right"].map(position=>({text:"頂点の位置を式から読み取りましょう。",targetId:unit.focusTargetIds[0],camera:"lecture",position,gesture:"explain",blackboardMarkdown:null,walkWhileSpeaking:false}))}]);
  const plan=await createLessonPlanner(()=>llm)({session:runtime.session,unit,previousSpeech:"",remainingMs:10000},new AbortController().signal);
  expect(plan.source).toBe("generated");
  expect(plan.actions.filter(a=>a.type==="move_to").map(a=>a.position)).toEqual(["left","left"]);
 }finally{runtime.close();}
});

it("reports the director deadline as a timeout, while preserving caller cancellation", async()=>{
 const runtime=setup();
 const deadline=new AbortController();
 const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(deadline.signal);
 const llm=new FixedResponseLlmProvider([]);
 vi.spyOn(llm,"createContext").mockReturnValue({purpose:"generation",generate:request=>new Promise<never>((_,reject)=>{
  if(request.signal?.aborted)reject(new Error("LLM request was cancelled"));
  else request.signal?.addEventListener("abort",()=>reject(new Error("LLM request was cancelled")),{once:true});
 })});
 const input={session:runtime.session,unit:quadraticFunctionsFixture.teachingUnits[0]!,previousSpeech:"",remainingMs:10000};
 try{
  const pending=createLessonPlanner(()=>llm)(input,new AbortController().signal);
  deadline.abort(new DOMException("Deadline exceeded","TimeoutError"));
  expect(await pending).toMatchObject({source:"reference",reason:"台本生成が60秒以内に完了しませんでした"});
  const caller=new AbortController(),reason=new Error("session ended");caller.abort(reason);
  await expect(createLessonPlanner(()=>llm)(input,caller.signal)).rejects.toBe(reason);
 }finally{timeout.mockRestore();runtime.close();}
});


it("converts listening attached to a spoken beat into an explanation",async()=>{
 const runtime=setup();
 try{
  const unit=quadraticFunctionsFixture.teachingUnits[0]!;
  const llm=new FixedResponseLlmProvider([{beats:[{text:"それでは式を見てみましょう。",targetId:null,camera:"lecture",position:"center",gesture:"listen",blackboardMarkdown:null,walkWhileSpeaking:false}]}]);
  const plan=await createLessonPlanner(()=>llm)({session:runtime.session,unit,previousSpeech:"",remainingMs:10000},new AbortController().signal);
  expect(plan.source).toBe("generated");
  expect(plan.actions.find(action=>action.type==="speak")).toMatchObject({gesture:"explain"});
 }finally{runtime.close();}
});


it("keeps waiting for an actively rendering slow move, but expires when progress stops",async()=>{
 vi.useFakeTimers();
 const runtime=setup(async()=>({source:"generated",reason:null,actions:[{type:"move_to",position:"left"},{type:"speak",text:"到着後の説明です。"}]}));
 try {
  await vi.advanceTimersByTimeAsync(0);
  const moving=runtime.service.getSession(runtime.session.id);
  for(let i=0;i<8;i++){
   await vi.advanceTimersByTimeAsync(2000);
   runtime.service.reportStageProgress(moving.id,moving.epoch,moving.direction!.actionId);
  }
  expect(runtime.service.getSession(moving.id).direction?.phase).toBe("moving");
  expect(runtime.service.getSession(moving.id).speech.playing).toBe(false);
  // A stale participant must not extend another action or epoch.
  await vi.advanceTimersByTimeAsync(10000);
  runtime.service.reportStageProgress(moving.id,moving.epoch+1,moving.direction!.actionId);
  runtime.service.reportStageProgress(moving.id,moving.epoch,"old-action");
  await vi.advanceTimersByTimeAsync(2001);
  expect(runtime.service.getSession(moving.id).speech.text).toBe("到着後の説明です。");
 }finally{runtime.close();}
});

it.each(["left","center"] as const)("prefetches from the planned ending position %s without publishing it as an already completed move",async ending=>{
 vi.useFakeTimers();
 const planner=vi.fn<LessonPlanner>(async input=>({source:"generated",reason:null,actions:[
  {type:"move_to",position:"left"},
  {type:"speak",text:input.unit.speechText,...(ending==="center"?{position:"center" as const}:{})},
 ]}));
 const runtime=setup(planner);
 try{
  await vi.advanceTimersByTimeAsync(0);
  expect(planner).toHaveBeenCalledTimes(2);
  const next=planner.mock.calls[1]![0];
  expect(next.session.direction?.position).toBe(ending);
  expect(next.session.direction?.phase).toBe("complete");
  expect(next.session.direction?.traveling).toBe(false);
  expect(next.session.direction?.targetId).toBeNull();
  expect(next.previousSpeech).toBe(quadraticFunctionsFixture.teachingUnits[0]!.speechText);
  const live=runtime.service.getSession(runtime.session.id);
  expect(live.direction?.phase).toBe("moving");
  expect(live.direction?.position).toBe("left");
 }finally{runtime.close();}
});

it.each(["left","center"] as const)("retains %s for replanning after pause while clearing stale executable cues",async standing=>{
 vi.useFakeTimers();
 const planner=vi.fn<LessonPlanner>(async input=>({source:"generated",reason:null,actions:[
  {type:"move_to",position:standing},
  {type:"speak",text:input.unit.speechText},
 ]}));
 const runtime=setup(planner);
 try{
  await vi.advanceTimersByTimeAsync(0);
  const moving=runtime.service.getSession(runtime.session.id);
  runtime.service.completeStageAction(moving.id,moving.epoch,moving.direction!.actionId);
  expect(runtime.service.getSession(moving.id).speech.playing).toBe(true);
  const paused=runtime.service.command(moving.id,{command:"pause"});
  expect(paused.direction).toBeNull();
  expect(paused.speech.playing).toBe(false);
  planner.mockClear();
  runtime.service.command(moving.id,{command:"resume"});
  await vi.advanceTimersByTimeAsync(0);
  expect(planner.mock.calls[0]![0].session.direction?.position).toBe(standing);
  expect(planner.mock.calls[0]![0].session.direction?.phase).toBe("planning");
  expect(planner.mock.calls[0]![0].session.direction?.targetId).toBeNull();
 }finally{runtime.close();}
});

it("carries the standing position through a live answer back to the resumed unit",async()=>{
 vi.useFakeTimers();
 const planner=vi.fn<LessonPlanner>(async input=>({source:"generated",reason:null,actions:[
  {type:"move_to",position:"left"},{type:"speak",text:input.unit.speechText},
 ]}));
 const runtime=setup(planner);
 try{
  await vi.advanceTimersByTimeAsync(0);
  const moving=runtime.service.getSession(runtime.session.id);
  runtime.service.completeStageAction(moving.id,moving.epoch,moving.direction!.actionId);
  const origin=runtime.service.captureSupplementOrigin(moving.id,"target.math.vertex-form");
  const preparing={id:"supplement.position",questionId:"question.position",status:"preparing" as const,attempt:1,origin,candidate:null,failure:null,adoptedAt:new Date().toISOString(),firstAudioAt:null};
  runtime.service.announceSupplement(moving.id,preparing,{interrupt:true,bridgeText:null,bridgeTargetIds:[]});
  const candidate={speechText:"補足です。",captionText:"補足",sceneId:"scene.math.form",focusTargetIds:["target.math.vertex-form"],boardPatches:[],sourceIds:["source.quadratic"],knowledgeBasis:"course" as const,calculations:[],corrections:[]};
  runtime.service.queueSupplement(moving.id,{...preparing,status:"ready",candidate},{onPlaybackStarted(){},onCompleted(){}});
  expect(runtime.service.getSession(moving.id).liveSupplement?.status).toBe("playing");
  expect(runtime.service.getSession(moving.id).direction).toBeNull();
  planner.mockClear();
  await vi.advanceTimersByTimeAsync(100);
  expect(planner.mock.calls[0]![0].session.direction?.position).toBe("left");
  expect(planner.mock.calls[0]![0].session.direction?.targetId).toBeNull();
 }finally{runtime.close();}
});

it("generates notes together with speech and returns to slides on the next null board beat",async()=>{
 const runtime=setup();
 try {
  const unit=quadraticFunctionsFixture.teachingUnits[0]!;
  const beat={text:unit.speechText,targetId:null,camera:"lecture",position:"right",gesture:"explain",walkWhileSpeaking:false};
  const llm=new FixedResponseLlmProvider([{beats:[{...beat,blackboardMarkdown:"# 要点\n◎ 頂点 → 式の形"},{...beat,blackboardMarkdown:null}]}]);
  const plan=await createLessonPlanner(()=>llm)({session:runtime.session,unit,previousSpeech:"",remainingMs:10000},new AbortController().signal);
  expect(plan.source).toBe("generated");expect(llm.calls).toHaveLength(1);
  expect(plan.actions[0]).toMatchObject({type:"show_blackboard",drawing:{markdown:"# 要点\n◎ 頂点 → 式の形"}});
  expect(plan.actions.findIndex(a=>a.type==="show_slides")).toBeGreaterThan(plan.actions.findIndex(a=>a.type==="speak"));
 }finally{runtime.close();}
});

it("waits through long acknowledged board writing without starting speech; disconnected rendering still fails",async()=>{
 vi.useFakeTimers();
 const runtime=setup(async()=>({source:"generated",reason:null,actions:[{type:"show_blackboard",drawing:{id:"board",markdown:"# 要点",purpose:"要点"}},{type:"speak",text:"板書が見えた後の説明"}]}));
 try{
  await vi.advanceTimersByTimeAsync(0);
  const view=runtime.service.getSession(runtime.session.id);
  for(let i=0;i<15;i++){runtime.service.reportStageProgress(view.id,view.epoch,view.direction!.actionId);await vi.advanceTimersByTimeAsync(2000);}
  expect(runtime.service.getSession(view.id).direction?.phase).toBe("drawing");
  expect(runtime.service.getSession(view.id).speech.playing).toBe(false);
  runtime.service.completeStageAction(view.id,view.epoch,view.direction!.actionId);
  expect(runtime.service.getSession(view.id).speech.text).toBe("板書が見えた後の説明");
 }finally{runtime.close();}
});
