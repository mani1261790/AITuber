import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveSupplementStore, type StoredSupplementCandidate } from "./live-supplement-store.ts";

let store: LiveSupplementStore;
beforeEach(() => { store = new LiveSupplementStore(":memory:"); });
afterEach(() => store.close());

describe("LiveSupplementStore", () => {
  it("persists the frozen branch origin, every review attempt, and the final outcome", () => {
    const created = store.create({ sessionId: "session.one", questionId: "question.one", adoptedAt: "2026-09-14T00:00:00.000Z", origin: { lastCompletedUnitId: "unit.one", unfinishedUnitIds: ["unit.two", "unit.three"], nextUnitId: "unit.two", displayUnitId: "unit.two", questionTargetId: "target.form", remainingMs: 120_000 } });
    const candidate = sampleCandidate();
    store.recordAttempt({ supplementId: created.id, attempt: 1, candidate, review: { passed: false, summary: "calculation failed", gates: [{ id: "calculations", passed: false, rationale: "2 + 2 is not 5" }] }, failure: "calculation failed", createdAt: "2026-09-14T00:00:01.000Z" });
    store.recordAttempt({ supplementId: created.id, attempt: 2, candidate: { ...candidate, calculations: [{ operator: "add", left: 2, right: 2, result: 4 }] }, review: { passed: true, summary: "passed", gates: [] }, failure: null, createdAt: "2026-09-14T00:00:02.000Z" });
    store.update({ id: created.id, status: "completed", firstAudioAt: "2026-09-14T00:00:03.000Z" });

    expect(store.get(created.id)).toMatchObject({ status: "completed", attempt: 2, origin: { unfinishedUnitIds: ["unit.two", "unit.three"] }, firstAudioAt: "2026-09-14T00:00:03.000Z" });
    expect(store.listAttempts(created.id)).toHaveLength(2);
    expect(store.listAttempts(created.id)[0]).toMatchObject({ attempt: 1, failure: "calculation failed", review: { passed: false } });
  });
});

function sampleCandidate(): StoredSupplementCandidate { return { speechText: "補足です。", captionText: "補足", sceneId: "scene.form", focusTargetIds: ["target.form"], boardPatches: [], sourceIds: ["source.one"], knowledgeBasis: "course", calculations: [{ operator: "add", left: 2, right: 2, result: 5 }], corrections: [] }; }
