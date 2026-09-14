import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quadraticFunctionsFixture } from "@aituber/content";
import { FixedResponseLlmProvider } from "@aituber/providers";
import { AfterClassStore, LectureEventStore, QuestionStore } from "@aituber/storage";
import { AfterClassService } from "./after-class-service.ts";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import { QuestionQueueService } from "./question-queue-service.ts";

describe("AfterClassService", () => {
  let events: LectureEventStore; let questionStore: QuestionStore; let afterStore: AfterClassStore;
  let lecture: FixedLectureService; let questions: QuestionQueueService; let service: AfterClassService | null;
  beforeEach(() => { vi.useFakeTimers(); events = new LectureEventStore(":memory:"); questionStore = new QuestionStore(":memory:"); afterStore = new AfterClassStore(":memory:"); lecture = new FixedLectureService({ store: events, courses: [quadraticFunctionsFixture], playbackUnitMs: 100 }); questions = new QuestionQueueService({ store: questionStore, context: (sessionId) => ({ session: lecture.getSession(sessionId), remainingMs: lecture.getRemainingTimeMs(sessionId) }) }); service = null; });
  afterEach(() => { service?.close(); lecture.close(); events.close(); questionStore.close(); afterStore.close(); vi.useRealTimers(); });

  it("generates and independently reviews a deferred answer before publishing it", async () => {
    const { sessionId, questionId } = finishedWithDeferredQuestion(); const provider = new FixedResponseLlmProvider([candidate(), passedReview()]);
    service = new AfterClassService({ store: afterStore, questions, lecture, llm: () => provider }); service.consider(sessionId); await service.drain(sessionId);
    expect(lecture.getSession(sessionId).afterClassAnswers[0]).toMatchObject({ questionId, status: "available", answerText: "頂点は括弧内をゼロにする値から読み取ります。", attempts: 1 });
    expect(questions.list(sessionId)[0]).toMatchObject({ resolution: "answered", reason: "授業後の審査済み回答を公開しました。" });
    expect(provider.calls.map((call) => call.purpose)).toEqual(["post-class-answer", "post-class-answer-review"]);
    expect(provider.calls.every((call) => !call.systemInstruction.includes("browse the web") || call.systemInstruction.includes("never browse the web"))).toBe(true);
  });

  it("keeps the reason and publishes no candidate when two reviews fail", async () => {
    const { sessionId } = finishedWithDeferredQuestion(); const provider = new FixedResponseLlmProvider([candidate(), failedReview(), candidate(), failedReview()]);
    service = new AfterClassService({ store: afterStore, questions, lecture, llm: () => provider }); service.consider(sessionId); await service.drain(sessionId);
    const answer = lecture.getSession(sessionId).afterClassAnswers[0]!; expect(answer).toMatchObject({ status: "unanswered", answerText: null, attempts: 2, failure: expect.stringContaining("2回") });
    expect(afterStore.listAttempts(answer.id)).toHaveLength(2); expect(questions.list(sessionId)[0]?.resolution).toBe("deferred");
  });

  it("answers new questions after the initial after-class queue has drained", async () => {
    const { sessionId } = finishedWithDeferredQuestion();
    const provider = new FixedResponseLlmProvider([candidate(), passedReview(), candidate(), passedReview()]);
    service = new AfterClassService({ store: afterStore, questions, lecture, llm: () => provider });
    service.consider(sessionId); await service.drain(sessionId);
    const later = questions.submit({ sessionId, participantId: "late.viewer", request: { accessToken: "ignored", text: "別の式でも同じですか", sceneId: "scene.math.form", semanticTargetId: "target.math.vertex-form" } });
    await service.drain(sessionId);
    expect(lecture.getSession(sessionId).afterClassAnswers).toHaveLength(2);
    expect(questions.list(sessionId).find(q => q.id === later.question.id)?.resolution).toBe("answered");
    expect(provider.calls).toHaveLength(4);
  });

  it("stores the optional fixed survey apart from learning evidence", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); lecture.command(session.id, { command: "finish" });
    service = new AfterClassService({ store: afterStore, questions, lecture, llm: () => null });
    expect(service.submitSurvey({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", questionHelpfulness: 5, rejoinNaturalness: 4, comment: "自然でした" } })).toMatchObject({ questionHelpfulness: 5, rejoinNaturalness: 4, comment: "自然でした" });
    expect(() => service!.submitSurvey({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", questionHelpfulness: 0, rejoinNaturalness: 4 } })).toThrow("1〜5");
  });

  function finishedWithDeferredQuestion() {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    const submitted = questions.submit({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", text: "なぜ符号を反対に読むのですか", sceneId: "scene.math.form", semanticTargetId: "target.math.h-term" } });
    questions.defer(submitted.question.id, "授業時間内に扱えませんでした。"); lecture.command(session.id, { command: "finish" });
    return { sessionId: session.id, questionId: submitted.question.id };
  }
});

function candidate() { return { answerText: "頂点は括弧内をゼロにする値から読み取ります。", sourceIds: ["source.quadratic"], knowledgeBasis: "course" }; }
function passedReview() { return { gates: ["sources", "content", "safe-content"].map((id) => ({ id, passed: true, rationale: "合格" })), summary: "合格" }; }
function failedReview() { return { gates: ["sources", "content", "safe-content"].map((id) => ({ id, passed: id !== "content", rationale: id === "content" ? "説明不足" : "合格" })), summary: "説明不足" }; }
