import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quadraticFunctionsFixture } from "@aituber/content";
import { LectureEventStore } from "@aituber/storage";
import { FixedLectureService } from "./fixed-lecture-service.ts";

describe("FixedLectureService", () => {
  let store: LectureEventStore;
  let service: FixedLectureService;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new LectureEventStore(":memory:");
    service = new FixedLectureService({ store, courses: [quadraticFunctionsFixture], playbackUnitMs: 100 });
  });

  afterEach(() => {
    service.close();
    store.close();
    vi.useRealTimers();
  });

  it("runs teaching units automatically, waits for the checkpoint, and completes after an answer", () => {
    const started = service.createSession({
      coursePackageId: quadraticFunctionsFixture.id,
      durationMinutes: quadraticFunctionsFixture.durationMinutes,
    });
    expect(started.status).toBe("TEACHING");
    expect(started.testAudio.playing).toBe(true);
    vi.advanceTimersByTime(500);

    const checkpoint = service.getSession(started.id);
    expect(checkpoint.status).toBe("CHECKPOINT");
    expect(checkpoint.progress).toEqual({ completed: 5, total: 6 });
    expect(checkpoint.assessment?.id).toBe("assessment.math.vertex");

    service.command(started.id, { command: "answer", answer: "(-3, -4)" });
    vi.advanceTimersByTime(100);

    const finished = service.getSession(started.id);
    expect(finished.status).toBe("FINISHED");
    expect(finished.completedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds);
    expect(finished.unfinishedUnitIds).toEqual([]);
    expect(store.loadEvents(started.id).some((event) => event.type === "assessment.answer-recorded")).toBe(true);
  });

  it("keeps the current unit unfinished while paused and resumes it in a new epoch", () => {
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    const paused = service.command(started.id, { command: "pause" });
    expect(paused.status).toBe("PAUSED");
    expect(paused.epoch).toBe(2);
    vi.advanceTimersByTime(1_000);
    expect(service.getSession(started.id).progress.completed).toBe(0);

    const resumed = service.command(started.id, { command: "resume" });
    expect(resumed.status).toBe("TEACHING");
    vi.advanceTimersByTime(100);
    expect(service.getSession(started.id).progress.completed).toBe(1);
    expect(store.loadEvents(started.id).map((event) => event.epoch)).toContain(2);
  });

  it("reports completed and unfinished units when an operator ends early", () => {
    const started = service.createSession({ coursePackageId: quadraticFunctionsFixture.id, durationMinutes: 6 });
    vi.advanceTimersByTime(200);
    const finished = service.command(started.id, { command: "finish" });
    expect(finished.status).toBe("FINISHED");
    expect(finished.completedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds.slice(0, 2));
    expect(finished.unfinishedUnitIds).toEqual(quadraticFunctionsFixture.schedule.orderedUnitIds.slice(2));
  });
});
