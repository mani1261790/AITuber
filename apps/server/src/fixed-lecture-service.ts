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
}

type SessionListener = (sessionId: string, snapshot: ClassroomSnapshot) => void;

export class FixedLectureService {
  readonly #planner: LessonPlanner | null;
  readonly #directions = new WeakMap<RuntimeSession, LessonDirectionView>();
  readonly #speechNext = new WeakMap<RuntimeSession, () => void>();
  readonly #stageNext = new WeakMap<RuntimeSession, () => void>();
  readonly #previousSpeech = new WeakMap<RuntimeSession, string>();
  readonly #prefetch = new WeakMap<RuntimeSession, { unitId: string; stamp: string; controller: AbortController; plan: Promise<DirectedPlan> }>();
  readonly #playbackDeadlines = new WeakMap<RuntimeSession, { deadline: number; complete: () => void; audioUrl: string | null; epoch: number }>();

  reportPlayback(sessionId: string, epoch: number, audioUrl: string, remainingMs: number) {
    const runtime = this.#requireSession(sessionId);
    const pending = this.#playbackDeadlines.get(runtime);
    if (!pending || runtime.state.epoch !== epoch || pending.epoch !== epoch || pending.audioUrl !== audioUrl || !runtime.timer || !runtime.speech.playing) return;
    if (!Number.isFinite(remainingMs) || remainingMs < 0 || remainingMs > runtime.speech.durationMs + 30_000) return;
    const deadline = Date.now() + remainingMs + 850;
    if (deadline <= pending.deadline) return;
    pending.deadline = deadline;
    clearTimeout(runtime.timer);
    runtime.timer = setTimeout(pending.complete, Math.max(1, deadline-Date.now()));
  }

  #waitForSpeech(runtime: RuntimeSession, speech: FixedSessionView["speech"], complete: () => void) {
    const delay = Math.max(1,speech.durationMs)+(speech.provider === "fish-audio" ? 850 : 0);
    this.#playbackDeadlines.set(runtime,{deadline: Date.now()+delay,complete,audioUrl:speech.audioUrl,epoch:speech.epoch});
    runtime.timer = setTimeout(complete,delay);
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
  }) {
    this.#planner = options.planner ?? null;
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

  registerCourse(course: ReadonlyCoursePackage): void {
    if (course.status !== "available") throw new TypeError("Only an available Course Package can be registered");
    this.#courses.set(course.id, course);
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
    if (!new Set(["TEACHING", "BRANCHING"]).has(runtime.state.status) || runtime.liveSupplement && !new Set(["completed", "deferred"]).has(runtime.liveSupplement.status)) throw new TypeError("The lecture is not ready for another live supplement");
    runtime.liveSupplement = { ...view, status: options.interrupt && options.bridgeText ? "bridging" : "preparing" };
    if (options.interrupt) {
      this.#cancelSpeech(runtime);
      if (runtime.state.status === "TEACHING") this.#apply(runtime, { type: "QUESTION_ACCEPTED", epoch: runtime.state.epoch });
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

  queueSupplement(sessionId: string, view: LiveSupplementView, callbacks: Pick<PendingSupplement, "onPlaybackStarted" | "onCompleted">): void {
    const runtime = this.#requireSession(sessionId);
    if (!runtime.liveSupplement || runtime.liveSupplement.id !== view.id) throw new TypeError("Unknown active live supplement");
    runtime.liveSupplement = { ...view, firstAudioAt: runtime.liveSupplement.firstAudioAt ?? view.firstAudioAt, status: runtime.liveSupplement.status === "bridging" ? "bridging" : "ready" };
    runtime.pendingSupplement = { view, ...callbacks };
    this.#publish(runtime);
    if (runtime.state.status === "BRANCHING" && !runtime.speech.playing && !runtime.speechAbort && !runtime.timer) this.#activateSupplement(runtime);
    else if (runtime.state.status === "TEACHING" && !runtime.timer && !runtime.speech.playing && !runtime.speechAbort) this.#activateSupplement(runtime);
  }

  deferSupplement(sessionId: string, view: LiveSupplementView): void {
    const runtime = this.#requireSession(sessionId);
    runtime.pendingSupplement = null;
    runtime.liveSupplement = { ...view, status: "deferred" };
    if (runtime.state.status === "BRANCHING") {
      if (runtime.timer || runtime.speech.playing) this.#cancelSpeech(runtime);
      this.#apply(runtime, { type: "QUESTION_DEFERRED", epoch: runtime.state.epoch });
      this.#schedule(runtime);
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
      if (runtime.state.status === "BRANCHING" && runtime.pendingSupplement) this.#activateSupplement(runtime); else this.#schedule(runtime);
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
      const supplementRequired = request.assessmentEvaluation?.outcome === "incorrect";
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
    this.#directions.set(runtime,{ actionId: randomUUID(), phase:"planning", position:previous?.position ?? "right", targetId:null, camera:previous?.camera ?? "lecture",source:"reference",reason:null });
    runtime.speech = { ...emptySpeech(epoch),unitId:unit.id }; this.#publish(runtime);
    const prefetched = this.#prefetch.get(runtime); this.#prefetch.delete(runtime);
    let plan: DirectedPlan;
    try {
      if (prefetched?.unitId === unit.id && prefetched.stamp === this.#contextStamp(runtime)) {
        controller.signal.addEventListener("abort",()=>prefetched.controller.abort(),{once:true});
        plan = await prefetched.plan;
      } else {
        prefetched?.controller.abort();
        plan = await this.#planner!({session:this.getSession(runtime.id),unit,previousSpeech:this.#previousSpeech.get(runtime) ?? "",remainingMs:this.getRemainingTimeMs(runtime.id)},controller.signal);
      }
    } catch (error) { if (controller.signal.aborted) return; plan = referencePlan(unit,error instanceof Error ? error.message : "台本生成失敗"); }
    if (controller.signal.aborted || runtime.state.epoch !== epoch || runtime.state.status !== "TEACHING") return;
    runtime.speechAbort = null;
    const stored = this.#store.getSession(runtime.id);
    this.#store.appendEvent({eventId:`event.${randomUUID()}`,sessionId:runtime.id,coursePackageId:runtime.course.id,coursePackageVersion:runtime.course.version,epoch:stored.epoch,seq:stored.lastSeq+1,occurredAt:new Date().toISOString(),type:"lesson.direction-planned",payload:{unitId:unit.id,source:plan.source,reason:plan.reason,actions:plan.actions}});
    const base = this.#directions.get(runtime)!;
    this.#directions.set(runtime,{...base,source:plan.source,reason:plan.reason});
    const spoken = plan.actions.filter(action=>action.type === "speak").map(action=>action.text).join(" ");
    const nextId = runtime.state.orderedUnitIds[runtime.state.orderedUnitIds.indexOf(unit.id)+1];
    const nextUnit = runtime.course.teachingUnits.find(candidate=>candidate.id === nextId);
    if (nextUnit && !runtime.course.assessments.some(assessment=>assessment.afterUnitId === unit.id)) {
      const nextController = new AbortController();
      const promise = this.#planner!({session:this.getSession(runtime.id),unit:nextUnit,previousSpeech:spoken,remainingMs:this.getRemainingTimeMs(runtime.id)},nextController.signal).catch(()=>referencePlan(nextUnit,"先読みを再利用できませんでした"));
      this.#prefetch.set(runtime,{unitId:nextUnit.id,stamp:this.#contextStamp(runtime),controller:nextController,plan:promise});
    }
    this.#runAction(runtime,unit.id,epoch,plan.actions,0);
  }

  completeStageAction(sessionId: string, epoch: number, actionId: string) {
    const runtime = this.#requireSession(sessionId);
    if (runtime.state.epoch !== epoch || this.#directions.get(runtime)?.actionId !== actionId || !runtime.timer) return;
    const next = this.#stageNext.get(runtime); if (!next) return;
    clearTimeout(runtime.timer); runtime.timer = null; this.#stageNext.delete(runtime); next();
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
    const update = (changes: Partial<LessonDirectionView>) => { this.#directions.set(runtime,{...direction,actionId:randomUUID(),...changes}); this.#publish(runtime); };
    const wait = (ms: number) => { runtime.timer = setTimeout(()=>{runtime.timer=null;this.#stageNext.delete(runtime);next();},ms); };
    switch(action.type) {
      case "move_to":
        // Projection stays unobstructed; semantic positions are resolved by the stage.
        update({phase:"moving",position:action.position,targetId:null});
        this.#stageNext.set(runtime,next); wait(12000); return;
      case "point_at": update({phase:"pointing",targetId:action.targetId}); wait(550); return;
      case "camera": update({camera:action.view === "board" ? "lecture" : action.view,phase:"resting"}); wait(100); return;
      case "release_point": update({targetId:null,phase:"resting"}); wait(350); return;
      case "pause": update({phase:"resting"}); wait(action.durationMs); return;
      case "speak":
        update({phase:"speaking"}); this.#previousSpeech.set(runtime,((this.#previousSpeech.get(runtime) ?? "")+" "+action.text).slice(-2000));
        this.#speechNext.set(runtime,next); this.#speakUnit(runtime,unitId,action.text); return;
    }
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
    void this.#speechProvider.synthesize({
      text: finalizedText,
      language: "ja-JP",
      voiceId: this.#voiceId,
      dictionaryVersion: dictionaryVersion(runtime.course.pronunciationDictionary),
    }, { signal: controller.signal }).then((artifact) => {
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
      this.#startPlayback(runtime, unitId, epoch, {
        mode: "caption-fallback", playing: true, epoch, unitId, text: finalizedText, startedAt: new Date().toISOString(), durationMs: unit.estimatedDurationMs, audioUrl: null,
        segments: [{ text: finalizedText, startMs: 0, endMs: unit.estimatedDurationMs, semanticTargetIds: unit.focusTargetIds }],
        failure: error instanceof Error ? error.message : "TTS failed",
        provider: this.#speechProvider?.provider ?? null, model: this.#speechProvider?.model ?? null, voiceId: this.#voiceId || null, firstAudioMs: null, synthesisMs: null,
      });
    });
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
    if (runtime.state.status === "TEACHING") this.#apply(runtime, { type: "QUESTION_ACCEPTED", epoch: runtime.state.epoch });
    if (runtime.state.status !== "BRANCHING") return;
    this.#directions.delete(runtime);
    this.#prefetch.get(runtime)?.controller.abort(); this.#prefetch.delete(runtime);
    const candidate = pending.view.candidate;
    runtime.liveSupplement = { ...pending.view, status: "playing" };
    this.#publish(runtime);
    this.#playSupplementSpeech(runtime, candidate, pending);
  }

  #playSupplementSpeech(runtime: RuntimeSession, candidate: LiveSupplementCandidateView, pending: PendingSupplement) {
    const text = applyPronunciationDictionary(candidate.speechText, runtime.course.pronunciationDictionary); const epoch = runtime.state.epoch;
    const begin = (speech: FixedSessionView["speech"]) => {
      const occurredAt = new Date().toISOString(); const audible = speech.mode !== "caption-fallback"; pending.onPlaybackStarted(occurredAt, audible);
      runtime.liveSupplement = runtime.liveSupplement ? { ...runtime.liveSupplement, firstAudioAt: runtime.liveSupplement.firstAudioAt ?? (audible ? occurredAt : null) } : null;
      runtime.speech = speech; this.#publish(runtime);
      this.#waitForSpeech(runtime, speech, () => this.#completeSupplement(runtime, pending));
    };
    if (!this.#speechProvider || !this.#voiceId) { begin({ ...emptySpeech(epoch), mode: "test", playing: true, unitId: null, text, startedAt: new Date().toISOString(), durationMs: this.#playbackUnitMs, segments: [{ text, startMs: 0, endMs: this.#playbackUnitMs, semanticTargetIds: candidate.focusTargetIds }] }); return; }
    runtime.speech = { ...emptySpeech(epoch), mode: "preparing", text, segments: [{ text, startMs: 0, endMs: candidate.speechText.length * 80, semanticTargetIds: candidate.focusTargetIds }] }; this.#publish(runtime);
    const controller = new AbortController(); runtime.speechAbort = controller;
    void this.#speechProvider.synthesize({ text, language: "ja-JP", voiceId: this.#voiceId, dictionaryVersion: dictionaryVersion(runtime.course.pronunciationDictionary) }, { signal: controller.signal }).then((artifact) => {
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
    runtime.pendingSupplement = null; this.#publish(runtime); pending.onCompleted();
    if (runtime.assessmentId) this.#apply(runtime, { type: "CHECKPOINT_PRESENTED", epoch: runtime.state.epoch }); else this.#schedule(runtime);
  }

  #verifyRejoin(runtime: RuntimeSession, origin: SupplementOriginView) {
    const completed = new Set(runtime.state.completedUnitIds); const unfinished = new Set(runtime.state.orderedUnitIds.filter((id) => !completed.has(id)));
    if (origin.unfinishedUnitIds.some((id) => !completed.has(id) && !unfinished.has(id))) throw new Error("A previously unfinished unit was lost during supplement rejoin");
    const next = runtime.course.teachingUnits.find((unit) => unit.id === runtime.state.activeUnitId);
    if (next && (!runtime.course.scenes.some((scene) => scene.id === next.sceneId) || next.focusTargetIds.some((id) => !runtime.course.semanticTargets.some((target) => target.id === id)))) throw new Error("The rejoin target is missing required presentation references");
  }

  #playTransient(runtime: RuntimeSession, text: string, targetIds: readonly string[], durationMs: number, started: (occurredAt: string, audible: boolean) => void, completed: () => void) {
    this.#directions.delete(runtime);
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

  #cancelSpeech(runtime: RuntimeSession) {
    this.#prefetch.get(runtime)?.controller.abort(); this.#prefetch.delete(runtime);
    this.#speechNext.delete(runtime); this.#stageNext.delete(runtime);
    this.#directions.delete(runtime);
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
  return [...dictionary].sort((left, right) => right.surface.length - left.surface.length).reduce(
    (result, entry) => result.replaceAll(entry.surface, entry.reading), text,
  );
}

function visibleStatus(status: LessonState["status"]): FixedSessionView["status"] {
  if (status === "ASSESSING" || status === "BRANCHING" || status === "REJOINING") return "TEACHING";
  if (status === "IDLE") return "PREPARING";
  return status;
}
