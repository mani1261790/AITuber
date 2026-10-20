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

  const advanceToAssessment = () => {
    const assessment = quadraticFunctionsFixture.assessments[0]!;
    const checkpointUnitCount = quadraticFunctionsFixture.schedule.orderedUnitIds.indexOf(assessment.afterUnitId) + 1;
    vi.advanceTimersByTime(checkpointUnitCount * 100);
  };

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

  it("keeps a wrong answer as struggle evidence, supplements it, and records the post-supplement answer as new evidence", async () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); advanceToAssessment();
    const wrong = await pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "(3, -4)" });
    expect(wrong.lastAssessmentEvaluation).toMatchObject({ outcome: "incorrect", linkedSupplementId: null });
    expect(wrong.learningEvidence.find((item) => item.scopeId === "goal.math.calculate")?.state).toBe("struggle-evidence");
    const trigger = questions.list(session.id)[0]!; expect(trigger.origin).toBe("pedagogy-trigger");

    const origin = lecture.captureSupplementOrigin(session.id, trigger.semanticTargetId); const candidate = { speechText: "括弧をゼロにするxを考えます。", captionText: "x + 3 = 0 なら x = -3", sceneId: trigger.sceneId, focusTargetIds: [trigger.semanticTargetId], boardPatches: [], sourceIds: ["source.quadratic"], knowledgeBasis: "course" as const, calculations: [], corrections: [] };
    const view: LiveSupplementView = { id: "supplement.assessment", questionId: trigger.id, status: "preparing", attempt: 1, origin, candidate: null, failure: null, adoptedAt: new Date().toISOString(), firstAudioAt: null };
    lecture.announceSupplement(session.id, view, { interrupt: false, bridgeText: null, bridgeTargetIds: [] });
    lecture.queueSupplement(session.id, { ...view, status: "ready", candidate }, { onPlaybackStarted: () => undefined, onCompleted: () => undefined });
    vi.advanceTimersByTime(100); expect(lecture.getSession(session.id).status).toBe("CHECKPOINT");
    const corrected = await pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "(-3, -4)" });
    expect(corrected.lastAssessmentEvaluation).toMatchObject({ outcome: "correct", linkedSupplementId: "supplement.assessment" });
    expect(corrected.learningEvidence.find((item) => item.scopeId === "goal.math.calculate")?.state).toBe("confirmed-for-item");
    expect(evidence.list(session.id).filter((item) => item.assessmentId === "assessment.math.vertex")).toHaveLength(2);
  });

  it("does not accept a partial numeric token as satisfying a short-answer rubric", async () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); advanceToAssessment();
    expect((await pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "-3" })).lastAssessmentEvaluation?.outcome).toBe("incorrect");
  });

  it("uses semantic evaluation rather than literal matching for a natural answer", async () => {
    const evaluator = vi.fn().mockResolvedValue({ judgment: "confirmed", rationale: "頂点の座標を正しく説明しています。" });
    pedagogy = new PedagogyService({ store: evidence, lecture, questions, evaluator });
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); advanceToAssessment();
    const answer = "頂点は、横方向がマイナス三、縦方向がマイナス四の位置です。";
    const result = await pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer });
    expect(evaluator).toHaveBeenCalledWith(expect.objectContaining({ answer, assessment: expect.objectContaining({ id: "assessment.math.vertex" }) }));
    expect(result.lastAssessmentEvaluation?.outcome).toBe("correct");
  });

  it("does not record a wrong answer or advance on a grading outage, and allows a retry", async () => {
    const evaluator = vi.fn().mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValue({ judgment: "confirmed", rationale: "正しい座標です。" });
    pedagogy = new PedagogyService({ store: evidence, lecture, questions, evaluator });
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); advanceToAssessment();
    const input = { sessionId: session.id, participantId: "learner.one", answer: "(-3, -4)" };
    await expect(pedagogy.answer(input)).rejects.toThrow("provider unavailable");
    expect(lecture.getSession(session.id).status).toBe("CHECKPOINT");
    expect(evidence.list(session.id)).toHaveLength(0);
    expect((await pedagogy.answer(input)).lastAssessmentEvaluation?.outcome).toBe("correct");
  });

  it("rejects concurrent answers and discards grading completed after the session ends", async () => {
    let resolve!: (value: { judgment: "confirmed"; rationale: string }) => void;
    pedagogy = new PedagogyService({ store: evidence, lecture, questions, evaluator: () => new Promise((done) => { resolve = done; }) });
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); advanceToAssessment();
    const input = { sessionId: session.id, participantId: "learner.one", answer: "(-3, -4)" };
    const pending = pedagogy.answer(input);
    await expect(pedagogy.answer(input)).rejects.toThrow("採点中");
    lecture.command(session.id, { command: "finish" });
    resolve({ judgment: "confirmed", rationale: "正しい座標です。" });
    await expect(pending).rejects.toThrow("状態が変わりました");
    expect(evidence.list(session.id)).toHaveLength(0);
    expect(lecture.getSession(session.id).status).toBe("FINISHED");
  });

  it("keeps the same checkpoint available when remedial preparation fails", async () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 }); advanceToAssessment();
    const before = lecture.getSession(session.id);
    await pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "(3, -4)" });
    const trigger = questions.list(session.id)[0]!;
    lecture.deferSupplement(session.id, { id: "supplement.failed", questionId: trigger.id, status: "deferred", attempt: 1, origin: lecture.captureSupplementOrigin(session.id, trigger.semanticTargetId), candidate: null, failure: "provider timeout", adoptedAt: new Date().toISOString(), firstAudioAt: null });
    const after = lecture.getSession(session.id);
    expect(after.status).toBe("CHECKPOINT");
    expect(after.assessment?.id).toBe(before.assessment?.id);
    expect(after.completedUnitIds).toEqual(before.completedUnitIds);
    expect((await pedagogy.answer({ sessionId: session.id, participantId: "learner.one", answer: "(-3, -4)" })).lastAssessmentEvaluation?.outcome).toBe("correct");
  });

  it("reports conflicting observed judgments without inventing a mastery score", () => {
    const session = lecture.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    const base = { sessionId: session.id, participantId: "learner.one", kind: "checkpoint-answer" as const, scopeId: "goal.math.calculate", assessmentId: "assessment.one", semanticTargetId: null, observedValue: "回答", rationale: "fixture", correction: null, linkedSupplementId: null };
    evidence.record({ ...base, automaticJudgment: "confirmed", finalJudgment: "confirmed" }); evidence.record({ ...base, assessmentId: "assessment.two", automaticJudgment: "struggle", finalJudgment: "struggle" });
    const refreshed = pedagogy.submitEvidence({ sessionId: session.id, participantId: "learner.one", request: { accessToken: "ignored", kind: "self-report", value: "understood", sceneId: "scene.math.example", semanticTargetId: "target.math.example-answer" } });
    expect(refreshed.learningEvidence.find((item) => item.scopeId === "goal.math.calculate")).toMatchObject({ state: "conflicting", evidenceCount: 3 });
  });
});
