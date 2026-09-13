import { describe, expect, it } from "vitest";
import { LearningEvidenceStore } from "./learning-evidence-store.ts";

describe("LearningEvidenceStore", () => {
  it("keeps observed, automatic, final, correction, and supplement linkage separate", () => {
    const store = new LearningEvidenceStore(":memory:");
    const evidence = store.record({ sessionId: "session.one", participantId: "learner.one", kind: "checkpoint-answer", scopeId: "goal.math", assessmentId: "assessment.math", semanticTargetId: null, observedValue: "3", automaticJudgment: "struggle", finalJudgment: "struggle", rationale: "rubric mismatch", correction: null, linkedSupplementId: "supplement.one", recordedAt: "2026-09-14T00:00:00.000Z" });
    expect(evidence).toMatchObject({ observedValue: "3", automaticJudgment: "struggle", finalJudgment: "struggle", correction: null, linkedSupplementId: "supplement.one" });
    expect(store.correct(evidence.id, "confirmed", "表記ゆれを確認")).toMatchObject({ automaticJudgment: "struggle", finalJudgment: "confirmed", correction: "表記ゆれを確認" });
    expect(store.list("session.one")).toHaveLength(1);
    store.close();
  });
});
