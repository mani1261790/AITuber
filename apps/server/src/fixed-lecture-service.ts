import { referencePlan, type LessonPlanner, type DirectedPlan } from "./lesson-director.ts";
import type { LessonDirectionView, LessonAction } from "@aituber/contracts";
import { createHash, randomUUID } from "node:crypto";
import type {
  CourseSummary,
  ClassroomSnapshot,
  CreateSessionRequest,
  FixedSessionView,
  LiveSupplementCandidateView,
  LiveSupplementView,
  ReadonlyCoursePackage,
  AssessmentEvaluationView,
  AfterClassAnswerView,
  LearningEvidenceSummaryView,
  SessionCommandRequest,
  SupplementOriginView,
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
  revision: number;
  startedAtMs: number;
  liveSupplement: LiveSupplementView | null;
  pendingSupplement: PendingSupplement | null;
  boardCorrections: Map<string, { readonly sceneId: string; readonly content: string }>;
  learningEvidence: readonly LearningEvidenceSummaryView[];
  lastAssessmentEvaluation: AssessmentEvaluationView | null;
  afterClassAnswers: readonly AfterClassAnswerView[];
}

interface PendingSupplement {
  readonly view: LiveSupplementView;
  readonly onPlaybackStarted: (occurredAt: string, audible: boolean) => void;
  readonly onCompleted: () => void;
  readonly onFailure?: (reason: string) => void;
}

type SessionListener = (sessionId: string, snapshot: ClassroomSnapshot) => void;

export class FixedLectureService {
  readonly #planner: LessonPlanner | null;
  readonly #requireLiveExecution: boolean;
  readonly #directions = new WeakMap<RuntimeSession, LessonDirectionView>();
  readonly #lastStagePosition = new WeakMap<RuntimeSession, LessonDirectionView["position"]>();
  readonly #boardSpeechStart = new WeakMap<RuntimeSession, () => void>();
  readonly #speechNext = new WeakMap<RuntimeSession, () => void>();
  readonly #travelArrived = new WeakSet<RuntimeSession>();
  readonly #drawingWait = new WeakMap<RuntimeSession, {started:number; fail:()=>void}>();
  readonly #stageNext = new WeakMap<RuntimeSession, () => void>();
  readonly #questionAnswer = new WeakMap<RuntimeSession,string>();
  readonly #previousSpeech = new WeakMap<RuntimeSession, string>();
  readonly #preparedSpeech = new WeakMap<RuntimeSession, Map<string, {controller:AbortController; promise:Promise<SpeechArtifact>}>>();
  readonly #projection = new WeakMap<RuntimeSession, {started:number; timer:ReturnType<typeof setTimeout>; fail:()=>void; stageDone:boolean; speechDone:boolean; next:()=>void}>();
  readonly #prefetch = new WeakMap<RuntimeSession, { unitId: string; stamp: string; controller: AbortController; plan: Promise<DirectedPlan> }>();
  readonly #playbackDeadlines = new WeakMap<RuntimeSession, { deadline: number; maxDeadline: number; complete: () => void; audioUrl: string | null; epoch: number; owner?: string; ended?: boolean }>();

  readonly #executionOwner = new WeakMap<RuntimeSession,{epoch:number;participantId:string}>();
  #ownsExecution(runtime: RuntimeSession, participantId: string | undefined) {
    if (!this.#requireLiveExecution) return true;
    if (!participantId) return false;
    const owner=this.#executionOwner.get(runtime);
    if (!owner || owner.epoch!==runtime.state.epoch) {
      this.#executionOwner.set(runtime,{epoch:runtime.state.epoch,participantId});
      return true;
    }
    return owner.participantId===participantId;
  }

  reportPlayback(sessionId: string, epoch: number, audioUrl: string, remainingMs: number, participantId?: string, playbackState?: string, startedAt?: string) {
    const runtime = this.#requireSession(sessionId);
    const pending = this.#playbackDeadlines.get(runtime);
    if (!pending || runtime.state.epoch !== epoch || pending.epoch !== epoch || pending.audioUrl !== audioUrl || !runtime.timer || !runtime.speech.playing) return;
    if (!Number.isFinite(remainingMs) || remainingMs < 0 || remainingMs > runtime.speech.durationMs + 30_000) return;
    if (this.#requireLiveExecution && pending.audioUrl) {
      if (startedAt !== runtime.speech.startedAt || !participantId || !["playing","waiting","ended","error"].includes(playbackState ?? "") || pending.ended) return;
      // One authenticated classroom drives both stage and audio in this epoch.
      // A second viewer cannot finish a stage ahead of the playback owner.
      if (!pending.owner && playbackState === "playing" && this.#ownsExecution(runtime,participantId)) pending.owner = participantId;
      if (pending.owner !== participantId) return;
      clearTimeout(runtime.timer);
      if (playbackState === "ended") {
        pending.ended = true;
        runtime.timer = setTimeout(pending.complete,850);
      } else if (playbackState === "error") {
        this.#haltExecution(runtime,"音声の再生に失敗しました。音声を再生できる状態にしてから再開してください。");
      } else {
        const wait = Math.max(1,Math.min(15_000,pending.maxDeadline-Date.now()));
        runtime.timer = setTimeout(()=>this.#haltExecution(runtime,"音声の再生完了を確認できませんでした。接続と音声出力を確認して再開してください。"),wait);
      }
      return;
    }
    const deadline = Math.min(pending.maxDeadline, Date.now() + remainingMs + 850);
    if (deadline <= pending.deadline) return;
    pending.deadline = deadline;
    clearTimeout(runtime.timer);
    runtime.timer = setTimeout(pending.complete, Math.max(1, deadline-Date.now()));
  }

  #waitForSpeech(runtime: RuntimeSession, speech: FixedSessionView["speech"], complete: () => void) {
    const delay = Math.max(1,speech.durationMs)+(speech.provider === "fish-audio" ? 850 : 0);
    this.#playbackDeadlines.set(runtime,{deadline: Date.now()+delay,maxDeadline:Date.now()+delay+30_000,complete,audioUrl:speech.audioUrl,epoch:speech.epoch});
    runtime.timer = this.#requireLiveExecution && speech.audioUrl
      ? setTimeout(()=>this.#haltExecution(runtime,"音声の再生開始を確認できませんでした。教室で音声を有効にして再開してください。"),30_000)
      : setTimeout(complete,delay);
  }
  readonly #courses: Map<string, ReadonlyCoursePackage>;
  readonly #sessions = new Map<string, RuntimeSession>();
  readonly #store: LectureEventStore;
  readonly #playbackUnitMs: number;
  readonly #speechProvider: TextToSpeechProvider | null;
  readonly #voiceId: string;
  readonly #speechArtifacts = new Map<string, SpeechArtifact>();
  readonly #retiredSpeechArtifacts = new Map<string, { readonly sessionId: string; readonly epoch: number; readonly artifact: SpeechArtifact; readonly timer: ReturnType<typeof setTimeout> }>();
  readonly #listeners = new Set<SessionListener>();
  #currentSessionId: string | null = null;
  #beforeFinish: ((sessionId: string) => boolean) | null = null;

  constructor(options: {
    store: LectureEventStore;
    courses?: readonly ReadonlyCoursePackage[];
    playbackUnitMs?: number;
    speechProvider?: TextToSpeechProvider;
    voiceId?: string;
    planner?: LessonPlanner;
    requireLiveExecution?: boolean;
  }) {
    this.#planner = options.planner ?? null;
    this.#requireLiveExecution = options.requireLiveExecution ?? false;
    this.#store = options.store;
    this.#courses = new Map((options.courses ?? coursePackageFixtures).map((course) => [course.id, course]));
    this.#playbackUnitMs = options.playbackUnitMs ?? 2_000;
    this.#speechProvider = options.speechProvider ?? null;
    this.#voiceId = options.voiceId ?? "";
  }

  exportCheckpoint() {
    const runtime = this.#currentSessionId ? this.#sessions.get(this.#currentSessionId) : null;
    if (!runtime) return null;
    const direction=this.#directions.get(runtime);
    return { liveSupplement:runtime.liveSupplement,
      presentation:direction ? {surface:direction.surface ?? "slides",drawing:direction.drawing ?? null,position:direction.position,camera:direction.camera} : null,
      previousSpeech:this.#previousSpeech.get(runtime) ?? "", questionAnswer:this.#questionAnswer.get(runtime) ?? null,
      executionFailure: runtime.speech.failure, version: 1 as const, id: runtime.id, course: runtime.course, configuredDurationMinutes: runtime.configuredDurationMinutes,
      state: runtime.state, displayUnitId: runtime.displayUnitId, assessmentId: runtime.assessmentId, revision: runtime.revision,
      startedAtMs: runtime.startedAtMs, boardCorrections: [...runtime.boardCorrections], learningEvidence: runtime.learningEvidence,
      lastAssessmentEvaluation: runtime.lastAssessmentEvaluation, afterClassAnswers: runtime.afterClassAnswers };
  }

  /** Re-enter an interrupted unit with a new audio epoch; completed units remain completed. */
  restoreCheckpoint(saved: NonNullable<ReturnType<FixedLectureService["exportCheckpoint"]>>): boolean {
    if (saved.version !== 1 || this.#currentSessionId) throw new TypeError("Invalid or duplicate runtime checkpoint");
    const stored = this.#store.getSession(saved.id);
    const terminal = saved.state.status === "FINISHED";
    const waitForAnswer = saved.state.status === "CHECKPOINT";
    const manuallyPaused = saved.state.status === "PAUSED";
    const epoch = terminal ? stored.epoch : this.#store.advanceEpoch(saved.id).epoch;
    const recoverable = saved.liveSupplement?.candidate && ["ready","playing","rejoining"].includes(saved.liveSupplement.status) ? saved.liveSupplement : null;
    const resumedStatus = recoverable && (["BRANCHING","REJOINING"].includes(saved.state.status) || saved.state.resumeStatus === "BRANCHING") ? "BRANCHING" as const : saved.assessmentId ? "CHECKPOINT" as const : "TEACHING" as const;
    const state: LessonState = {...saved.state,epoch,status:terminal?"FINISHED":waitForAnswer?"CHECKPOINT":"PAUSED",resumeStatus:terminal||waitForAnswer?null:resumedStatus,branchOriginUnitId:null,lastFailure:null};
    const runtime: RuntimeSession = {...saved,state,boardCorrections:new Map(saved.boardCorrections),timer:null,speechAbort:null,speech:{...emptySpeech(epoch),failure:typeof saved.executionFailure === "string" ? saved.executionFailure : null},liveSupplement:recoverable,pendingSupplement:null};
    if(saved.presentation) this.#directions.set(runtime,{...saved.presentation,actionId:randomUUID(),phase:"resting",targetId:null,traveling:false,source:"generated",reason:null});
    this.#previousSpeech.set(runtime,saved.previousSpeech ?? "");
    if(saved.questionAnswer) this.#questionAnswer.set(runtime,saved.questionAnswer);
    this.#courses.set(saved.course.id,saved.course); this.#sessions.set(saved.id,runtime); this.#currentSessionId=saved.id;
    return !terminal && !waitForAnswer && !manuallyPaused;
  }

  forgetSessionsExcept(ids: ReadonlySet<string>) {
    for (const [id, runtime] of this.#sessions) {
      if (ids.has(id)) continue;
      this.#cancelSpeech(runtime); this.#sessions.delete(id);
      if (this.#currentSessionId === id) this.#currentSessionId = null;
    }
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

  registerCourse(course: ReadonlyCoursePackage): void {
    if (course.status !== "available") throw new TypeError("Only an available Course Package can be registered");
    this.#courses.set(course.id, course);
  }

  createSession(request: CreateSessionRequest): FixedSessionView {
    if (this.#requireLiveExecution && (!this.#planner || !this.#speechProvider || !this.#voiceId)) throw new TypeError("講義開始にはLLMと音声接続の設定が必要です。無音のテスト進行では開始できません。");
    const course = this.#courses.get(request.coursePackageId);
    if (!course) throw new RangeError(`Unknown Course Package ${request.coursePackageId}`);
    if (!Number.isInteger(request.durationMinutes) || request.durationMinutes < 1 || request.durationMinutes > 480) {
      throw new TypeError("durationMinutes must be an integer between 1 and 480");
    }

    if (this.#currentSessionId) {
      const previous = this.#sessions.get(this.#currentSessionId);
      if (previous && previous.state.status !== "FINISHED") throw new TypeError("進行中の講義があります。現在の講義を終了してから新しい講義を開始してください。");
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
      revision: 0,
      startedAtMs: Date.now(),
      liveSupplement: null,
      pendingSupplement: null,
      boardCorrections: new Map(),
      learningEvidence: course.learningGoals.map((goal) => ({ scopeId: goal.id, label: goal.description, state: "unconfirmed", evidenceCount: 0, lastEvidenceAt: null })),
      lastAssessmentEvaluation: null,
      afterClassAnswers: [],
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

  getRemainingTimeMs(sessionId: string): number { const runtime = this.#requireSession(sessionId); return Math.max(0, runtime.configuredDurationMinutes * 60_000 - (Date.now() - runtime.startedAtMs)); }

  getSession(sessionId: string): FixedSessionView {
    const runtime = this.#requireSession(sessionId);
    const unfinishedUnitIds = runtime.state.orderedUnitIds.filter((id) => !runtime.state.completedUnitIds.includes(id));
    const assessment = runtime.assessmentId
      ? runtime.course.assessments.find((item) => item.id === runtime.assessmentId) ?? null
      : null;
    return {
      id: runtime.id,
      direction: this.#directions.get(runtime) ?? null,
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
      liveSupplement: runtime.liveSupplement,
      boardCorrections: [...runtime.boardCorrections].map(([targetId, value]) => ({ sceneId: value.sceneId, targetId, content: value.content })),
      learningEvidence: runtime.learningEvidence,
      lastAssessmentEvaluation: runtime.lastAssessmentEvaluation,
      afterClassAnswers: runtime.afterClassAnswers,
    };
  }

  captureSupplementOrigin(sessionId: string, questionTargetId: string): SupplementOriginView {
    const runtime = this.#requireSession(sessionId);
    const unfinishedUnitIds = runtime.state.orderedUnitIds.filter((id) => !runtime.state.completedUnitIds.includes(id));
    return { lastCompletedUnitId: runtime.state.completedUnitIds.at(-1) ?? null, unfinishedUnitIds, nextUnitId: unfinishedUnitIds[0] ?? null, displayUnitId: runtime.displayUnitId, questionTargetId, remainingMs: this.getRemainingTimeMs(sessionId) };
  }

  updateLearningEvidence(sessionId: string, summaries: readonly LearningEvidenceSummaryView[], evaluation: AssessmentEvaluationView | null = null): void {
    const runtime = this.#requireSession(sessionId); runtime.learningEvidence = summaries;
    if (evaluation) runtime.lastAssessmentEvaluation = evaluation;
    this.#publish(runtime);
  }

  updateAfterClassAnswers(sessionId: string, answers: readonly AfterClassAnswerView[]): void { const runtime = this.#requireSession(sessionId); runtime.afterClassAnswers = answers; this.#publish(runtime); }
  setBeforeFinishHandler(handler: ((sessionId: string) => boolean) | null): void { this.#beforeFinish = handler; }

  announceSupplement(sessionId: string, view: LiveSupplementView, options: { readonly interrupt: boolean; readonly bridgeText: string | null; readonly bridgeTargetIds: readonly string[]; readonly onBridgeStarted?: (occurredAt: string, audible: boolean) => void }): void {
    const runtime = this.#requireSession(sessionId);
    if (!new Set(["TEACHING", "BRANCHING", "CHECKPOINT"]).has(runtime.state.status) || runtime.liveSupplement && !new Set(["completed", "deferred"]).has(runtime.liveSupplement.status)) throw new TypeError("The lecture is not ready for another live supplement");
    runtime.liveSupplement = { ...view, status: options.interrupt && options.bridgeText ? "bridging" : "preparing" };
    if (options.interrupt) {
      this.#cancelSpeech(runtime);
      if (runtime.state.status === "TEACHING" || runtime.state.status === "CHECKPOINT") this.#apply(runtime, { type: "QUESTION_ACCEPTED", epoch: runtime.state.epoch });
      if (options.bridgeText) this.#playTransient(runtime, options.bridgeText, options.bridgeTargetIds, Math.min(8_000, Math.max(this.#playbackUnitMs, 1_000)), (occurredAt, audible) => {
        if (runtime.liveSupplement && runtime.liveSupplement.id === view.id && audible) runtime.liveSupplement = { ...runtime.liveSupplement, firstAudioAt: runtime.liveSupplement.firstAudioAt ?? occurredAt };
        options.onBridgeStarted?.(occurredAt, audible);
      }, () => {
        if (runtime.liveSupplement && runtime.liveSupplement.id === view.id) runtime.liveSupplement = { ...runtime.liveSupplement, status: runtime.pendingSupplement ? "ready" : "preparing" };
        this.#publish(runtime);
        if (runtime.pendingSupplement) this.#activateSupplement(runtime);
      });
    }
    this.#publish(runtime);
  }

  queueSupplement(sessionId: string, view: LiveSupplementView, callbacks: Pick<PendingSupplement, "onPlaybackStarted" | "onCompleted" | "onFailure">): void {
    const runtime = this.#requireSession(sessionId);
    if (!runtime.liveSupplement || runtime.liveSupplement.id !== view.id) throw new TypeError("Unknown active live supplement");
    runtime.liveSupplement = { ...view, firstAudioAt: runtime.liveSupplement.firstAudioAt ?? view.firstAudioAt, status: runtime.liveSupplement.status === "bridging" ? "bridging" : "ready" };
    runtime.pendingSupplement = { view, ...callbacks };
    if (view.candidate) this.#prepareSpeech(runtime,view.candidate.speechText);
    this.#publish(runtime);
    if (runtime.state.status === "BRANCHING" && !runtime.speech.playing && !runtime.speechAbort && !runtime.timer) this.#activateSupplement(runtime);
    else if ((runtime.state.status === "TEACHING" || runtime.state.status === "CHECKPOINT") && !runtime.timer && !runtime.speech.playing && !runtime.speechAbort) this.#activateSupplement(runtime);
  }

  deferSupplement(sessionId: string, view: LiveSupplementView): void {
    const runtime = this.#requireSession(sessionId);
    runtime.pendingSupplement = null;
    runtime.liveSupplement = { ...view, status: "deferred" };
    if (runtime.state.status === "BRANCHING") {
      if (runtime.timer || runtime.speech.playing) this.#cancelSpeech(runtime);
      this.#apply(runtime, { type: "QUESTION_DEFERRED", epoch: runtime.state.epoch });
      // A failed remedial supplement must not skip the unanswered checkpoint.
      if (runtime.assessmentId) this.#apply(runtime, { type: "CHECKPOINT_PRESENTED", epoch: runtime.state.epoch });
      else this.#schedule(runtime);
    }
    this.#publish(runtime);
  }

  getSnapshot(sessionId: string): ClassroomSnapshot {
    const runtime = this.#requireSession(sessionId);
    return {
      seq: runtime.revision,
      serverTime: new Date().toISOString(),
      audioEpoch: runtime.speech.epoch,
      audioOffsetMs: speechOffsetMs(runtime.speech),
      session: this.getSession(sessionId),
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSpeechAudio(sessionId: string, epoch: number, cacheKey: string): Pick<SpeechArtifact, "audio" | "mimeType"> {
    const runtime = this.#requireSession(sessionId);
    if (runtime.state.epoch !== epoch) throw new RangeError("Speech artifact is no longer active");
    const artifact = this.#speechArtifacts.get(cacheKey) ?? (this.#retiredSpeechArtifacts.get(cacheKey)?.sessionId === sessionId && this.#retiredSpeechArtifacts.get(cacheKey)?.epoch === epoch ? this.#retiredSpeechArtifacts.get(cacheKey)?.artifact : undefined);
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
      if (runtime.state.status === "BRANCHING" && runtime.pendingSupplement) { if(!runtime.timer && !runtime.speechAbort && !runtime.speech.playing) this.#activateSupplement(runtime); } else this.#schedule(runtime);
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
      const supplementRequired = Boolean(request.assessmentEvaluation && (request.assessmentEvaluation.outcome !== "correct" || !request.assessmentEvaluation.linkedSupplementId));
      this.#apply(runtime, { type: "BRANCH_SELECTED", epoch: runtime.state.epoch, supplementRequired });
      if (request.assessmentEvaluation) runtime.lastAssessmentEvaluation = request.assessmentEvaluation;
      if (!supplementRequired) runtime.assessmentId = null;
      this.#publish(runtime);
      if (!supplementRequired) this.#schedule(runtime);
    }
    return this.getSession(sessionId);
  }

  close() {
    this.#sessions.forEach((runtime) => this.#cancelSpeech(runtime));
    this.#retiredSpeechArtifacts.forEach((item) => clearTimeout(item.timer));
    this.#retiredSpeechArtifacts.clear();
  }

  #schedule(runtime: RuntimeSession) {
    if (runtime.state.status !== "TEACHING") return;
    const unitId = runtime.state.activeUnitId;
    if (!unitId) {
      if (this.#beforeFinish?.(runtime.id)) return;
      this.#apply(runtime, { type: "FINISH_REQUESTED", epoch: runtime.state.epoch });
      return;
    }
    runtime.displayUnitId = unitId;
    this.#publish(runtime);
    this.#apply(runtime, { type: "UNIT_PRESENTED", epoch: runtime.state.epoch, unitId });
    const unit = runtime.course.teachingUnits.find((candidate) => candidate.id === unitId)!;
    if (this.#planner) { void this.#direct(runtime, unit); return; }
    this.#speakUnit(runtime,unitId,unit.speechText);
  }

  #contextStamp(runtime: RuntimeSession) { return JSON.stringify([runtime.learningEvidence,runtime.lastAssessmentEvaluation,[...runtime.boardCorrections],runtime.liveSupplement?.id]); }

  async #direct(runtime: RuntimeSession, unit: ReadonlyCoursePackage["teachingUnits"][number]) {
    const epoch = runtime.state.epoch;
    const controller = new AbortController(); runtime.speechAbort = controller;
    const previous = this.#directions.get(runtime);
    this.#directions.set(runtime,{ actionId: randomUUID(), phase:"planning", drawing:previous?.drawing ?? null, surface:previous?.surface ?? "board", position:previous?.position ?? this.#lastStagePosition.get(runtime) ?? "right", targetId:null, camera:previous?.camera ?? "lecture",source:"reference",reason:null });
    runtime.speech = { ...emptySpeech(epoch),unitId:unit.id }; this.#publish(runtime);
    const prefetched = this.#prefetch.get(runtime); this.#prefetch.delete(runtime);
    let plan: DirectedPlan;
    try {
      if (prefetched?.unitId === unit.id && (prefetched.stamp === this.#contextStamp(runtime) || ["preparing","ready"].includes(runtime.liveSupplement?.status ?? ""))) {
        controller.signal.addEventListener("abort",()=>prefetched.controller.abort(),{once:true});
        plan = await prefetched.plan;
      } else {
        prefetched?.controller.abort();
        plan = await this.#planner!({session:this.getSession(runtime.id),unit,previousSpeech:this.#previousSpeech.get(runtime) ?? "",...(this.#questionAnswer.has(runtime) ? {questionAnswer:this.#questionAnswer.get(runtime)!} : {}),remainingMs:this.getRemainingTimeMs(runtime.id)},controller.signal);
      }
    } catch (error) { if (controller.signal.aborted) return; plan = referencePlan(unit,error instanceof Error ? error.message : "台本生成失敗"); }
    if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING") return;
    runtime.speechAbort = null;
    this.#questionAnswer.delete(runtime);
    const stored = this.#store.getSession(runtime.id);
    this.#store.appendEvent({eventId:`event.${randomUUID()}`,sessionId:runtime.id,coursePackageId:runtime.course.id,coursePackageVersion:runtime.course.version,epoch:stored.epoch,seq:stored.lastSeq+1,occurredAt:new Date().toISOString(),type:"lesson.direction-planned",payload:{unitId:unit.id,source:plan.source,reason:plan.reason,actions:plan.actions}});
    const base = this.#directions.get(runtime)!;
    this.#directions.set(runtime,{...base,source:plan.source,reason:plan.reason});
    if (this.#requireLiveExecution && plan.source !== "generated") {
      this.#haltExecution(runtime, `授業台本を生成できませんでした: ${plan.reason ?? "生成結果がありません"}`);
      return;
    }
    const neededSpeech = new Set(plan.actions.filter(action=>action.type==="speak").map(action=>applyPronunciationDictionary(action.text,runtime.course.pronunciationDictionary)));
    this.#preparedSpeech.get(runtime)?.forEach((item,key,cache)=>{if(!neededSpeech.has(key)){item.controller.abort();cache.delete(key);}});
    for (const action of plan.actions) if (action.type === "speak") this.#prepareSpeech(runtime, action.text);
    const spoken = plan.actions.filter(action=>action.type === "speak").map(action=>action.text).join(" ");
    const nextId = runtime.state.orderedUnitIds[runtime.state.orderedUnitIds.indexOf(unit.id)+1];
    const nextUnit = runtime.course.teachingUnits.find(candidate=>candidate.id === nextId);
    if (nextUnit && !runtime.course.assessments.some(assessment=>assessment.afterUnitId === unit.id)) {
      const nextController = new AbortController();
      // Prefetch runs before this plan's moves. The next unit starts at the plan's
      // ending position, not at the teacher's current position before execution.
      let endingPosition = base.position;
      let endingSurface = base.surface ?? "slides";
      let endingDrawing = base.drawing ?? null;
      for (const action of plan.actions) {
        if (action.type === "move_to" || (action.type === "speak" && action.position)) endingPosition = action.position!;
        if (action.type === "show_blackboard") { endingSurface = "board"; endingDrawing = action.drawing; }
        if (action.type === "show_slides" || (action.type === "speak" && action.surface === "slides")) endingSurface = "slides";
      }
      const nextSession = this.getSession(runtime.id);
      const projectedSession: FixedSessionView = {...nextSession, direction:{...nextSession.direction!,position:endingPosition,surface:endingSurface,drawing:endingDrawing,phase:"complete",traveling:false,targetId:null}};
      const promise = this.#planner!({session:projectedSession,unit:nextUnit,previousSpeech:spoken,remainingMs:this.getRemainingTimeMs(runtime.id)},nextController.signal).catch(()=>referencePlan(nextUnit,"先読みを再利用できませんでした"));
      void promise.then(nextPlan=>{if (!nextController.signal.aborted && runtime.state.epoch===epoch && runtime.state.status==="TEACHING") for (const action of nextPlan.actions) if(action.type==="speak") this.#prepareSpeech(runtime,action.text);});
      this.#prefetch.set(runtime,{unitId:nextUnit.id,stamp:this.#contextStamp(runtime),controller:nextController,plan:promise});
    }
    this.#runAction(runtime,unit.id,epoch,plan.actions,0);
  }

  reportStageProgress(sessionId: string, epoch: number, actionId: string, participantId?: string, writingStarted?: boolean) {
    const runtime = this.#requireSession(sessionId);
    const direction = this.#directions.get(runtime);
    if (runtime.state.epoch !== epoch || direction?.actionId !== actionId) return;
    const projection = this.#projection.get(runtime);
    if (projection) {
      if (!this.#ownsExecution(runtime,participantId) || projection.stageDone) return;
      if (writingStarted === true && direction.phase === "drawing") { const begin = this.#boardSpeechStart.get(runtime); this.#boardSpeechStart.delete(runtime); begin?.(); }
      clearTimeout(projection.timer);
      projection.timer=setTimeout(projection.fail,Math.max(1,Math.min(12_000,(direction.phase === "drawing" ? 120_000 : 90_000)-(Date.now()-projection.started))));
      return;
    }
    if (!this.#stageNext.has(runtime) && !direction.traveling) return;
    if (!this.#ownsExecution(runtime,participantId)) return;
    if(this.#drawingWait.has(runtime)) {
      const pending=this.#drawingWait.get(runtime);
      if(pending && runtime.timer){
        clearTimeout(runtime.timer);
        const remaining=(direction.phase==="drawing"?120_000:90_000)-(Date.now()-pending.started);
        runtime.timer=setTimeout(pending.fail,Math.max(1,Math.min(12_000,remaining)));
      }
      return;
    }
    if (direction.phase !== "moving" && !direction.traveling) return;
    // A live stage may need more than twelve seconds on a slow renderer.
    // Keep the disconnect fallback, but do not interrupt a reported active move.
    const next = this.#stageNext.get(runtime);
    if (next && runtime.timer) { clearTimeout(runtime.timer); runtime.timer=setTimeout(()=>{runtime.timer=null;this.#stageNext.delete(runtime);next();},12000); }
  }

  completeStageAction(sessionId: string, epoch: number, actionId: string, participantId?: string) {
    const runtime = this.#requireSession(sessionId);
    if (runtime.state.epoch !== epoch || this.#directions.get(runtime)?.actionId !== actionId) return;
    const projection = this.#projection.get(runtime);
    if (projection) {
      if (!this.#ownsExecution(runtime,participantId)) return;
      clearTimeout(projection.timer); projection.stageDone=true;
      const begin = this.#boardSpeechStart.get(runtime); this.#boardSpeechStart.delete(runtime); begin?.();
      const direction=this.#directions.get(runtime)!;
      this.#directions.set(runtime,{...direction,phase:"speaking",traveling:false,targetId:direction.surface==="board" ? direction.drawing?.id ?? null : null}); this.#publish(runtime);
      if (projection.speechDone) {this.#projection.delete(runtime);projection.next();}
      return;
    }
    if (!this.#stageNext.has(runtime) && !this.#directions.get(runtime)?.traveling) return;
    if (!this.#ownsExecution(runtime,participantId)) return;
    if (this.#directions.get(runtime)?.traveling && this.#speechNext.has(runtime)) {
      this.#travelArrived.add(runtime); return;
    }
    if (!runtime.timer) return;
    const next = this.#stageNext.get(runtime); if (!next) return;
    clearTimeout(runtime.timer); runtime.timer = null; this.#drawingWait.delete(runtime); this.#stageNext.delete(runtime); next();
  }

  #runAction(runtime: RuntimeSession, unitId: string, epoch: number, actions: readonly LessonAction[], index: number) {
    if (runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING") return;
    const action = actions[index];
    if (!action) {
      const direction = this.#directions.get(runtime)!;
      this.#directions.set(runtime,{...direction,phase:"complete",targetId:null});
      this.#completeUnit(runtime.id,unitId,epoch); return;
    }
    const direction = this.#directions.get(runtime)!;
    const next = () => this.#runAction(runtime,unitId,epoch,actions,index+1);
    const update = (changes: Partial<LessonDirectionView>) => { this.#directions.set(runtime,{...direction,actionId:randomUUID(),traveling:false,gesture:"idle",...changes}); this.#publish(runtime); };
    const wait = (ms: number) => { runtime.timer = setTimeout(()=>{runtime.timer=null;this.#stageNext.delete(runtime);next();},ms); };
    const waitForMove = () => {
      this.#stageNext.set(runtime,next);
      if (!this.#requireLiveExecution) { wait(12000); return; }
      const fail = () => {
        runtime.timer=null;this.#drawingWait.delete(runtime);this.#stageNext.delete(runtime);
        this.#haltExecution(runtime,"先生の移動完了を確認できませんでした。教室画面を確認して再開してください。");
      };
      this.#drawingWait.set(runtime,{started:Date.now(),fail});
      runtime.timer=setTimeout(fail,12000);
    };
    switch(action.type) {
      case "show_slides": {
        if (direction.surface === "slides") { next(); return; }
        update({phase:"projecting",surface:"slides",targetId:null});
        this.#stageNext.set(runtime,next);
        const fail = () => {
          runtime.timer=null;this.#drawingWait.delete(runtime);this.#stageNext.delete(runtime);
          this.#haltExecution(runtime,"スライド投影の完了を確認できませんでした。教室画面を確認して再開してください。");
        };
        this.#drawingWait.set(runtime,{started:Date.now(),fail});
        runtime.timer=setTimeout(fail,12000);return;
      }
      case "show_blackboard": {
        update({phase:"drawing",surface:"board",drawing:action.drawing,targetId:null});
        const speechIndex = actions.findIndex((item, offset) => offset > index && item.type === "speak");
        const speech = actions[speechIndex];
        if (speech?.type === "speak" && !actions.slice(index + 1, speechIndex).some(item => item.type === "show_slides" || item.type === "show_blackboard" || item.type === "pause")) {
          const after = () => this.#runAction(runtime,unitId,epoch,[{type:"move_to",position:"right"},{type:"pause",durationMs:2000},...actions.slice(speechIndex+1)],0);
          const fail = () => this.#haltExecution(runtime,"板書の表示完了を確認できませんでした。教室画面を確認して再開してください。");
          const pending = {started:Date.now(),timer:setTimeout(fail,12000),fail,stageDone:false,speechDone:false,next:after};
          this.#projection.set(runtime,pending);
          this.#previousSpeech.set(runtime,speech.text);
          this.#speechNext.set(runtime,()=>{pending.speechDone=true;if(pending.stageDone){this.#projection.delete(runtime);after();}});
          this.#boardSpeechStart.set(runtime,()=>this.#speakUnit(runtime,unitId,speech.text));
          return;
        }
        this.#stageNext.set(runtime,next);
        // Never speak about an illustration until a classroom has rendered it.
        const fail = () => {
          runtime.timer = null; this.#drawingWait.delete(runtime); this.#stageNext.delete(runtime);
          if (this.#requireLiveExecution) { this.#haltExecution(runtime,"板書の表示完了を確認できませんでした。教室画面を確認して再開してください。"); return; }
          update({phase:"resting",surface:"slides",drawing:direction.drawing ?? null,reason:"黒板画像を表示できないため参考説明へ戻りました"});
          const unit = runtime.course.teachingUnits.find(item=>item.id===unitId)!;
          this.#runAction(runtime,unitId,epoch,referencePlan(unit).actions,0);
        };
        this.#drawingWait.set(runtime,{started:Date.now(),fail});
        runtime.timer=setTimeout(fail,12000);
        return;
      }
      case "move_to":
        if (direction.position === action.position && direction.surface === "slides") { next(); return; }
        // Projection stays unobstructed; semantic positions are resolved by the stage.
        update({phase:"moving",position:action.position,targetId:null});
        waitForMove(); return;
      case "point_at": update({phase:"pointing",targetId:action.targetId}); wait(550); return;
      case "camera": update({camera:action.view,phase:"resting"}); wait(100); return;
      case "release_point": update({targetId:null,phase:"resting"}); wait(350); return;
      case "pause": update({phase:"resting"}); wait(action.durationMs); return;
      case "speak":
        if (action.surface === "slides" && direction.surface !== "slides") {
          update({phase:"projecting",surface:"slides",targetId:null,gesture:action.gesture ?? "explain"});
          const fail=()=>this.#haltExecution(runtime,"スライド投影の完了を確認できませんでした。教室画面を確認して再開してください。");
          const pending={started:Date.now(),timer:setTimeout(fail,12000),fail,stageDone:false,speechDone:false,next};
          this.#projection.set(runtime,pending);
          this.#previousSpeech.set(runtime,((actions.slice(0,index).some(prior=>prior.type==="speak") ? (this.#previousSpeech.get(runtime) ?? "")+" " : "")+action.text).slice(-2000));
          this.#speechNext.set(runtime,()=>{pending.speechDone=true;if(pending.stageDone){this.#projection.delete(runtime);next();}});
          this.#speakUnit(runtime,unitId,action.text);return;
        }
        this.#travelArrived.delete(runtime);
        update({phase:"speaking",gesture:action.gesture ?? "explain",...(action.position ? {position:action.position,targetId:null,traveling:true} : {})}); this.#previousSpeech.set(runtime,((actions.slice(0,index).some(prior=>prior.type==="speak") ? (this.#previousSpeech.get(runtime) ?? "")+" " : "")+action.text).slice(-2000));
        this.#speechNext.set(runtime, () => {
          if (!action.position || this.#travelArrived.has(runtime)) { this.#travelArrived.delete(runtime); next(); }
          else { waitForMove(); }
        }); this.#speakUnit(runtime,unitId,action.text); return;
    }
  }

  #prepareSpeech(runtime: RuntimeSession, text: string) {
    if (!this.#speechProvider || !this.#voiceId) return;
    const normalized = applyPronunciationDictionary(text, runtime.course.pronunciationDictionary);
    let cache = this.#preparedSpeech.get(runtime);
    if (!cache) { cache = new Map(); this.#preparedSpeech.set(runtime,cache); }
    if (cache.has(normalized) || cache.size >= 6) return;
    const controller = new AbortController();
    const promise = this.#speechProvider.synthesize({text:normalized,language:"ja-JP",voiceId:this.#voiceId,dictionaryVersion:dictionaryVersion(runtime.course.pronunciationDictionary)},{signal:controller.signal});
    // Keep failures for the playback error handler; speculative work must not reject unobserved.
    void promise.catch(()=>{});
    cache.set(normalized,{controller,promise});
  }

  #synthesize(runtime: RuntimeSession, text: string, controller: AbortController) {
    const cache = this.#preparedSpeech.get(runtime);
    const ready = cache?.get(text); cache?.delete(text);
    if (ready) {
      controller.signal.addEventListener("abort",()=>ready.controller.abort(),{once:true});
      return ready.promise;
    }
    return this.#speechProvider!.synthesize({text,language:"ja-JP",voiceId:this.#voiceId!,dictionaryVersion:dictionaryVersion(runtime.course.pronunciationDictionary)},{signal:controller.signal});
  }

  #speakUnit(runtime: RuntimeSession, unitId: string, text: string) {
    const unit = runtime.course.teachingUnits.find(candidate => candidate.id === unitId)!;
    const finalizedText = applyPronunciationDictionary(text, runtime.course.pronunciationDictionary);
    const epoch = runtime.state.epoch;
    if (!this.#speechProvider || !this.#voiceId) {
      this.#startPlayback(runtime, unitId, epoch, {
        ...emptySpeech(epoch), mode: "test", playing: true, unitId, text: finalizedText, startedAt: new Date().toISOString(), durationMs: this.#playbackUnitMs,
        segments: [{ text: finalizedText, startMs: 0, endMs: this.#playbackUnitMs, semanticTargetIds: unit.focusTargetIds }],
      });
      return;
    }
    runtime.speech = { ...emptySpeech(epoch), mode: "preparing", unitId };
    this.#publish(runtime);
    const controller = new AbortController();
    runtime.speechAbort = controller;
    void this.#synthesize(runtime, finalizedText, controller).then((artifact) => {
      if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING" || runtime.state.presentedUnitId !== unitId) return;
      runtime.speechAbort = null;
      this.#speechArtifacts.set(artifact.cacheKey, artifact);
      this.#startPlayback(runtime, unitId, epoch, {
        mode: "fish-audio", playing: true, epoch, unitId, text: finalizedText, startedAt: new Date().toISOString(), durationMs: artifact.durationMs,
        audioUrl: `/api/sessions/${encodeURIComponent(runtime.id)}/speech/${artifact.cacheKey}?epoch=${epoch}`, failure: null,
        segments: artifact.segments.map((segment) => ({ ...segment, semanticTargetIds: unit.focusTargetIds })),
        provider: artifact.provider, model: artifact.model, voiceId: artifact.voiceId, firstAudioMs: artifact.firstAudioMs, synthesisMs: artifact.synthesisMs,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING" || runtime.state.presentedUnitId !== unitId) return;
      runtime.speechAbort = null;
      if (this.#requireLiveExecution) {
        this.#haltExecution(runtime, `音声を生成できませんでした: ${error instanceof Error ? error.message : "TTS failed"}`);
        return;
      }
      this.#startPlayback(runtime, unitId, epoch, {
        mode: "caption-fallback", playing: true, epoch, unitId, text: finalizedText, startedAt: new Date().toISOString(), durationMs: unit.estimatedDurationMs, audioUrl: null,
        segments: [{ text: finalizedText, startMs: 0, endMs: unit.estimatedDurationMs, semanticTargetIds: unit.focusTargetIds }],
        failure: error instanceof Error ? error.message : "TTS failed",
        provider: this.#speechProvider?.provider ?? null, model: this.#speechProvider?.model ?? null, voiceId: this.#voiceId || null, firstAudioMs: null, synthesisMs: null,
      });
    });
  }

  #haltExecution(runtime: RuntimeSession, reason: string) {
    this.command(runtime.id, {command:"pause"});
    runtime.speech = {...emptySpeech(runtime.state.epoch),failure:reason};
    this.#publish(runtime);
  }

  #startPlayback(runtime: RuntimeSession, unitId: string, epoch: number, speech: FixedSessionView["speech"]) {
    runtime.speech = speech;
    this.#publish(runtime);
    this.#waitForSpeech(runtime, speech, () => {
      const next = this.#speechNext.get(runtime);
      if (!next) { this.#completeUnit(runtime.id,unitId,epoch); return; }
      runtime.timer = null; this.#speechNext.delete(runtime);
      this.#discardSpeechArtifact(runtime);
      runtime.speech = { ...runtime.speech, playing:false, audioUrl:null, startedAt:null };
      this.#publish(runtime); next();
    });
  }

  #completeUnit(sessionId: string, unitId: string, epoch: number) {
    const runtime = this.#requireSession(sessionId);
    runtime.timer = null;
    if (runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING") return;
    this.#apply(runtime, { type: "UNIT_AUDIO_COMPLETED", epoch, unitId });
    this.#discardSpeechArtifact(runtime);
    runtime.speech = { ...runtime.speech, playing: false, startedAt: null, audioUrl: null };
    this.#publish(runtime);
    const assessment = runtime.course.assessments.find((item) => item.afterUnitId === unitId);
    if (runtime.pendingSupplement) {
      runtime.assessmentId = assessment?.id ?? null;
      this.#activateSupplement(runtime);
      return;
    }
    if (assessment) {
      runtime.assessmentId = assessment.id;
      this.#apply(runtime, { type: "CHECKPOINT_PRESENTED", epoch: runtime.state.epoch });
      return;
    }
    this.#schedule(runtime);
  }

  #activateSupplement(runtime: RuntimeSession) {
    const pending = runtime.pendingSupplement;
    if (!pending || !pending.view.candidate) return;
    if (runtime.state.status === "TEACHING" || runtime.state.status === "CHECKPOINT") this.#apply(runtime, { type: "QUESTION_ACCEPTED", epoch: runtime.state.epoch });
    if (runtime.state.status !== "BRANCHING") return;
    this.#restDirection(runtime);
    this.#prefetch.get(runtime)?.controller.abort(); this.#prefetch.delete(runtime);
    const candidate = pending.view.candidate;
    runtime.liveSupplement = { ...pending.view, status: "playing" };
    // Prepare the continuation while the answer is drawn/spoken, using its actual content.
    const nextUnit = runtime.course.teachingUnits.find(unit=>unit.id===runtime.state.activeUnitId);
    if (this.#planner && nextUnit && (!runtime.assessmentId || runtime.lastAssessmentEvaluation?.outcome === "correct")) {
      const controller=new AbortController();
      const session=this.getSession(runtime.id);
      const direction=this.#directions.get(runtime);
      const projected:FixedSessionView={...session,...(direction ? {direction:{...direction,phase:"complete",targetId:null,traveling:false,...(candidate.drawing ? {surface:"board",drawing:candidate.drawing,position:"right"} : {})}} : {})};
      const previousSpeech=this.#previousSpeech.get(runtime) ?? "";
      const plan=this.#planner({session:projected,unit:nextUnit,previousSpeech,questionAnswer:candidate.speechText,remainingMs:this.getRemainingTimeMs(runtime.id)},controller.signal).catch(()=>referencePlan(nextUnit,"回答後の説明を先読みできませんでした"));
      void plan.then(result=>{if(!controller.signal.aborted) for(const action of result.actions) if(action.type==="speak") this.#prepareSpeech(runtime,action.text);});
      this.#prefetch.set(runtime,{unitId:nextUnit.id,stamp:this.#contextStamp(runtime),controller,plan});
    }
    this.#publish(runtime);
    if (candidate.drawing) {
      this.#directions.set(runtime,{actionId:randomUUID(),phase:"drawing",position:"right",targetId:null,camera:"lecture",surface:"board",drawing:candidate.drawing!,source:"generated",reason:null});
      const fail=()=>this.#haltExecution(runtime,"板書の完了を確認できませんでした。教室画面を確認して再開してください。");
      this.#projection.set(runtime,{started:Date.now(),timer:setTimeout(fail,12000),fail,stageDone:false,speechDone:false,next:()=>this.#completeSupplement(runtime,pending)});
      this.#boardSpeechStart.set(runtime,()=>this.#playSupplementSpeech(runtime,candidate,pending));
      this.#publish(runtime);
    } else this.#playSupplementSpeech(runtime, candidate, pending);
  }

  #playSupplementSpeech(runtime: RuntimeSession, candidate: LiveSupplementCandidateView, pending: PendingSupplement) {
    const text = applyPronunciationDictionary(candidate.speechText, runtime.course.pronunciationDictionary); const epoch = runtime.state.epoch;
    const begin = (speech: FixedSessionView["speech"]) => {
      const occurredAt = new Date().toISOString(); const audible = speech.mode !== "caption-fallback"; pending.onPlaybackStarted(occurredAt, audible);
      runtime.liveSupplement = runtime.liveSupplement ? { ...runtime.liveSupplement, firstAudioAt: runtime.liveSupplement.firstAudioAt ?? (audible ? occurredAt : null) } : null;
      runtime.speech = speech; this.#publish(runtime);
      this.#waitForSpeech(runtime, speech, () => {
        const movement=this.#projection.get(runtime);
        if (!movement) {this.#completeSupplement(runtime,pending);return;}
        runtime.timer=null; movement.speechDone=true;
        runtime.speech={...runtime.speech,playing:false,startedAt:null};this.#publish(runtime);
        if(movement.stageDone){this.#projection.delete(runtime);movement.next();}
      });
    };
    if (!this.#speechProvider || !this.#voiceId) { begin({ ...emptySpeech(epoch), mode: "test", playing: true, unitId: null, text, startedAt: new Date().toISOString(), durationMs: this.#playbackUnitMs, segments: [{ text, startMs: 0, endMs: this.#playbackUnitMs, semanticTargetIds: candidate.focusTargetIds }] }); return; }
    runtime.speech = { ...emptySpeech(epoch), mode: "preparing", text, segments: [{ text, startMs: 0, endMs: candidate.speechText.length * 80, semanticTargetIds: candidate.focusTargetIds }] }; this.#publish(runtime);
    const controller = new AbortController(); runtime.speechAbort = controller;
    void this.#synthesize(runtime,text,controller).then((artifact) => {
      if (controller.signal.aborted || runtime.pendingSupplement?.view.id !== pending.view.id || runtime.state.status !== "BRANCHING") return;
      runtime.speechAbort = null; this.#speechArtifacts.set(artifact.cacheKey, artifact);
      begin({ mode: "fish-audio", playing: true, epoch, unitId: null, text, startedAt: new Date().toISOString(), durationMs: artifact.provider === "test-tone" ? Math.min(5_000, artifact.durationMs) : artifact.durationMs, audioUrl: `/api/sessions/${encodeURIComponent(runtime.id)}/speech/${artifact.cacheKey}?epoch=${epoch}`, failure: null, segments: artifact.segments.map((segment) => ({ ...segment, semanticTargetIds: candidate.focusTargetIds })), provider: artifact.provider, model: artifact.model, voiceId: artifact.voiceId, firstAudioMs: artifact.firstAudioMs, synthesisMs: artifact.synthesisMs });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || runtime.pendingSupplement?.view.id !== pending.view.id || runtime.state.status !== "BRANCHING") return;
      runtime.speechAbort = null;
      begin({ ...emptySpeech(epoch), mode: "caption-fallback", playing: true, unitId: null, text, startedAt: new Date().toISOString(), durationMs: Math.max(this.#playbackUnitMs, candidate.speechText.length * 80), segments: [{ text, startMs: 0, endMs: Math.max(this.#playbackUnitMs, candidate.speechText.length * 80), semanticTargetIds: candidate.focusTargetIds }], failure: error instanceof Error ? error.message : "TTS failed", provider: this.#speechProvider?.provider ?? null, model: this.#speechProvider?.model ?? null, voiceId: this.#voiceId || null });
    });
  }

  #completeSupplement(runtime: RuntimeSession, pending: PendingSupplement) {
    runtime.timer = null; if (runtime.pendingSupplement?.view.id !== pending.view.id || runtime.state.status !== "BRANCHING") return;
    this.#discardSpeechArtifact(runtime); runtime.speech = { ...runtime.speech, playing: false, startedAt: null, audioUrl: null };
    this.#apply(runtime, { type: "SUPPLEMENT_COMPLETED", epoch: runtime.state.epoch });
    runtime.liveSupplement = runtime.liveSupplement ? { ...runtime.liveSupplement, status: "rejoining" } : null;
    for (const correction of pending.view.candidate?.corrections ?? []) runtime.boardCorrections.set(correction.targetId, { sceneId: pending.view.candidate!.sceneId, content: correction.content });
    this.#verifyRejoin(runtime, pending.view.origin);
    this.#apply(runtime, { type: "REJOIN_VERIFIED", epoch: runtime.state.epoch });
    runtime.liveSupplement = runtime.liveSupplement ? { ...runtime.liveSupplement, status: "completed" } : null;
    this.#questionAnswer.set(runtime,pending.view.candidate?.speechText ?? "");
    runtime.pendingSupplement = null; this.#restDirection(runtime); this.#publish(runtime); pending.onCompleted();
    if (runtime.assessmentId && runtime.lastAssessmentEvaluation?.assessmentId === runtime.assessmentId && runtime.lastAssessmentEvaluation.outcome === "correct") runtime.assessmentId = null;
    if (runtime.assessmentId) this.#apply(runtime, { type: "CHECKPOINT_PRESENTED", epoch: runtime.state.epoch }); else this.#schedule(runtime);
  }

  #verifyRejoin(runtime: RuntimeSession, origin: SupplementOriginView) {
    const completed = new Set(runtime.state.completedUnitIds); const unfinished = new Set(runtime.state.orderedUnitIds.filter((id) => !completed.has(id)));
    if (origin.unfinishedUnitIds.some((id) => !completed.has(id) && !unfinished.has(id))) throw new Error("A previously unfinished unit was lost during supplement rejoin");
    const next = runtime.course.teachingUnits.find((unit) => unit.id === runtime.state.activeUnitId);
    if (next && (!runtime.course.scenes.some((scene) => scene.id === next.sceneId) || next.focusTargetIds.some((id) => !runtime.course.semanticTargets.some((target) => target.id === id)))) throw new Error("The rejoin target is missing required presentation references");
  }

  #playTransient(runtime: RuntimeSession, text: string, targetIds: readonly string[], durationMs: number, started: (occurredAt: string, audible: boolean) => void, completed: () => void) {
    this.#restDirection(runtime);
    const epoch = runtime.state.epoch;
    const begin = (speech: FixedSessionView["speech"]) => { started(new Date().toISOString(), speech.mode !== "caption-fallback"); runtime.speech = speech; this.#publish(runtime); this.#waitForSpeech(runtime, speech, () => { runtime.timer = null; this.#discardSpeechArtifact(runtime); runtime.speech = { ...runtime.speech, playing: false, startedAt: null, audioUrl: null }; completed(); }); };
    if (!this.#speechProvider || !this.#voiceId) { begin({ ...emptySpeech(epoch), mode: "test", playing: true, unitId: null, text, startedAt: new Date().toISOString(), durationMs, segments: [{ text, startMs: 0, endMs: durationMs, semanticTargetIds: targetIds }] }); return; }
    runtime.speech = { ...emptySpeech(epoch), mode: "preparing", text }; this.#publish(runtime);
    const controller = new AbortController(); runtime.speechAbort = controller;
    void this.#speechProvider.synthesize({ text: applyPronunciationDictionary(text, runtime.course.pronunciationDictionary), language: "ja-JP", voiceId: this.#voiceId, dictionaryVersion: dictionaryVersion(runtime.course.pronunciationDictionary) }, { signal: controller.signal }).then((artifact) => {
      if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "BRANCHING") return;
      runtime.speechAbort = null; this.#speechArtifacts.set(artifact.cacheKey, artifact);
      begin({ mode: "fish-audio", playing: true, epoch, unitId: null, text, startedAt: new Date().toISOString(), durationMs: artifact.durationMs, audioUrl: `/api/sessions/${encodeURIComponent(runtime.id)}/speech/${artifact.cacheKey}?epoch=${epoch}`, failure: null, segments: artifact.segments.map((segment) => ({ ...segment, semanticTargetIds: targetIds })), provider: artifact.provider, model: artifact.model, voiceId: artifact.voiceId, firstAudioMs: artifact.firstAudioMs, synthesisMs: artifact.synthesisMs });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "BRANCHING") return;
      runtime.speechAbort = null; begin({ ...emptySpeech(epoch), mode: "caption-fallback", playing: true, unitId: null, text, startedAt: new Date().toISOString(), durationMs, segments: [{ text, startMs: 0, endMs: durationMs, semanticTargetIds: targetIds }], failure: error instanceof Error ? error.message : "TTS failed", provider: this.#speechProvider?.provider ?? null, model: this.#speechProvider?.model ?? null, voiceId: this.#voiceId || null });
    });
  }

  #discardSpeechArtifact(runtime: RuntimeSession) {
    const key = runtime.speech.audioUrl?.match(/\/speech\/([a-f0-9]{64})/)?.[1]; if (!key) return;
    const artifact = this.#speechArtifacts.get(key); if (!artifact) return; this.#speechArtifacts.delete(key);
    const existing = this.#retiredSpeechArtifacts.get(key); if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => this.#retiredSpeechArtifacts.delete(key), 10_000);
    this.#retiredSpeechArtifacts.set(key, { sessionId: runtime.id, epoch: runtime.speech.epoch, artifact, timer });
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
    this.#publish(runtime);
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

  #restDirection(runtime: RuntimeSession) {
    this.#drawingWait.delete(runtime);
    this.#stageNext.delete(runtime);
    const direction = this.#directions.get(runtime);
    if (direction) this.#directions.set(runtime, {...direction, actionId:randomUUID(), phase:"resting", traveling:false, targetId:null, gesture:"idle"});
  }

  /** Discard executable cues without forgetting where the stage was directed to settle. */
  #clearDirection(runtime: RuntimeSession) {
    this.#drawingWait.delete(runtime);
    const direction = this.#directions.get(runtime);
    if (direction) this.#lastStagePosition.set(runtime, direction.position);
    this.#directions.delete(runtime);
  }

  #cancelSpeech(runtime: RuntimeSession) {
    const projection = this.#projection.get(runtime); if (projection) clearTimeout(projection.timer); this.#projection.delete(runtime);
    this.#preparedSpeech.get(runtime)?.forEach(item=>item.controller.abort()); this.#preparedSpeech.delete(runtime);
    this.#prefetch.get(runtime)?.controller.abort(); this.#prefetch.delete(runtime);
    this.#boardSpeechStart.delete(runtime); this.#speechNext.delete(runtime); this.#stageNext.delete(runtime); this.#travelArrived.delete(runtime);
    this.#clearDirection(runtime);
    runtime.speechAbort?.abort(new DOMException("Lecture epoch changed", "AbortError"));
    runtime.speechAbort = null;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = null;
    this.#discardSpeechArtifact(runtime);
    runtime.speech = { ...runtime.speech, playing: false, startedAt: null, audioUrl: null };
    this.#publish(runtime);
  }

  #publish(runtime: RuntimeSession) {
    runtime.revision += 1;
    if (this.#listeners.size === 0) return;
    const snapshot = this.getSnapshot(runtime.id);
    this.#listeners.forEach((listener) => listener(runtime.id, snapshot));
  }

  #requireSession(sessionId: string): RuntimeSession {
    const runtime = this.#sessions.get(sessionId);
    if (!runtime) throw new RangeError(`Unknown session ${sessionId}`);
    return runtime;
  }
}

function speechOffsetMs(speech: FixedSessionView["speech"]): number {
  if (!speech.playing || !speech.startedAt) return 0;
  return Math.min(speech.durationMs, Math.max(0, Date.now() - Date.parse(speech.startedAt)));
}

function emptySpeech(epoch: number): FixedSessionView["speech"] {
  return { mode: "preparing", playing: false, epoch, unitId: null, text: null, startedAt: null, durationMs: 0, audioUrl: null, segments: [], failure: null, provider: null, model: null, voiceId: null, firstAudioMs: null, synthesisMs: null };
}

function dictionaryVersion(dictionary: ReadonlyCoursePackage["pronunciationDictionary"]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(dictionary)).digest("hex")}`;
}

export function applyPronunciationDictionary(text: string, dictionary: ReadonlyCoursePackage["pronunciationDictionary"]): string {
  // One pass prevents a short entry from changing a reading emitted by a longer one.
  // Course-specific readings take precedence over the shared technical vocabulary.
  const entries = new Map([
    ["Large Language Model", "ラージ・ランゲージ・モデル"],
    ["LLM", "エルエルエム"],
    ...dictionary.map(entry => [entry.surface, entry.reading] as [string, string]),
  ]);
  const surfaces = [...entries.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!surfaces.length) return text;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(surfaces.map(surface => `${/^[A-Za-z]/.test(surface) ? "(?<![A-Za-z0-9_])" : ""}${escape(surface)}${/[A-Za-z]$/.test(surface) ? "(?![A-Za-z0-9_])" : ""}`).join("|"), "giu");
  return text.replace(pattern, matched => entries.get(matched) ?? entries.get(surfaces.find(surface => surface.toLowerCase() === matched.toLowerCase())!) ?? matched);
}

function visibleStatus(status: LessonState["status"]): FixedSessionView["status"] {
  if (status === "ASSESSING" || status === "BRANCHING" || status === "REJOINING") return "TEACHING";
  if (status === "IDLE") return "PREPARING";
  return status;
}
