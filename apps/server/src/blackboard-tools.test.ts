import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { SvgProvider } from "@aituber/providers";
import { BlackboardTools } from "./blackboard-tools.ts";
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><path d="M100 100 L400 400" stroke="white" stroke-width="4"/></svg>';
it("stores validated drawings and forwards the prior specialist SVG for append",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"aituber-svg-"));
  try {
    const provider={generate:vi.fn<SvgProvider["generate"]>(async()=>svg)}; const tools=new BlackboardTools(provider,dir); const signal=new AbortController().signal;
    const first=await tools.execute({name:"draw_blackboard",arguments:{purpose:"図",requirements:"線",mode:"replace"}},signal);
    expect(await readFile(join(dir,first.id+".svg"),"utf8")).toBe(first.svg);
    await tools.execute({name:"draw_blackboard",arguments:{purpose:"追加",requirements:"日本語",mode:"append"}},signal,first);
    expect(provider.generate.mock.calls[1]?.[2]).toBe(first.svg);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

it("compiles a typed LLM tool call into a saved SVG before its spoken explanation",async()=>{
  const {FixedResponseLlmProvider}=await import("@aituber/providers");
  const {quadraticFunctionsFixture}=await import("@aituber/content");
  const {LectureEventStore}=await import("@aituber/storage");
  const {FixedLectureService}=await import("./fixed-lecture-service.ts");
  const {createLessonPlanner}=await import("./lesson-director.ts");
  const dir=await mkdtemp(join(tmpdir(),"aituber-svg-plan-")); const store=new LectureEventStore(":memory:");
  const lecture=new FixedLectureService({store,courses:[quadraticFunctionsFixture]});
  try {
    const session=lecture.createSession({coursePackageId:quadraticFunctionsFixture.id,durationMinutes:6});
    const provider={generate:vi.fn<SvgProvider["generate"]>(async()=>svg)};
    const llm=new FixedResponseLlmProvider([{beats:[{text:"頂点の位置を図で見ましょう。",targetId:null,camera:"lecture",position:"left",gesture:"explain",walkWhileSpeaking:false,toolCall:{name:"draw_blackboard",arguments:{purpose:"頂点",requirements:"頂点を日本語で明記",mode:"replace"}}}]}]);
    const plan=await createLessonPlanner(()=>llm,new BlackboardTools(provider,dir))({session,unit:quadraticFunctionsFixture.teachingUnits[0]!,previousSpeech:"",remainingMs:10000},new AbortController().signal);
    expect(plan.source).toBe("generated");
    expect(plan.actions.map(action=>action.type)).toEqual(["show_blackboard","camera","move_to","point_at","speak","release_point"]);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(plan.actions.find(action=>action.type==="speak")).toEqual({type:"speak",text:"頂点の位置を図で見ましょう。",gesture:"explain"});
  } finally {lecture.close();store.close();await rm(dir,{recursive:true,force:true});}
});
