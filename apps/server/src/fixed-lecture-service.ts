import { createHash, randomUUID } from "node:crypto";
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
import type { SpeechArtifact, TextToSpeechProvider } from "@aituber/providers";
import { LectureEventStore } from "@aituber/storage";

interface RuntimeSession {
  readonly id: string;
  readonly course: ReadonlyCoursePackage;
  readonly configuredDurationMinutes: number;
  state: LessonState;
  displayUnitId: string | null;
  assessmentId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  speechAbort: AbortController | null;
  speech: FixedSessionView["speech"];
}

export class FixedLectureService {
  readonly #courses: ReadonlyMap<string, ReadonlyCoursePackage>;
  readonly #sessions = new Map<string, RuntimeSession>();
  readonly #store: LectureEventStore;
  readonly #playbackUnitMs: number;
  readonly #speechProvider: TextToSpeechProvider | null;
  readonly #voiceId: string;
  readonly #speechArtifacts = new Map<string, SpeechArtifact>();
  #currentSessionId: string | null = null;

  constructor(options: {
    store: LectureEventStore;
    courses?: readonly ReadonlyCoursePackage[];
    playbackUnitMs?: number;
    speechProvider?: TextToSpeechProvider;
    voiceId?: string;
  }) {
    this.#store = options.store;
    this.#courses = new Map((options.courses ?? coursePackageFixtures).map((course) => [course.id, course]));
    this.#playbackUnitMs = options.playbackUnitMs ?? 2_000;
    this.#speechProvider = options.speechProvider ?? null;
    this.#voiceId = options.voiceId ?? "";
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
      speechAbort: null,
      speech: emptySpeech(1),
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
      speech: runtime.speech,
    };
  }

  getSpeechAudio(cacheKey: string): Pick<SpeechArtifact, "audio" | "mimeType"> {
    const artifact = this.#speechArtifacts.get(cacheKey);
    if (!artifact) throw new RangeError(`Unknown speech artifact ${cacheKey}`);
    return { audio: artifact.audio, mimeType: artifact.mimeType };
  }

  command(sessionId: string, request: SessionCommandRequest): FixedSessionView {
    const runtime = this.#requireSession(sessionId);
    if (request.command === "pause") {
      this.#cancelSpeech(runtime);
      const previousEpoch = runtime.state.epoch;
      this.#apply(runtime, { type: "PAUSE_REQUESTED", epoch: previousEpoch });
      this.#store.advanceEpoch(runtime.id);
    } else if (request.command === "resume") {
      this.#apply(runtime, { type: "RECOVERY_STARTED", epoch: runtime.state.epoch });
      this.#apply(runtime, { type: "RECOVERY_COMPLETED", epoch: runtime.state.epoch });
      this.#schedule(runtime);
    } else if (request.command === "finish") {
      this.#cancelSpeech(runtime);
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
    this.#sessions.forEach((runtime) => this.#cancelSpeech(runtime));
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
    const unit = runtime.course.teachingUnits.find((candidate) => candidate.id === unitId)!;
    const epoch = runtime.state.epoch;
    if (!this.#speechProvider || !this.#voiceId) {
      this.#startPlayback(runtime, unitId, epoch, {
        ...emptySpeech(epoch), mode: "test", playing: true, unitId, startedAt: new Date().toISOString(), durationMs: this.#playbackUnitMs,
        segments: [{ text: unit.speechText, startMs: 0, endMs: this.#playbackUnitMs, semanticTargetIds: unit.focusTargetIds }],
      });
      return;
    }
    runtime.speech = { ...emptySpeech(epoch), mode: "preparing", unitId };
    const controller = new AbortController();
    runtime.speechAbort = controller;
    void this.#speechProvider.synthesize({
      text: unit.speechText,
      language: "ja-JP",
      voiceId: this.#voiceId,
      dictionaryVersion: dictionaryVersion(runtime.course.pronunciationDictionary),
    }, { signal: controller.signal }).then((artifact) => {
      if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING" || runtime.state.presentedUnitId !== unitId) return;
      runtime.speechAbort = null;
      this.#speechArtifacts.set(artifact.cacheKey, artifact);
      this.#startPlayback(runtime, unitId, epoch, {
        mode: "fish-audio", playing: true, epoch, unitId, startedAt: new Date().toISOString(), durationMs: artifact.durationMs,
        audioUrl: `/api/audio/${artifact.cacheKey}?epoch=${epoch}`, failure: null,
        segments: artifact.segments.map((segment) => ({ ...segment, semanticTargetIds: unit.focusTargetIds })),
        provider: artifact.provider, model: artifact.model, voiceId: artifact.voiceId, firstAudioMs: artifact.firstAudioMs,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING" || runtime.state.presentedUnitId !== unitId) return;
      runtime.speechAbort = null;
      this.#startPlayback(runtime, unitId, epoch, {
        mode: "caption-fallback", playing: true, epoch, unitId, startedAt: new Date().toISOString(), durationMs: this.#playbackUnitMs, audioUrl: null,
        segments: [{ text: unit.speechText, startMs: 0, endMs: this.#playbackUnitMs, semanticTargetIds: unit.focusTargetIds }],
        failure: error instanceof Error ? error.message : "TTS failed",
        provider: this.#speechProvider?.provider ?? null, model: this.#speechProvider?.model ?? null, voiceId: this.#voiceId || null, firstAudioMs: null,
      });
    });
  }

  #startPlayback(runtime: RuntimeSession, unitId: string, epoch: number, speech: FixedSessionView["speech"]) {
    runtime.speech = speech;
    runtime.timer = setTimeout(() => this.#completeUnit(runtime.id, unitId, epoch), Math.max(1, speech.durationMs));
  }

  #completeUnit(sessionId: string, unitId: string, epoch: number) {
    const runtime = this.#requireSession(sessionId);
    runtime.timer = null;
    if (runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING") return;
    this.#apply(runtime, { type: "UNIT_AUDIO_COMPLETED", epoch, unitId });
    runtime.speech = { ...runtime.speech, playing: false };
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

  #cancelSpeech(runtime: RuntimeSession) {
    runtime.speechAbort?.abort(new DOMException("Lecture epoch changed", "AbortError"));
    runtime.speechAbort = null;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = null;
    runtime.speech = { ...runtime.speech, playing: false, startedAt: null, audioUrl: null };
  }

  #requireSession(sessionId: string): RuntimeSession {
    const runtime = this.#sessions.get(sessionId);
    if (!runtime) throw new RangeError(`Unknown session ${sessionId}`);
    return runtime;
  }
}

function emptySpeech(epoch: number): FixedSessionView["speech"] {
  return { mode: "preparing", playing: false, epoch, unitId: null, startedAt: null, durationMs: 0, audioUrl: null, segments: [], failure: null, provider: null, model: null, voiceId: null, firstAudioMs: null };
}

function dictionaryVersion(dictionary: ReadonlyCoursePackage["pronunciationDictionary"]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(dictionary)).digest("hex")}`;
}

function visibleStatus(status: LessonState["status"]): FixedSessionView["status"] {
  if (status === "ASSESSING" || status === "BRANCHING" || status === "REJOINING") return "TEACHING";
  if (status === "IDLE") return "PREPARING";
  return status;
}
