import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quadraticFunctionsFixture } from "@aituber/content";
import type { LiveSupplementView } from "@aituber/contracts";
import { LearningEvidenceStore, LectureEventStore, QuestionStore } from "@aituber/storage";
import { FixedLectureService } from "./fixed-lecture-service.ts";
import { PedagogyService } from "./pedagogy-service.ts";
import { QuestionQueueService } from "./question-queue-service.ts";

describe("PedagogyService", () => {
  let events: LectureEventStore; let evidence: LearningEvidenceStore; let questionStore: QuestionStore;
  let lecture: FixedLectureService; let questions: QuestionQueueService; let pedagogy: PedagogyService;

  beforeEach(() => {
    vi.useFakeTimers(); events = new LectureEventStore(":memory:"); evidence = new LearningEvidenceStore(":memory:"); questionStore = new QuestionStore(":memory:");
    lecture = new FixedLectureService({ store: events, courses: [quadraticFunctionsFixture], playbackUnitMs: 100 });
    questions = new QuestionQueueService({ store: questionStore, context: (sessionId) => ({ session: lecture.getSession(sessionId), remainingMs: lecture.getRemainingTimeMs(sessionId) }) });
    pedagogy = new PedagogyService({ store: evidence, lecture, questions });
  });
  afterEach(() => { lecture.close(); events.close(); evidence.close(); questionStore.close(); vi.useRealTimers(); });

  it("does not turn viewing, target selection, or an understood self-report into confirmed understanding", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    expect(session.learningEvidence.every((item) => item.state === "unconfirmed" && item.evidenceCount === 0)).toBe(true);
    pedagogy.submitEvidence({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", kind: "explicit-action", value: "target-selected", sceneId: "scene.math.form", semanticTargetId: "target.math.vertex-form" } });
    const afterReport = pedagogy.submitEvidence({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", kind: "self-report", value: "understood", sceneId: "scene.math.form", semanticTargetId: "target.math.vertex-form" } });
    expect(afterReport.learningEvidence[0]).toMatchObject({ state: "unconfirmed", evidenceCount: 2 });
  });

  it("records questions and help requests as support evidence and creates an automatic intervention", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    pedagogy.recordQuestion({ sessionId: session.id, participantId: "learner.one", semanticTargetId: "target.math.vertex-form", text: "ここが分かりません", submittedAt: "2026-09-14T00:00:00.000Z" });
    const updated = pedagogy.submitEvidence({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", kind: "self-report", value: "need-help", sceneId: "scene.math.form", semanticTargetId: "target.math.vertex-form" } });
    expect(updated.learningEvidence[0]).toMatchObject({ state: "support-requested", evidenceCount: 2 });
    expect(questions.list(session.id)[0]).toMatchObject({ origin: "pedagogy-trigger", resolution: "pending" });
  });

  it("keeps a wrong answer as struggle evidence, supplements it, and records the post-supplement answer as new evidence", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); vi.advanceTimersByTime(500);
    const wrong = pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "(3, -4)" });
    expect(wrong.lastAssessmentEvaluation).toMatchObject({ outcome: "incorrect", linkedSupplementId: null });
    expect(wrong.learningEvidence.find((item) => item.scopeId === "goal.math.calculate")?.state).toBe("struggle-evidence");
    const trigger = questions.list(session.id)[0]!; expect(trigger.origin).toBe("pedagogy-trigger");

    const origin = lecture.captureSupplementOrigin(session.id, trigger.semanticTargetId); const candidate = { speechText: "括弧をゼロにするxを考えます。", captionText: "x + 3 = 0 なら x = -3", sceneId: trigger.sceneId, focusTargetIds: [trigger.semanticTargetId], boardPatches: [], sourceIds: ["source.quadratic"], knowledgeBasis: "course" as const, calculations: [], corrections: [] };
    const view: LiveSupplementView = { id: "supplement.assessment", questionId: trigger.id, status: "preparing", attempt: 1, origin, candidate: null, failure: null, adoptedAt: new Date().toISOString(), firstAudioAt: null };
    lecture.announceSupplement(session.id, view, { interrupt: false, bridgeText: null, bridgeTargetIds: [] });
    lecture.queueSupplement(session.id, { ...view, status: "ready", candidate }, { onPlaybackStarted: () => undefined, onCompleted: () => undefined });
    vi.advanceTimersByTime(100); expect(lecture.getSession(session.id).status).toBe("CHECKPOINT");
    const corrected = pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "(-3, -4)" });
    expect(corrected.lastAssessmentEvaluation).toMatchObject({ outcome: "correct", linkedSupplementId: "supplement.assessment" });
    expect(corrected.learningEvidence.find((item) => item.scopeId === "goal.math.calculate")?.state).toBe("confirmed-for-item");
    expect(evidence.list(session.id).filter((item) => item.assessmentId === "assessment.math.vertex")).toHaveLength(2);
  });

  it("does not accept a partial numeric token as satisfying a short-answer rubric", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); vi.advanceTimersByTime(500);
    expect(pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "-3" }).lastAssessmentEvaluation?.outcome).toBe("incorrect");
  });

  it("reports conflicting observed judgments without inventing a mastery score", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    const base = { sessionId: session.id, participantId: "learner.one", kind: "checkpoint-answer" as const, scopeId: "goal.math.calculate", assessmentId: "assessment.one", semanticTargetId: null, observedValue: "回答", rationale: "fixture", correction: null, linkedSupplementId: null };
    evidence.record({ ...base, automaticJudgment: "confirmed", finalJudgment: "confirmed" }); evidence.record({ ...base, assessmentId: "assessment.two", automaticJudgment: "struggle", finalJudgment: "struggle" });
    const refreshed = pedagogy.submitEvidence({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", kind: "self-report", value: "understood", sceneId: "scene.math.example", semanticTargetId: "target.math.example-answer" } });
    expect(refreshed.learningEvidence.find((item) => item.scopeId === "goal.math.calculate")).toMatchObject({ state: "conflicting", evidenceCount: 3 });
  });
});
