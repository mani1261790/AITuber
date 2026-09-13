import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AfterClassStore } from "./after-class-store.ts";
import { DataRetentionStore } from "./data-retention-store.ts";
import { LearningEvidenceStore } from "./learning-evidence-store.ts";
import { LectureEventStore } from "./lecture-event-store.ts";
import { LiveSupplementStore } from "./live-supplement-store.ts";
import { QuestionStore } from "./question-store.ts";
import { ResourceBudgetStore } from "./resource-budget-store.ts";

describe("DataRetentionStore", () => {
  it("deletes seven-day-old session raw data and keeps newer session data", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aituber-retention-")), "data.db");
    const lecture = new LectureEventStore(path); const questions = new QuestionStore(path); const supplements = new LiveSupplementStore(path);
    const evidence = new LearningEvidenceStore(path); const afterClass = new AfterClassStore(path); const budget = new ResourceBudgetStore(path, { runtime: 1 });
    const retention = new DataRetentionStore(path);
    seed("session.old", "2026-09-01T00:00:00.000Z"); seed("session.fresh", "2026-09-13T00:00:00.000Z"); seed("session.recent-survey", "2026-09-01T00:00:00.000Z");
    afterClass.submitSurvey({ sessionId: "session.recent-survey", participantId: "learner.session.recent-survey", questionHelpfulness: 5, rejoinNaturalness: 5, comment: "recent", submittedAt: "2026-09-13T00:00:00.000Z" });
    budget.reserve({ scope: "runtime", resource: "llm", maximumUnits: 1, maximumCostUsd: 0, requestedAt: "2026-09-01T00:00:00.000Z" }).commit();
    const result = retention.purgeBefore("2026-09-07T00:00:00.000Z");
    expect(result).toMatchObject({ sessions: 1, questions: 1, evidence: 1, supplements: 1, afterClassAnswers: 1, surveys: 1, usageReservations: 1 });
    expect(() => lecture.getSession("session.old")).toThrow(); expect(lecture.getSession("session.fresh").id).toBe("session.fresh");
    expect(lecture.getSession("session.recent-survey").id).toBe("session.recent-survey");
    expect(questions.list("session.old")).toEqual([]); expect(questions.list("session.fresh")).toHaveLength(1);
    retention.close(); budget.close(); afterClass.close(); evidence.close(); supplements.close(); questions.close(); lecture.close();

    function seed(sessionId: string, timestamp: string) {
      lecture.createSession({ id: sessionId, coursePackageId: "course.test", coursePackageVersion: 1, createdAt: timestamp });
      const question = questions.create({ sessionId, participantId: `learner.${sessionId}`, coursePackageId: "course.test", coursePackageVersion: 1, sceneId: "scene.test", semanticTargetId: "target.test", lastCompletedUnitId: null, text: "質問", normalizedIntent: "質問", submittedAt: timestamp });
      const supplement = supplements.create({ sessionId, questionId: question.id, origin: { lastCompletedUnitId: null, unfinishedUnitIds: [], nextUnitId: null, displayUnitId: null, questionTargetId: "target.test", remainingMs: 1 }, adoptedAt: timestamp });
      supplements.recordAttempt({ supplementId: supplement.id, attempt: 1, candidate: null, review: null, failure: "fixture", createdAt: timestamp });
      evidence.record({ sessionId, participantId: `learner.${sessionId}`, kind: "learner-question", scopeId: "goal.test", assessmentId: null, semanticTargetId: "target.test", observedValue: "質問", automaticJudgment: "support", finalJudgment: "support", rationale: "fixture", correction: null, linkedSupplementId: supplement.id, recordedAt: timestamp });
      const answer = afterClass.begin({ sessionId, questionId: question.id, questionText: "質問", createdAt: timestamp }); afterClass.recordAttempt({ answerId: answer.id, attempt: 1, candidate: null, review: null, failure: "fixture", createdAt: timestamp });
      afterClass.submitSurvey({ sessionId, participantId: `learner.${sessionId}`, questionHelpfulness: 3, rejoinNaturalness: 4, comment: "fixture", submittedAt: timestamp });
    }
  });
});
