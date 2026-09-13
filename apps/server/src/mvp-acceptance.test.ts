import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClassroomJoinResponse, FixedSessionView } from "@aituber/contracts";
import type { LlmContext, LlmProvider, LlmPurpose, StructuredGenerationRequest } from "@aituber/providers";
import { TestToneSpeechProvider } from "@aituber/providers";
import { AfterClassStore, DataRetentionStore, LearningEvidenceStore, LectureEventStore, LiveSupplementStore, QuestionStore, ResourceBudgetStore } from "@aituber/storage";
import { AfterClassService } from "./after-class-service.ts";
import { createApp } from "./app.ts";
import { DataRetentionService } from "./data-retention-service.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import { LiveSupplementService } from "./live-supplement-service.ts";
import { PedagogyService } from "./pedagogy-service.ts";
import { QuestionQueueService } from "./question-queue-service.ts";

interface RunResult {
  readonly courseId: string;
  readonly questionAcceptedMs: number;
  readonly pauseMs: number;
  readonly supplementCompletedMs: number;
  readonly reconnectPreservedParticipant: boolean;
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly finalEvidenceStates: readonly string[];
}

describe("MVP acceptance path", () => {
  const directory = mkdtempSync(join(tmpdir(), "aituber-mvp-acceptance-"));
  const databasePath = join(directory, "acceptance.db");
  const lectureStore = new LectureEventStore(databasePath);
  const questionStore = new QuestionStore(databasePath);
  const supplementStore = new LiveSupplementStore(databasePath);
  const evidenceStore = new LearningEvidenceStore(databasePath);
  const afterClassStore = new AfterClassStore(databasePath);
  const budgetStore = new ResourceBudgetStore(databasePath, {}, {});
  const retentionStore = new DataRetentionStore(databasePath);
  const lecture = new FixedLectureService({ store: lectureStore, playbackUnitMs: 100, speechProvider: new TestToneSpeechProvider(100), voiceId: "voice.acceptance" });
  const questions = new QuestionQueueService({ store: questionStore, context: (sessionId) => ({ session: lecture.getSession(sessionId), remainingMs: lecture.getRemainingTimeMs(sessionId) }) });
  const pedagogy = new PedagogyService({ store: evidenceStore, lecture, questions });
  const provider = new AcceptanceLlmProvider();
  const supplements = new LiveSupplementService({ store: supplementStore, questions, lecture, llm: () => provider });
  const afterClass = new AfterClassService({ store: afterClassStore, questions, lecture, llm: () => provider });
  const server = createApp(lecture, undefined, undefined, questions, pedagogy, afterClass);
  let origin = "";

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    supplements.close(); afterClass.close(); lecture.close(); server.emit("aituber:shutdown");
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    retentionStore.close(); budgetStore.close(); afterClassStore.close(); evidenceStore.close(); supplementStore.close(); questionStore.close(); lectureStore.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("finishes mathematics, biology, and VAE through HTTP with pause, question, supplement, checkpoint, reconnect, and survey", async () => {
    const courseIds = ["course.quadratic-functions", "course.dna-replication", "course.vae-reparameterization"];
    const answers = ["(-3, -4)", "RNAプライマーが置かれる", "epsilon"];
    const results: RunResult[] = [];
    for (let index = 0; index < courseIds.length; index += 1) results.push(await runCourse(courseIds[index]!, answers[index]!));

    expect(results.map((result) => result.courseId)).toEqual(courseIds);
    expect(results.every((result) => result.completedUnits === result.totalUnits)).toBe(true);
    expect(results.every((result) => result.reconnectPreservedParticipant)).toBe(true);
    expect(results.every((result) => result.questionAcceptedMs < 1_000)).toBe(true);
    expect(results.every((result) => result.pauseMs < 250)).toBe(true);
    expect(results.every((result) => result.supplementCompletedMs < 8_000)).toBe(true);
    expect(results.every((result) => result.finalEvidenceStates.includes("confirmed-for-item"))).toBe(true);
    expect(provider.calls.filter((call) => call === "live_supplement")).toHaveLength(3);
    expect(provider.calls.filter((call) => call === "live_supplement_review")).toHaveLength(3);
    process.stdout.write(`MVP_ACCEPTANCE ${JSON.stringify({ courses: results, p95: { questionAcceptedMs: percentile95(results.map((result) => result.questionAcceptedMs)), pauseMs: percentile95(results.map((result) => result.pauseMs)), supplementCompletedMs: percentile95(results.map((result) => result.supplementCompletedMs)) } })}\n`);
  }, 30_000);

  it("deletes old session data and related speech cache under a shortened one-minute retention window", async () => {
    const oldSessionId = "session.00000000-0000-4000-8000-000000000018";
    const cacheDirectory = join(directory, "tts-cache"); const cacheName = `${"a".repeat(64)}.audio`; const cachePath = join(cacheDirectory, cacheName);
    await mkdir(cacheDirectory, { recursive: true }); await writeFile(cachePath, "expired speech"); await utimes(cachePath, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-01T00:00:00.000Z"));
    lectureStore.createSession({ id: oldSessionId, coursePackageId: "course.retention", coursePackageVersion: 1, createdAt: "2026-09-01T00:00:00.000Z" });
    const retention = new DataRetentionService({ store: retentionStore, cacheDirectories: [cacheDirectory], retentionMs: 60_000 });
    const result = await retention.purgeNow();
    expect(result.data.sessions).toBe(1); expect(result.cacheFiles).toBe(1); expect(existsSync(cachePath)).toBe(false);
    expect(() => lectureStore.getSession(oldSessionId)).toThrow();
  });

  async function runCourse(coursePackageId: string, answer: string): Promise<RunResult> {
    const created = await request<{ session: FixedSessionView; classroom: { code: string } }>("/api/sessions", "operator", { coursePackageId, durationMinutes: 6 });
    const sessionId = created.session.id;
    const join = await request<ClassroomJoinResponse>("/api/classrooms/join", "classroom", { code: created.classroom.code });

    await waitFor(async () => (await session(sessionId)).speech.playing);
    const pauseStarted = performance.now();
    const paused = await request<{ session: FixedSessionView }>(`/api/sessions/${sessionId}/commands`, "operator", { command: "pause" });
    const pauseMs = performance.now() - pauseStarted;
    expect(paused.session.status).toBe("PAUSED"); expect(paused.session.speech.playing).toBe(false);
    await request(`/api/sessions/${sessionId}/commands`, "operator", { command: "resume" });

    const active = await waitFor(async () => { const value = await session(sessionId); return value.displayUnitId ? value : null; });
    const unit = active.course.teachingUnits.find((candidate) => candidate.id === active.displayUnitId)!;
    const targetId = unit.focusTargetIds[0]!;
    const questionStarted = performance.now();
    const submitted = await request<{ question: { id: string } }>(`/api/classrooms/${created.classroom.code}/questions`, "classroom", { accessToken: join.participant.accessToken, text: `この対象を教材に沿って説明してください ${coursePackageId}`, sceneId: unit.sceneId, semanticTargetId: targetId });
    const questionAcceptedMs = performance.now() - questionStarted;
    const supplementStarted = performance.now();
    await waitFor(async () => { const value = await session(sessionId); return value.liveSupplement?.status === "completed" ? value : null; }, 10_000);
    const supplementCompletedMs = performance.now() - supplementStarted;

    const reconnected = await request<ClassroomJoinResponse>(`/api/classrooms/${created.classroom.code}/reconnect`, "classroom", { accessToken: join.participant.accessToken });
    expect(submitted.question.id).toMatch(/^question\./);
    const checkpoint = await waitFor(async () => { const value = await session(sessionId); return value.status === "CHECKPOINT" ? value : null; }, 10_000);
    expect(checkpoint.assessment).not.toBeNull();
    await request(`/api/classrooms/${created.classroom.code}/answer`, "classroom", { accessToken: join.participant.accessToken, answer });
    const finished = await waitFor(async () => { const value = await session(sessionId); return value.status === "FINISHED" ? value : null; }, 10_000);
    await request(`/api/classrooms/${created.classroom.code}/survey`, "classroom", { accessToken: join.participant.accessToken, questionHelpfulness: 5, rejoinNaturalness: 5, comment: "総合受入" });
    return { courseId: coursePackageId, questionAcceptedMs, pauseMs, supplementCompletedMs, reconnectPreservedParticipant: reconnected.participant.id === join.participant.id, completedUnits: finished.progress.completed, totalUnits: finished.progress.total, finalEvidenceStates: finished.learningEvidence.map((item) => item.state) };
  }

  async function session(id: string) { return (await request<{ session: FixedSessionView }>(`/api/sessions/${id}`, "operator")).session; }
  async function request<T = unknown>(path: string, surface: "operator" | "classroom", body?: unknown): Promise<T> {
    const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-aituber-surface": surface, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return await response.json() as T;
  }
});

async function waitFor<T>(read: () => Promise<T | null | false>, timeoutMs = 5_000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) { const result = await read(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error(`Acceptance condition did not arrive within ${timeoutMs}ms`);
}

class AcceptanceLlmProvider implements LlmProvider {
  readonly calls: string[] = [];
  createContext(options: { purpose: LlmPurpose; systemInstruction: string }): LlmContext {
    return { purpose: options.purpose, generate: async <T>(request: StructuredGenerationRequest<T>) => {
      this.calls.push(request.schemaName);
      const value = responseFor(request.schemaName, request.prompt) as T;
      return { value, model: "acceptance-fixed-v1", provider: "fixed", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }, latencyMs: 0 };
    } };
  }
}

function responseFor(schemaName: string, prompt: string): unknown {
  if (schemaName === "live_supplement") {
    const sceneId = prompt.match(/Frozen scene: ([^\n]+)/)?.[1] ?? "";
    const targetId = prompt.match(/Frozen semantic target: ([^\n]+)/)?.[1] ?? "";
    const sourceId = targetId.startsWith("target.math.") ? "source.quadratic" : targetId.startsWith("target.dna.") ? "source.dna" : "source.vae";
    return { speechText: "質問時の対象を教材の説明と結び付けて確認します。", captionText: "質問時の対象を教材に沿って確認します。", sceneId, focusTargetIds: [targetId], boardPatches: [], sourceIds: [sourceId], knowledgeBasis: "course", calculations: [], corrections: [] };
  }
  if (schemaName === "live_supplement_review") return { gates: ["sources", "semantic-targets", "content", "board", "calculations"].map((id) => ({ id, passed: true, rationale: "固定教材と整合します。" })), summary: "受入固定応答は全ゲートに合格しました。" };
  if (schemaName === "post_class_answer") return { answerText: "教材に沿って授業後に回答します。", sourceIds: [sourceFromPrompt(prompt)], knowledgeBasis: "course" };
  if (schemaName === "post_class_answer_review") return { gates: ["sources", "content", "safe-content"].map((id) => ({ id, passed: true, rationale: "固定教材と整合します。" })), summary: "受入固定応答は全ゲートに合格しました。" };
  throw new Error(`Unexpected acceptance schema ${schemaName}`);
}

function sourceFromPrompt(prompt: string): string { return prompt.includes("course.quadratic") ? "source.quadratic" : prompt.includes("course.dna") ? "source.dna" : "source.vae"; }
function percentile95(values: readonly number[]): number { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0; }
