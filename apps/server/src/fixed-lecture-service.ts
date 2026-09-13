import { randomUUID } from "node:crypto";
import type {
  CourseSummary,
  CreateSessionRequest,
  FixedSessionView,
  ReadonlyCoursePackage,
  SessionCommandRequest,
} from "@aituber/contracts";
import { coursePackageFixtures } from "@aituber/content";
import {
  createLessonState,
  transitionLesson,
  type LessonEvent,
  type LessonState,
} from "@aituber/lesson";
import { LectureEventStore } from "@aituber/storage";

interface RuntimeSession {
  readonly id: string;
  readonly course: ReadonlyCoursePackage;
  readonly configuredDurationMinutes: number;
  state: LessonState;
  displayUnitId: string | null;
  assessmentId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class FixedLectureService {
  readonly #courses: ReadonlyMap<string, ReadonlyCoursePackage>;
  readonly #sessions = new Map<string, RuntimeSession>();
  readonly #store: LectureEventStore;
  readonly #playbackUnitMs: number;
  #currentSessionId: string | null = null;

  constructor(options: {
    store: LectureEventStore;
    courses?: readonly ReadonlyCoursePackage[];
    playbackUnitMs?: number;
  }) {
    this.#store = options.store;
    this.#courses = new Map((options.courses ?? coursePackageFixtures).map((course) => [course.id, course]));
    this.#playbackUnitMs = options.playbackUnitMs ?? 2_000;
  }

  listCourses(): readonly CourseSummary[] {
    return [...this.#courses.values()].map((course) => ({
      id: course.id,
      title: course.title,
      targetLevel: course.targetLevel,
      durationMinutes: course.durationMinutes,
      learningGoals: course.learningGoals,
    }));
  }

  createSession(request: CreateSessionRequest): FixedSessionView {
    const course = this.#courses.get(request.coursePackageId);
    if (!course) throw new RangeError(`Unknown Course Package ${request.coursePackageId}`);
    if (!Number.isInteger(request.durationMinutes) || request.durationMinutes < 1 || request.durationMinutes > 480) {
      throw new TypeError("durationMinutes must be an integer between 1 and 480");
    }

    if (this.#currentSessionId) {
      const previous = this.#sessions.get(this.#currentSessionId);
      if (previous && previous.state.status !== "FINISHED") this.command(previous.id, { command: "finish" });
    }

    const id = `session.${randomUUID()}`;
    this.#store.createSession({ id, coursePackageId: course.id, coursePackageVersion: course.version });
    const runtime: RuntimeSession = {
      id,
      course,
      configuredDurationMinutes: request.durationMinutes,
      state: createLessonState({ sessionId: id, orderedUnitIds: course.schedule.orderedUnitIds }),
      displayUnitId: null,
      assessmentId: null,
      timer: null,
    };
    this.#sessions.set(id, runtime);
    this.#currentSessionId = id;
    this.#apply(runtime, { type: "PREPARE_REQUESTED", epoch: runtime.state.epoch });
    this.#apply(runtime, { type: "PREPARATION_COMPLETED", epoch: runtime.state.epoch });
    this.#schedule(runtime);
    return this.getSession(id);
  }

  getCurrentSession(): FixedSessionView | null {
    return this.#currentSessionId ? this.getSession(this.#currentSessionId) : null;
  }

  getSession(sessionId: string): FixedSessionView {
    const runtime = this.#requireSession(sessionId);
    const unfinishedUnitIds = runtime.state.orderedUnitIds.filter((id) => !runtime.state.completedUnitIds.includes(id));
    const assessment = runtime.assessmentId
      ? runtime.course.assessments.find((item) => item.id === runtime.assessmentId) ?? null
      : null;
    return {
      id: runtime.id,
      course: runtime.course,
      configuredDurationMinutes: runtime.configuredDurationMinutes,
      status: visibleStatus(runtime.state.status),
      epoch: runtime.state.epoch,
      completedUnitIds: runtime.state.completedUnitIds,
      unfinishedUnitIds,
      currentUnitId: runtime.state.activeUnitId,
      displayUnitId: runtime.displayUnitId,
      progress: { completed: runtime.state.completedUnitIds.length, total: runtime.state.orderedUnitIds.length },
      assessment,
      testAudio: { playing: runtime.state.presentedUnitId !== null, durationMs: this.#playbackUnitMs },
    };
  }

  command(sessionId: string, request: SessionCommandRequest): FixedSessionView {
    const runtime = this.#requireSession(sessionId);
    if (request.command === "pause") {
      this.#clearTimer(runtime);
      const previousEpoch = runtime.state.epoch;
      this.#apply(runtime, { type: "PAUSE_REQUESTED", epoch: previousEpoch });
      this.#store.advanceEpoch(runtime.id);
    } else if (request.command === "resume") {
      this.#apply(runtime, { type: "RECOVERY_STARTED", epoch: runtime.state.epoch });
      this.#apply(runtime, { type: "RECOVERY_COMPLETED", epoch: runtime.state.epoch });
      this.#schedule(runtime);
    } else if (request.command === "finish") {
      this.#clearTimer(runtime);
      this.#apply(runtime, { type: "FINISH_REQUESTED", epoch: runtime.state.epoch });
    } else if (request.command === "answer") {
      if (runtime.state.status !== "CHECKPOINT" || !runtime.assessmentId) {
        throw new TypeError("The session is not waiting for an answer");
      }
      if (!request.answer?.trim()) throw new TypeError("answer is required");
      this.#apply(runtime, { type: "ANSWER_RECEIVED", epoch: runtime.state.epoch });
      this.#recordAnswer(runtime, request.answer.trim());
      this.#apply(runtime, { type: "BRANCH_SELECTED", epoch: runtime.state.epoch, supplementRequired: false });
      runtime.assessmentId = null;
      this.#schedule(runtime);
    }
    return this.getSession(sessionId);
  }

  close() {
    this.#sessions.forEach((runtime) => this.#clearTimer(runtime));
  }

  #schedule(runtime: RuntimeSession) {
    if (runtime.state.status !== "TEACHING") return;
    const unitId = runtime.state.activeUnitId;
    if (!unitId) {
      this.#apply(runtime, { type: "FINISH_REQUESTED", epoch: runtime.state.epoch });
      return;
    }
    runtime.displayUnitId = unitId;
    this.#apply(runtime, { type: "UNIT_PRESENTED", epoch: runtime.state.epoch, unitId });
    runtime.timer = setTimeout(() => this.#completeUnit(runtime.id, unitId, runtime.state.epoch), this.#playbackUnitMs);
  }

  #completeUnit(sessionId: string, unitId: string, epoch: number) {
    const runtime = this.#requireSession(sessionId);
    runtime.timer = null;
    if (runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING") return;
    this.#apply(runtime, { type: "UNIT_AUDIO_COMPLETED", epoch, unitId });
    const assessment = runtime.course.assessments.find((item) => item.afterUnitId === unitId);
    if (assessment) {
      runtime.assessmentId = assessment.id;
      this.#apply(runtime, { type: "CHECKPOINT_PRESENTED", epoch: runtime.state.epoch });
      return;
    }
    this.#schedule(runtime);
  }

  #apply(runtime: RuntimeSession, event: LessonEvent) {
    const nextState = transitionLesson(runtime.state, event).state;
    const stored = this.#store.getSession(runtime.id);
    this.#store.appendEvent({
      eventId: `event.${randomUUID()}`,
      sessionId: runtime.id,
      coursePackageId: runtime.course.id,
      coursePackageVersion: runtime.course.version,
      epoch: stored.epoch,
      seq: stored.lastSeq + 1,
      occurredAt: new Date().toISOString(),
      type: `lesson.${event.type.toLowerCase()}`,
      payload: event,
    });
    runtime.state = nextState;
  }

  #recordAnswer(runtime: RuntimeSession, answer: string) {
    const stored = this.#store.getSession(runtime.id);
    this.#store.appendEvent({
      eventId: `event.${randomUUID()}`,
      sessionId: runtime.id,
      coursePackageId: runtime.course.id,
      coursePackageVersion: runtime.course.version,
      epoch: stored.epoch,
      seq: stored.lastSeq + 1,
      occurredAt: new Date().toISOString(),
      type: "assessment.answer-recorded",
      payload: { assessmentId: runtime.assessmentId, answer },
    });
  }

  #clearTimer(runtime: RuntimeSession) {
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = null;
  }

  #requireSession(sessionId: string): RuntimeSession {
    const runtime = this.#sessions.get(sessionId);
    if (!runtime) throw new RangeError(`Unknown session ${sessionId}`);
    return runtime;
  }
}

function visibleStatus(status: LessonState["status"]): FixedSessionView["status"] {
  if (status === "ASSESSING" || status === "BRANCHING" || status === "REJOINING") return "TEACHING";
  if (status === "IDLE") return "PREPARING";
  return status;
}
