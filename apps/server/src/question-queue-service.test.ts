import { describe, expect, it } from "vitest";
import { quadraticFunctionsFixture } from "@aituber/content";
import type { FixedSessionView } from "@aituber/contracts";
import { QuestionStore } from "@aituber/storage";
import { normalizeIntent, QuestionQueueService, sameIntent } from "./question-queue-service.ts";

describe("question intent", () => {
  it("normalizes equivalent Japanese question phrasing", () => {
    expect(normalizeIntent(" 符号について説明してください！ ")).toBe("符号");
    expect(sameIntent(normalizeIntent("括弧の符号が反対なのはなぜ？"), normalizeIntent("括弧の符号が反対なのはなぜですか"))).toBe(true);
    expect(sameIntent("平方完成", "dna複製")).toBe(false);
  });
});

describe("QuestionQueueService", () => {
  it("freezes context, merges the same intent, and classifies multiple questions from all priority signals", () => {
    const { service, store } = setup(180_000);
    const first = service.submit(input("learner.one", "target.math.h-term", "scene.math.form", "括弧の符号が反対なのはなぜ？", "2026-09-14T00:00:00.000Z"));
    const merged = service.submit(input("learner.two", "target.math.h-term", "scene.math.form", "括弧の符号が反対なのはなぜですか", "2026-09-14T00:01:00.000Z"));
    expect(merged.question.id).toBe(first.question.id);
    expect(merged.question.supporterCount).toBe(2);
    const classified = service.submit(input("learner.three", "target.math.vertex-form", "scene.math.form", "頂点形式を先に確認したい", "2026-09-14T00:05:00.000Z"));
    expect(classified.questions).toHaveLength(2);
    expect(classified.questions[0]).toMatchObject({ semanticTargetId: "target.math.vertex-form", coursePackageId: quadraticFunctionsFixture.id, coursePackageVersion: quadraticFunctionsFixture.version, sceneId: "scene.math.form", lastCompletedUnitId: "unit.math.intro", disposition: "answer-now", priority: { currentGoalRelated: true, prerequisiteForNext: true, remainingMs: 180_000 } });
    expect(classified.questions[1]).toMatchObject({ semanticTargetId: "target.math.h-term", disposition: "after-class", supporterCount: 2, priority: { currentGoalRelated: true, prerequisiteForNext: false, waitedMs: 300_000 } });
    expect(classified.questions[1]?.reason).toContain("優先度");
    store.close();
  });

  it("defers every question when less than twenty seconds remain", () => {
    const { service, store } = setup(19_999);
    const result = service.submit(input("learner.one", "target.math.h-term", "scene.math.form", "符号を説明して", "2026-09-14T00:00:00.000Z"));
    expect(result.question.disposition).toBe("after-class");
    expect(result.question.reason).toContain("残り時間");
    store.close();
  });

  it("rejects missing semantic targets and acknowledges 100 questions within the one-second target", () => {
    const { service, store } = setup(180_000);
    expect(() => service.submit(input("learner.one", "target.missing", "scene.math.form", "質問", "2026-09-14T00:00:00.000Z"))).toThrow("存在しません");
    const durations: number[] = [];
    for (let index = 0; index < 100; index += 1) { const started = performance.now(); service.submit(input(`learner.${index}`, "target.math.h-term", "scene.math.form", `符号の意味 ${index}`, new Date(index * 1_000).toISOString())); durations.push(performance.now() - started); }
    durations.sort((left, right) => left - right); const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(p95).toBeLessThan(1_000);
    store.close();
  });
});

function setup(remainingMs: number) {
  const store = new QuestionStore(":memory:");
  const session = sessionView(); const service = new QuestionQueueService({ store, context: () => ({ session, remainingMs }) });
  return { store, service };
}
function input(participantId: string, semanticTargetId: string, sceneId: string, text: string, submittedAt: string) { return { sessionId: "session.questions", participantId, submittedAt, request: { accessToken: "ignored-at-domain-boundary", text, sceneId, semanticTargetId } }; }
function sessionView(): FixedSessionView { return { id: "session.questions", course: quadraticFunctionsFixture, configuredDurationMinutes: 6, status: "TEACHING", epoch: 1, completedUnitIds: ["unit.math.intro"], unfinishedUnitIds: quadraticFunctionsFixture.schedule.orderedUnitIds.slice(1), currentUnitId: "unit.math.parts", displayUnitId: "unit.math.parts", progress: { completed: 1, total: quadraticFunctionsFixture.schedule.orderedUnitIds.length }, assessment: null, speech: { mode: "test", playing: false, epoch: 1, unitId: null, text: null, startedAt: null, durationMs: 0, audioUrl: null, segments: [], failure: null, provider: null, model: null, voiceId: null, firstAudioMs: null, synthesisMs: null } }; }
