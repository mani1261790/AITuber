import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dnaReplicationFixture, quadraticFunctionsFixture, vaeReparameterizationFixture } from "@aituber/content";
import type { CoursePackage, ReadonlyCoursePackage } from "@aituber/contracts";
import { type LlmProvider, FixedResponseLlmProvider } from "@aituber/providers";
import { CourseAuthoringService } from "./course-authoring-service.ts";

const fixtures = [quadraticFunctionsFixture, dnaReplicationFixture, vaeReparameterizationFixture];

describe("CourseAuthoringService", () => {
  it('fills hashes and source provenance itself instead of asking the model to invent them', async () => {
    const source = upload('Original quadratic source');
    const candidate = remapSource(quadraticFunctionsFixture, sourceId(source));
    const generated = JSON.parse(JSON.stringify(candidate)); delete generated.contentHash; delete generated.sources;
    const provider = new FixedResponseLlmProvider([generated,passingReview()]);
    const service = new CourseAuthoringService({directory:mkdtempSync(join(tmpdir(),'aituber-metadata-')),llm:()=>provider});
    const result = await service.create({durationMinutes:5,sources:[source]});
    expect(result.status).toBe('available');expect(result.attempts).toBe(1);
    expect(result.course!.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.course!.sources[0]!.contentHash).toBe('sha256:'+createHash('sha256').update(Buffer.from(source.dataBase64,'base64')).digest('hex'));
  });
  it('accepts passed reviews without redundant empty repair instructions', async () => {
    const source=upload('Quadratic source');const candidate=remapSource(quadraticFunctionsFixture,sourceId(source));
    const review=JSON.parse(JSON.stringify(passingReview()));for(const gate of review.gates)delete gate.repairInstruction;
    const provider=new FixedResponseLlmProvider([candidate,review]);
    const service=new CourseAuthoringService({directory:mkdtempSync(join(tmpdir(),'aituber-review-default-')),llm:()=>provider});
    const result=await service.create({durationMinutes:5,sources:[source]});
    expect(result.status).toBe('available');expect(result.attempts).toBe(1);
    expect(result.review!.gates.every(gate=>gate.passed && gate.repairInstruction==='')).toBe(true);
  });
  it.each(fixtures.map((fixture) => [fixture.targetLevel, fixture] as const))("makes the %s verification material available after independent review", async (_level, fixture) => {
    const source = upload(`Source notes for ${fixture.title}`);
    const candidate = remapSource(fixture, sourceId(source));
    const provider = new FixedResponseLlmProvider([candidate, passingReview()]);
    const directory = mkdtempSync(join(tmpdir(), "aituber-authoring-"));
    const service = new CourseAuthoringService({ directory, llm: () => provider });

    const result = await service.create({ durationMinutes: fixture.durationMinutes, sources: [source] });

    expect(result.status).toBe("available");
    const hash = result.course!.sources[0]!.contentHash.replace("sha256:", "");
    expect(readFileSync(join(directory,"sources",hash))).toEqual(Buffer.from(source.dataBase64,"base64"));
    expect(result.course?.title).toBe(fixture.title);
    expect(result.course?.targetLevel).toBe(fixture.targetLevel);
    expect(result.course?.learningGoals).toEqual(fixture.learningGoals);
    expect(result.review?.gates).toHaveLength(9);
    expect(provider.calls.map((call) => call.purpose)).toEqual(["generation", "review"]);
  });

  it("chooses a local repair, checkpoints it, and stops immediately when the repaired version passes", async () => {
    const source = upload("Quadratic function notes"); const id = sourceId(source);
    const valid = remapSource(quadraticFunctionsFixture, id);
    const invalid = structuredClone(valid); delete invalid.teachingUnits[0]!.teachingPlan;
    const provider = new FixedResponseLlmProvider([invalid, valid, passingReview()]);
    const directory = mkdtempSync(join(tmpdir(), "aituber-authoring-"));
    const service = new CourseAuthoringService({ directory, llm: () => provider });

    const result = await service.create({ durationMinutes: 6, sources: [source] });

    expect(result.status).toBe("available");
    expect(result.attempts).toBe(2);
    expect(provider.calls.map((call) => call.purpose)).toEqual(["generation", "generation", "review"]);
    expect(provider.calls[1]?.systemInstruction).toContain("repair only");
    expect(service.get(result.id).course?.status).toBe("available");
  });

  it("repairs a missing teaching plan before requesting independent review", async () => {
    const source=upload("Quadratic notes");
    const valid=remapSource(quadraticFunctionsFixture,sourceId(source));
    const invalid=structuredClone(valid);delete invalid.teachingUnits[0]!.teachingPlan;
    const provider=new FixedResponseLlmProvider([invalid,valid,passingReview()]);
    const service=new CourseAuthoringService({directory:mkdtempSync(join(tmpdir(),"aituber-plan-")),llm:()=>provider});
    const result=await service.create({durationMinutes:6,sources:[source]});
    expect(result.status).toBe("available");
    expect(result.attempts).toBe(2);
    expect(provider.calls.map(call=>call.purpose)).toEqual(["generation","generation","review"]);
    expect(provider.calls[1]?.prompt).toContain("teachingPlan");
    expect(result.course?.teachingUnits.every(unit=>unit.teachingPlan)).toBe(true);
  });

  it("stops at a budget checkpoint and can resume without discarding the candidate", async () => {
    const source = upload("DNA notes"); const candidate = remapSource(dnaReplicationFixture, sourceId(source));
    const provider = new FixedResponseLlmProvider([candidate, candidate, passingReview()], { inputTokens: 100, outputTokens: 100, totalTokens: 200, estimatedCostUsd: 0.75 });
    const service = new CourseAuthoringService({ directory: mkdtempSync(join(tmpdir(), "aituber-authoring-")), llm: () => provider });
    const first = await service.create({ durationMinutes: 6, sources: [source], costBudgetUsd: 0.5 });
    expect(first.status).toBe("budget-exhausted");
    expect(first.attempts).toBe(1);
    expect(first.course).toBeNull();
    const resumed = await service.resume(first.id, { additionalCostBudgetUsd: 2, additionalTimeBudgetMs: 10_000 });
    expect(resumed.status).toBe("available");
    expect(resumed.attempts).toBe(2);
    expect(provider.calls[1]?.systemInstruction).toContain("repair only");
  });

  it("regenerates after a schema-invalid model response instead of failing the job", async () => {
    const source = upload("Quadratic function notes"); const candidate = remapSource(quadraticFunctionsFixture, sourceId(source));
    const provider = new FixedResponseLlmProvider([{ unexpected: true }, candidate, passingReview()]);
    const service = new CourseAuthoringService({ directory: mkdtempSync(join(tmpdir(), "aituber-authoring-")), llm: () => provider });

    const result = await service.create({ durationMinutes: 6, sources: [source] });

    expect(result.status).toBe("available");
    expect(result.attempts).toBe(2);
    expect(provider.calls[1]?.systemInstruction).toContain("Generate the complete package");
  });

  it("locally repairs semantic reference failures before independent review", async () => {
    const source = upload("Quadratic function notes"); const valid = remapSource(quadraticFunctionsFixture, sourceId(source));
    const invalid = structuredClone(valid); invalid.schedule.orderedUnitIds = ["unit.missing"];
    const provider = new FixedResponseLlmProvider([invalid, valid, passingReview()]);
    const service = new CourseAuthoringService({ directory: mkdtempSync(join(tmpdir(), "aituber-authoring-")), llm: () => provider });

    const result = await service.create({ durationMinutes: 6, sources: [source] });

    expect(result.status).toBe("available");
    expect(result.attempts).toBe(2);
    expect(provider.calls[1]?.systemInstruction).toContain("repair only");
  });

  it("turns an interrupted running checkpoint into a resumable state on startup", async () => {
    const source = upload("DNA notes"); const directory = mkdtempSync(join(tmpdir(), "aituber-authoring-"));
    const service = new CourseAuthoringService({ directory, llm: () => new FixedResponseLlmProvider([]) });
    const stopped = await service.create({ durationMinutes: 6, sources: [source], costBudgetUsd: 0 });
    const path = join(directory, `${stopped.id}.json`); const checkpoint = JSON.parse(readFileSync(path, "utf8")) as { status: string; error: string | null };
    checkpoint.status = "running"; checkpoint.error = null; writeFileSync(path, JSON.stringify(checkpoint));

    const recovered = new CourseAuthoringService({ directory, llm: () => new FixedResponseLlmProvider([]) }).get(stopped.id);

    expect(recovered.status).toBe("budget-exhausted");
    expect(recovered.error).toContain("再開できます");
  });
});

function upload(text: string) { return { fileName: "notes.md", mimeType: "text/markdown" as const, dataBase64: Buffer.from(text).toString("base64"), rights: { basis: "owned" as const } }; }
function sourceId(source: ReturnType<typeof upload>) { return `source.${createHash("sha256").update(Buffer.from(source.dataBase64, "base64")).digest("hex").slice(0, 24)}`; }
function remapSource(fixture: ReadonlyCoursePackage, id: string): CoursePackage {
  const value = structuredClone(fixture) as CoursePackage;
  value.semanticTargets.forEach((target) => { target.sourceIds = [id]; }); value.teachingUnits.forEach((unit) => { unit.sourceIds = [id]; unit.captionText = unit.speechText; unit.teachingPlan = {keyPoints:[unit.postconditions[0]!], explanationFlow:[unit.speechText]}; });
  return value;
}
function passingReview() { return { gates: gateIds().map((id) => ({ id, passed: true, rationale: "verified", locations: [], repairInstruction: "" })), repairMode: "local", summary: "all gates passed" }; }
function gateIds() { return ["source-alignment", "factual-consistency", "goal-alignment", "prerequisites", "references", "renderability", "speech-caption", "safe-content", "rights"] as const; }

it("aborts an in-flight generation at the job deadline and keeps it resumable", async () => {
 const provider: LlmProvider = { createContext: ({purpose}) => ({ purpose, generate: request => new Promise((_resolve, reject) => {
  request.signal!.addEventListener("abort", () => reject(request.signal!.reason), {once:true});
 }) }) };
 const service = new CourseAuthoringService({directory:mkdtempSync(join(tmpdir(), "aituber-deadline-")),llm:()=>provider});
 const result = await service.create({durationMinutes:6,sources:[upload("Quadratic notes")],timeBudgetMs:1000});
 expect(result.status).toBe("budget-exhausted");
 expect(result.error).toBe("時間または費用の上限に達しました。");
 expect(service.get(result.id).sourceCount).toBe(1);
});

it('runs one persisted authoring iteration per alarm and resumes after a new service instance', async () => {
  const source=upload('Quadratic function notes');const valid=remapSource(quadraticFunctionsFixture,sourceId(source));
  const invalid=structuredClone(valid);delete invalid.teachingUnits[0]!.teachingPlan;
  const provider=new FixedResponseLlmProvider([invalid,valid,passingReview()]);
  const directory=mkdtempSync(join(tmpdir(),'aituber-authoring-alarm-'));let scheduled=0;
  const first=new CourseAuthoringService({directory,llm:()=>provider,defer:()=>{scheduled++;}});
  const job=await first.begin({durationMinutes:6,sources:[source]});
  expect(scheduled).toBe(1);expect(provider.calls).toHaveLength(0);
  await first.runPendingStep();expect(first.get(job.id).status).toBe('running');expect(provider.calls).toHaveLength(1);
  const second=new CourseAuthoringService({directory,llm:()=>provider,defer:()=>{scheduled++;}});
  expect(second.get(job.id).status).toBe('running');await second.runPendingStep();
  expect(second.get(job.id).status).toBe('available');expect(second.get(job.id).attempts).toBe(2);
  await second.runPendingStep();expect(provider.calls).toHaveLength(3);
});

it('persists a stop before a deferred step and does not resume it after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aituber-stop-'));
  const provider = new FixedResponseLlmProvider([]);
  const service = new CourseAuthoringService({ directory, llm: () => provider, defer: () => undefined });
  const job = await service.begin({ durationMinutes: 5, sources: [upload('Keep this original')] });
  expect(service.stop(job.id).status).toBe('stopped');
  expect(service.stop(job.id).status).toBe('stopped');
  const restored = new CourseAuthoringService({ directory, llm: () => provider, defer: () => undefined });
  await restored.runPendingStep();
  expect(restored.get(job.id).status).toBe('stopped');
  expect(restored.get(job.id).sourceCount).toBe(1);
  expect(provider.calls).toHaveLength(0);
});

it.each(['generation', 'review'] as const)('aborts active %s and ignores a late response after stop', async (phase) => {
  const source = upload('Preserve source');
  const candidate = remapSource(quadraticFunctionsFixture, sourceId(source));
  const fixture = new FixedResponseLlmProvider([candidate, passingReview()]);
  let signal: AbortSignal | undefined;
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const purposes: string[] = [];
  const provider: LlmProvider = { createContext(options) {
    purposes.push(options.purpose);
    const context = fixture.createContext(options);
    return { purpose: options.purpose, async generate(request) {
      const result = await context.generate(request);
      if (options.purpose === phase) { signal = request.signal; started(); await held; }
      return result;
    } };
  } };
  let available = false;
  const service = new CourseAuthoringService({ directory: mkdtempSync(join(tmpdir(), 'aituber-stop-active-')), llm: () => provider, defer: () => undefined, onAvailable: () => { available = true; } });
  const job = await service.begin({ durationMinutes: 5, sources: [source] });
  const running = service.runPendingStep();
  await entered;
  expect(service.stop(job.id).status).toBe('stopped');
  expect(signal?.aborted).toBe(true);
  release(); await running;
  await service.runPendingStep();
  expect(service.get(job.id).status).toBe('stopped');
  expect(service.get(job.id).course).toBeNull();
  expect(available).toBe(false);
  expect(purposes).toEqual(phase === 'generation' ? ['generation'] : ['generation', 'review']);
});

it('marks unexecuted checks pending and stops after three identical output failures across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aituber-repeated-'));
  const provider = new FixedResponseLlmProvider([{}, {}, {}, {}]);
  let service = new CourseAuthoringService({directory, llm: () => provider, defer: () => undefined});
  const job = await service.begin({durationMinutes: 5, sources: [upload('Source')]});
  for (let i = 0; i < 2; i++) {
    await service.runPendingStep();
    const pending = service.get(job.id);
    expect(pending.review!.gates.filter(gate => gate.passed)).toHaveLength(0);
    expect(pending.review!.gates.filter(gate => gate.evaluated === false)).toHaveLength(7);
    service = new CourseAuthoringService({directory, llm: () => provider, defer: () => undefined});
  }
  await service.runPendingStep();
  expect(service.failure?.message).toContain('3回');
  expect(service.list()).toEqual([]);
  expect(existsSync(join(directory, `${job.id}.json`))).toBe(false);
  service = new CourseAuthoringService({directory, llm: () => provider, defer: () => undefined});
  await service.runPendingStep(); expect(provider.calls).toHaveLength(3);
});

it('caps differing failed attempts at five and removes their history', async () => {
  const source = upload('Source');
  const valid = remapSource(quadraticFunctionsFixture, sourceId(source));
  const invalids = Array.from({length: 5}, (_, i) => { const candidate = structuredClone(valid); candidate.schedule.orderedUnitIds = [`unit.missing${i}`]; return candidate; });
  const provider = new FixedResponseLlmProvider(invalids);
  const service = new CourseAuthoringService({directory: mkdtempSync(join(tmpdir(), 'aituber-limit-')), llm: () => provider});
  const failed = await service.create({durationMinutes: 5, sources: [source]});
  expect(failed.status).toBe('failed'); expect(failed.attempts).toBe(5);
  expect(service.list()).toEqual([]);
  expect(service.failure?.message).toContain('上限');
});

it('rejects duplicate creation during ingestion and while another deferred job runs', async () => {
  const service = new CourseAuthoringService({directory: mkdtempSync(join(tmpdir(), 'aituber-duplicate-')), llm: () => new FixedResponseLlmProvider([]), defer: () => undefined});
  const request = {durationMinutes: 5, sources: [upload('Source')]};
  const first = service.begin(request);
  await expect(service.begin(request)).rejects.toThrow('実行中');
  const job = await first;
  await expect(service.begin(request)).rejects.toThrow('実行中');
  service.stop(job.id);
  const next = await service.begin(request);
  expect(() => service.beginResume(job.id)).toThrow('実行中');
  expect(service.get(next.id).status).toBe('running');
});

it('does not extend or reset a deferred running job through repeated resume/restart calls', async () => {
  const service = new CourseAuthoringService({directory: mkdtempSync(join(tmpdir(), 'aituber-running-budget-')), llm: () => new FixedResponseLlmProvider([]), defer: () => undefined});
  const job = await service.begin({durationMinutes: 5, sources: [upload('Source')]});
  expect(service.beginResume(job.id).request).toEqual(job.request);
  expect(service.beginRestart(job.id).attemptLimit).toBe(job.attemptLimit);
  expect((await service.resume(job.id)).request).toEqual(job.request);
  expect((await service.restart(job.id)).createdAt).toBe(job.createdAt);
});

it('corrects legacy synthetic passes without changing actual completed review decisions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aituber-legacy-review-'));
  const service = new CourseAuthoringService({directory, llm: () => new FixedResponseLlmProvider([]), defer: () => undefined});
  const job = await service.begin({durationMinutes: 5, sources: [upload('Source')]});
  const file = join(directory, `${job.id}.json`);
  const checkpoint = JSON.parse(readFileSync(file, 'utf8'));
  checkpoint.review = {...passingReview(), summary: '生成結果が所定の形式を満たしていません'};
  checkpoint.review.gates.forEach((gate: {rationale: string}) => { gate.rationale = 'この検査では問題なし'; });
  writeFileSync(file, JSON.stringify(checkpoint));
  expect(service.get(job.id).review!.gates.every(gate => !gate.passed && gate.evaluated === false)).toBe(true);
  checkpoint.review.summary = '全項目の審査を完了';
  writeFileSync(file, JSON.stringify(checkpoint));
  expect(service.get(job.id).review!.gates.every(gate => gate.passed)).toBe(true);
});


it('removes failed checkpoints, reports a temporary error, and preserves original sources', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aituber-failure-cleanup-'));
  const options = {directory, cacheViews: true, defer: () => undefined, llm: () => {throw new Error('生成がタイムアウトしました');}};
  const service = new CourseAuthoringService(options);
  const source = upload('Original source');
  const job = await service.begin({durationMinutes: 5, sources: [source]});
  await service.runPendingStep();
  expect(service.list()).toEqual([]);
  expect(existsSync(join(directory, `${job.id}.json`))).toBe(false);
  expect(service.failure).toEqual({id: job.id, message: '生成がタイムアウトしました'});
  expect(service.readSource(`sha256:${createHash('sha256').update(Buffer.from(source.dataBase64, 'base64')).digest('hex')}`)).toEqual(Buffer.from(source.dataBase64, 'base64'));
  const restored = new CourseAuthoringService(options);
  expect(restored.list()).toEqual([]); expect(restored.failure).toBeNull();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300_001);
  try {expect(service.failure).toBeNull();} finally {vi.restoreAllMocks();}
});

it('purges legacy failures but retains available materials and deliberate stops', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aituber-legacy-failure-'));
  const options = {directory, cacheViews: true, defer: () => undefined, llm: () => new FixedResponseLlmProvider([])};
  const service = new CourseAuthoringService(options);
  const job = await service.begin({durationMinutes: 5, sources: [upload('Source')]});
  service.stop(job.id);
  const file = join(directory, `${job.id}.json`);
  const legacy = JSON.parse(readFileSync(file, 'utf8')); legacy.status = 'failed';
  writeFileSync(file, JSON.stringify(legacy));
  expect(new CourseAuthoringService(options).list()).toEqual([]);
  expect(existsSync(file)).toBe(false);
});

it('retries malformed review output without regenerating valid teaching content', async () => {
  const source = upload('Quadratic source');
  const provider = new FixedResponseLlmProvider([remapSource(quadraticFunctionsFixture, sourceId(source)), {invalid: true}, passingReview()]);
  const service = new CourseAuthoringService({directory: mkdtempSync(join(tmpdir(), 'aituber-review-retry-')), llm: () => provider});
  const result = await service.create({durationMinutes: 5, sources: [source]});
  expect(result.status).toBe('available');
  expect(result.attempts).toBe(1);
  expect(provider.calls.map(call => call.purpose)).toEqual(['generation', 'review', 'review']);
});


it.each(['omitted', 'different'])('derives %s captions from reference speech without regenerating the material', async (mode) => {
  const source = upload('Quadratic source');
  const candidate = JSON.parse(JSON.stringify(remapSource(quadraticFunctionsFixture, sourceId(source))));
  for (const unit of candidate.teachingUnits) {if (mode === 'omitted') delete unit.captionText; else unit.captionText = '要約された字幕';}
  const provider = new FixedResponseLlmProvider([candidate, passingReview()]);
  const service = new CourseAuthoringService({directory: mkdtempSync(join(tmpdir(), 'aituber-derived-captions-')), llm: () => provider});
  const result = await service.create({durationMinutes: 5, sources: [source]});
  expect(result.status).toBe('available'); expect(result.attempts).toBe(1);
  expect(result.course!.teachingUnits.every(unit => unit.captionText === unit.speechText)).toBe(true);
  expect(provider.calls.map(call => call.purpose)).toEqual(['generation', 'review']);
});
