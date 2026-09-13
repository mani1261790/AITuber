import { describe, expect, it } from "vitest";
import {
  createLessonState,
  InvalidLessonTransitionError,
  pendingProviderActions,
  replayLesson,
  transitionLesson,
  type LessonEvent,
} from "./lesson-machine.ts";

const initial = () => createLessonState({ sessionId: "session.test", orderedUnitIds: ["unit.one", "unit.two"] });

describe("lesson state machine", () => {
  it("visits the required teaching, assessment, branch, and rejoin states", () => {
    const events: LessonEvent[] = [
      { type: "PREPARE_REQUESTED", epoch: 1 },
      { type: "PREPARATION_COMPLETED", epoch: 1 },
      { type: "CHECKPOINT_PRESENTED", epoch: 1 },
      { type: "ANSWER_RECEIVED", epoch: 1 },
      { type: "BRANCH_SELECTED", epoch: 1, supplementRequired: true },
      { type: "SUPPLEMENT_COMPLETED", epoch: 1 },
      { type: "REJOIN_VERIFIED", epoch: 1 },
    ];
    expect(replayLesson(initial(), events)).toMatchObject({ status: "TEACHING", activeUnitId: "unit.one" });
  });

  it("does not complete a presented unit until audio completion", () => {
    let state = replayLesson(initial(), [
      { type: "PREPARE_REQUESTED", epoch: 1 },
      { type: "PREPARATION_COMPLETED", epoch: 1 },
      { type: "UNIT_PRESENTED", epoch: 1, unitId: "unit.one" },
    ]);
    expect(state.completedUnitIds).toEqual([]);
    state = transitionLesson(state, { type: "UNIT_AUDIO_COMPLETED", epoch: 1, unitId: "unit.one" }).state;
    expect(state).toMatchObject({ completedUnitIds: ["unit.one"], activeUnitId: "unit.two", presentedUnitId: null });
  });

  it("increments epoch on pause and ignores stale async results", () => {
    const state = replayLesson(initial(), [
      { type: "PREPARE_REQUESTED", epoch: 1 },
      { type: "PREPARATION_COMPLETED", epoch: 1 },
      { type: "UNIT_PRESENTED", epoch: 1, unitId: "unit.one" },
      { type: "PAUSE_REQUESTED", epoch: 1 },
    ]);
    expect(state).toMatchObject({ status: "PAUSED", epoch: 2, presentedUnitId: null });
    const stale = transitionLesson(state, { type: "UNIT_AUDIO_COMPLETED", epoch: 1, unitId: "unit.one" });
    expect(stale).toEqual({ state, ignored: true, reason: "stale_epoch" });
    expect(stale.state.completedUnitIds).toEqual([]);
  });

  it("recovers to the interrupted state and preserves the unfinished unit", () => {
    const state = replayLesson(initial(), [
      { type: "PREPARE_REQUESTED", epoch: 1 },
      { type: "PREPARATION_COMPLETED", epoch: 1 },
      { type: "FAULT_DETECTED", epoch: 1, reason: "network" },
      { type: "RECOVERY_STARTED", epoch: 2 },
      { type: "RECOVERY_COMPLETED", epoch: 2 },
    ]);
    expect(state).toMatchObject({ status: "TEACHING", epoch: 2, activeUnitId: "unit.one", completedUnitIds: [] });
  });

  it("is deterministic for a fixed event sequence", () => {
    const events: LessonEvent[] = [
      { type: "PREPARE_REQUESTED", epoch: 1 },
      { type: "PREPARATION_COMPLETED", epoch: 1 },
      { type: "UNIT_PRESENTED", epoch: 1, unitId: "unit.one" },
      { type: "UNIT_AUDIO_COMPLETED", epoch: 1, unitId: "unit.one" },
      { type: "FINISH_REQUESTED", epoch: 1 },
    ];
    expect(replayLesson(initial(), events)).toEqual(replayLesson(initial(), events));
  });

  it("emits no provider work while idle, paused, or finished", () => {
    expect(pendingProviderActions(initial())).toEqual([]);
    const preparing = transitionLesson(initial(), { type: "PREPARE_REQUESTED", epoch: 1 }).state;
    expect(pendingProviderActions(preparing)).toEqual(["prepare-course"]);
    const paused = transitionLesson(preparing, { type: "PAUSE_REQUESTED", epoch: 1 }).state;
    expect(pendingProviderActions(paused)).toEqual([]);
    const finished = transitionLesson(paused, { type: "FINISH_REQUESTED", epoch: 2 }).state;
    expect(pendingProviderActions(finished)).toEqual([]);
  });

  it("rejects impossible transitions and future epochs", () => {
    expect(() => transitionLesson(initial(), { type: "ANSWER_RECEIVED", epoch: 1 })).toThrow(InvalidLessonTransitionError);
    expect(() => transitionLesson(initial(), { type: "PREPARE_REQUESTED", epoch: 2 })).toThrow(InvalidLessonTransitionError);
  });
});
