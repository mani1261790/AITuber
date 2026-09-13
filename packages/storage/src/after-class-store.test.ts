import { describe, expect, it } from "vitest";
import { AfterClassStore } from "./after-class-store.ts";

describe("AfterClassStore", () => {
  it("publishes only a finished answer and retains every failed attempt", () => {
    const store = new AfterClassStore(":memory:"); const answer = store.begin({ sessionId: "session.one", questionId: "question.one", questionText: "なぜですか", createdAt: "2026-09-14T00:00:00.000Z" });
    store.recordAttempt({ answerId: answer.id, attempt: 1, candidate: { answerText: "候補" }, review: { passed: false }, failure: "根拠不足" });
    expect(store.finish({ id: answer.id, status: "unanswered", failure: "2回不合格" })).toMatchObject({ status: "unanswered", answerText: null, attempts: 1, failure: "2回不合格" });
    expect(store.listAttempts(answer.id)).toHaveLength(1); store.close();
  });
  it("keeps the optional survey separate and replaces a participant's resubmission", () => {
    const store = new AfterClassStore(":memory:"); store.submitSurvey({ sessionId: "session.one", participantId: "learner.one", questionHelpfulness: 4, rejoinNaturalness: 3, comment: "最初" });
    store.submitSurvey({ sessionId: "session.one", participantId: "learner.one", questionHelpfulness: 5, rejoinNaturalness: 4, comment: "更新" });
    expect(store.getSurvey("session.one", "learner.one")).toMatchObject({ questionHelpfulness: 5, rejoinNaturalness: 4, comment: "更新" }); store.close();
  });
});
