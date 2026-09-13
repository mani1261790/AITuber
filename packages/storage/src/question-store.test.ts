import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionStore } from "./question-store.ts";

let directory: string; let databasePath: string; let store: QuestionStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "aituber-questions-")); databasePath = join(directory, "questions.db"); store = new QuestionStore(databasePath); });
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

describe("QuestionStore", () => {
  it("persists the frozen question context and counts distinct supporters", () => {
    const created = store.create({ sessionId: "session.one", participantId: "learner.one", coursePackageId: "course.math", coursePackageVersion: 3, sceneId: "scene.form", semanticTargetId: "target.h", lastCompletedUnitId: "unit.intro", text: "なぜ符号が反対ですか", normalizedIntent: "なぜ符号が反対ですか", submittedAt: "2026-09-14T00:00:00.000Z" });
    store.support(created.id, "learner.one", "もう一度", "2026-09-14T00:00:01.000Z");
    store.support(created.id, "learner.two", "私も知りたい", "2026-09-14T00:00:02.000Z");
    const stored = store.get(created.id);
    expect(stored).toMatchObject({ coursePackageId: "course.math", coursePackageVersion: 3, sceneId: "scene.form", semanticTargetId: "target.h", lastCompletedUnitId: "unit.intro", supporterCount: 2, resolution: "pending" });
    expect(stored.participantIds).toEqual(expect.arrayContaining(["learner.one", "learner.two"]));
  });

  it("keeps classifications after reopening the database", () => {
    const created = store.create({ sessionId: "session.one", participantId: "learner.one", coursePackageId: "course.math", coursePackageVersion: 1, sceneId: "scene.form", semanticTargetId: "target.h", lastCompletedUnitId: null, text: "質問", normalizedIntent: "質問", submittedAt: "2026-09-14T00:00:00.000Z" });
    store.updateClassifications([{ id: created.id, disposition: "after-class", reason: "残り時間が少ない", priority: { score: 12, currentGoalRelated: false, prerequisiteForNext: false, supporterCount: 1, waitedMs: 500, remainingMs: 10_000 }, updatedAt: "2026-09-14T00:00:01.000Z" }]);
    store.close(); store = new QuestionStore(databasePath);
    expect(store.get(created.id)).toMatchObject({ disposition: "after-class", reason: "残り時間が少ない", priority: { score: 12, remainingMs: 10_000 } });
  });

  it("separates processing status from answered and deferred outcomes", () => {
    const answering = store.create({ sessionId: "session.one", participantId: "learner.one", coursePackageId: "course.math", coursePackageVersion: 1, sceneId: "scene.form", semanticTargetId: "target.h", lastCompletedUnitId: null, text: "質問", normalizedIntent: "質問", submittedAt: "2026-09-14T00:00:00.000Z" });
    expect(store.updateProcessing(answering.id, "answering")).toMatchObject({ status: "answering", resolution: "pending" });
    expect(store.resolve(answering.id, "deferred", "20秒超過")).toMatchObject({ status: "accepted", resolution: "deferred", disposition: "after-class", reason: "20秒超過" });
    expect(store.listOpen("session.one")).toEqual([]);
  });
});
