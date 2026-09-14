import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dnaReplicationFixture, quadraticFunctionsFixture, vaeReparameterizationFixture } from "@aituber/content";
import type { CoursePackage, ReadonlyCoursePackage } from "@aituber/contracts";
import { FixedResponseLlmProvider } from "@aituber/providers";
import { CourseAuthoringService } from "./course-authoring-service.ts";

const fixtures = [quadraticFunctionsFixture, dnaReplicationFixture, vaeReparameterizationFixture];

describe("CourseAuthoringService", () => {
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
    const invalid = structuredClone(valid); invalid.teachingUnits[0]!.captionText = "different caption";
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
  value.semanticTargets.forEach((target) => { target.sourceIds = [id]; }); value.teachingUnits.forEach((unit) => { unit.sourceIds = [id]; unit.captionText = unit.speechText; });
  return value;
}
function passingReview() { return { gates: gateIds().map((id) => ({ id, passed: true, rationale: "verified", locations: [], repairInstruction: "" })), repairMode: "local", summary: "all gates passed" }; }
function gateIds() { return ["source-alignment", "factual-consistency", "goal-alignment", "prerequisites", "references", "renderability", "speech-caption", "safe-content", "rights"] as const; }
