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
      const llm = new FixedResponseLlmProvider([{beats:[{text:"では、この式の頂点に注目しましょう。",targetId:unit.focusTargetIds[0],camera:"lecture",position:"right"}]}]);
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
