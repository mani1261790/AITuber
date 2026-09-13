import type { ClassroomQuestionView, FixedSessionView, SubmitQuestionRequest } from "@aituber/contracts";
import type { QuestionStore, StoredQuestionThread } from "@aituber/storage";

export interface QuestionSessionContext { readonly session: FixedSessionView; readonly remainingMs: number }

export class QuestionQueueService {
  readonly #store: QuestionStore;
  readonly #context: (sessionId: string) => QuestionSessionContext;
  readonly #onQuestion: ((input: { readonly sessionId: string; readonly participantId: string; readonly semanticTargetId: string; readonly text: string; readonly submittedAt: string }) => void) | null;
  readonly #listeners = new Set<(sessionId: string, questions: readonly ClassroomQuestionView[]) => void>();
  constructor(options: { store: QuestionStore; context(sessionId: string): QuestionSessionContext; onQuestion?: (input: { readonly sessionId: string; readonly participantId: string; readonly semanticTargetId: string; readonly text: string; readonly submittedAt: string }) => void }) { this.#store = options.store; this.#context = options.context; this.#onQuestion = options.onQuestion ?? null; }

  submit(input: { readonly sessionId: string; readonly participantId: string; readonly request: SubmitQuestionRequest; readonly submittedAt?: string }): { readonly question: ClassroomQuestionView; readonly questions: readonly ClassroomQuestionView[] } {
    const text = boundedQuestion(input.request.text); const now = input.submittedAt ?? new Date().toISOString();
    const context = this.#context(input.sessionId); const course = context.session.course;
    const scene = course.scenes.find((item) => item.id === input.request.sceneId);
    const target = course.semanticTargets.find((item) => item.id === input.request.semanticTargetId);
    if (!scene || !target || target.sceneId !== scene.id || !scene.targetIds.includes(target.id)) throw new TypeError("質問対象が現在の教材に存在しません。");
    const normalizedIntent = normalizeIntent(text);
    const duplicate = this.#store.listOpen(input.sessionId).find((item) => item.semanticTargetId === target.id && sameIntent(item.normalizedIntent, normalizedIntent));
    const lastCompletedUnitId = context.session.completedUnitIds.at(-1) ?? null;
    const recorded = duplicate
      ? this.#store.support(duplicate.id, input.participantId, text, now)
      : this.#store.create({ sessionId: input.sessionId, participantId: input.participantId, coursePackageId: course.id, coursePackageVersion: course.version, sceneId: scene.id, semanticTargetId: target.id, lastCompletedUnitId, text, normalizedIntent, submittedAt: now });
    this.#onQuestion?.({ sessionId: input.sessionId, participantId: input.participantId, semanticTargetId: target.id, text, submittedAt: now });
    const questions = this.#classify(input.sessionId, context, now);
    const question = questions.find((item) => item.id === recorded.id)!;
    this.#listeners.forEach((listener) => listener(input.sessionId, questions));
    return { question, questions };
  }

  submitPedagogyTrigger(input: { readonly sessionId: string; readonly text: string; readonly sceneId: string; readonly semanticTargetId: string; readonly submittedAt?: string }): ClassroomQuestionView {
    const context = this.#context(input.sessionId); const course = context.session.course; const now = input.submittedAt ?? new Date().toISOString();
    const scene = course.scenes.find((item) => item.id === input.sceneId); const target = course.semanticTargets.find((item) => item.id === input.semanticTargetId);
    if (!scene || !target || target.sceneId !== scene.id) throw new TypeError("教授判断の対象が教材に存在しません。");
    const recorded = this.#store.create({ sessionId: input.sessionId, participantId: "system.pedagogy", coursePackageId: course.id, coursePackageVersion: course.version, sceneId: scene.id, semanticTargetId: target.id, lastCompletedUnitId: context.session.completedUnitIds.at(-1) ?? null, text: boundedQuestion(input.text), normalizedIntent: normalizeIntent(input.text), submittedAt: now, origin: "pedagogy-trigger" });
    const questions = this.#classify(input.sessionId, context, now); this.#listeners.forEach((listener) => listener(input.sessionId, questions));
    return questions.find((question) => question.id === recorded.id)!;
  }

  list(sessionId: string): readonly ClassroomQuestionView[] { return sortQuestions(this.#store.list(sessionId).map(toView)); }
  subscribe(listener: (sessionId: string, questions: readonly ClassroomQuestionView[]) => void) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  markAnswering(id: string): void { const question = this.#store.updateProcessing(id, "answering"); this.#notify(question.sessionId); }
  markAnswered(id: string): void { const question = this.#store.resolve(id, "answered", "授業中に回答しました。"); this.#reclassifyAndNotify(question.sessionId); }
  markPostClassAnswered(id: string): void { const question = this.#store.resolve(id, "answered", "授業後の審査済み回答を公開しました。"); this.#reclassifyAndNotify(question.sessionId); }
  defer(id: string, reason: string): void { const question = this.#store.resolve(id, "deferred", reason); this.#reclassifyAndNotify(question.sessionId); }
  promoteForClosing(sessionId: string): boolean {
    const context = this.#context(sessionId); if (context.remainingMs < 20_000) return false;
    const selected = this.list(sessionId).find((question) => question.resolution === "pending" && question.status === "accepted"); if (!selected) return false;
    this.#store.updateClassifications([{ id: selected.id, disposition: "answer-now", reason: "授業末の残り時間で重要な保留質問へ回答します。", priority: { ...selected.priority, remainingMs: context.remainingMs }, updatedAt: new Date().toISOString() }]);
    this.#notify(sessionId); return true;
  }

  #classify(sessionId: string, context: QuestionSessionContext, now: string): readonly ClassroomQuestionView[] {
    const open = this.#store.listOpen(sessionId); const course = context.session.course; const activeUnit = course.teachingUnits.find((unit) => unit.id === context.session.currentUnitId) ?? null;
    const activeScheduleIndex = context.session.currentUnitId ? course.schedule.orderedUnitIds.indexOf(context.session.currentUnitId) : -1;
    const nextUnitId = activeScheduleIndex >= 0 ? course.schedule.orderedUnitIds[activeScheduleIndex + 1] : undefined;
    const nextUnit = course.teachingUnits.find((unit) => unit.id === nextUnitId) ?? null;
    const participantOpenCounts = new Map<string, number>();
    open.forEach((question) => question.participantIds.forEach((id) => participantOpenCounts.set(id, (participantOpenCounts.get(id) ?? 0) + 1)));
    const ranked = open.map((question) => {
      const focusedUnits = course.teachingUnits.filter((unit) => unit.focusTargetIds.includes(question.semanticTargetId));
      const relatedUnits = focusedUnits.length ? focusedUnits : course.teachingUnits.filter((unit) => unit.sceneId === question.sceneId);
      const currentGoalRelated = Boolean(activeUnit && relatedUnits.some((unit) => unit.learningGoalIds.some((goal) => activeUnit.learningGoalIds.includes(goal))));
      const prerequisiteForNext = Boolean(nextUnit && relatedUnits.some((unit) => nextUnit.prerequisiteUnitIds.includes(unit.id)));
      const waitedMs = Math.max(0, Date.parse(now) - Date.parse(question.submittedAt));
      const repeatPenalty = Math.max(0, Math.min(...question.participantIds.map((id) => participantOpenCounts.get(id) ?? 1)) - 2) * 24;
      const score = (prerequisiteForNext ? 50 : 0) + (currentGoalRelated ? 30 : 0) + question.supporterCount * 12 + Math.min(30, waitedMs / 60_000) - repeatPenalty;
      return { question, priority: { score: Math.round(score * 100) / 100, currentGoalRelated, prerequisiteForNext, supporterCount: question.supporterCount, waitedMs, remainingMs: context.remainingMs } };
    }).sort((left, right) => right.priority.score - left.priority.score || left.question.submittedAt.localeCompare(right.question.submittedAt) || left.question.id.localeCompare(right.question.id));
    const canAnswerNow = context.session.status !== "FINISHED" && context.remainingMs >= 20_000;
    this.#store.updateClassifications(ranked.map(({ question, priority }, index) => {
      const disposition = canAnswerNow && index === 0 ? "answer-now" as const : "after-class" as const;
      const reason = disposition === "answer-now" ? answerNowReason(priority) : afterClassReason(canAnswerNow, context.session.status === "FINISHED", index, priority);
      return { id: question.id, disposition, reason, priority, updatedAt: now };
    }));
    return this.list(sessionId);
  }

  #notify(sessionId: string) { const questions = this.list(sessionId); this.#listeners.forEach((listener) => listener(sessionId, questions)); }
  #reclassifyAndNotify(sessionId: string) { const context = this.#context(sessionId); const questions = this.#classify(sessionId, context, new Date().toISOString()); this.#listeners.forEach((listener) => listener(sessionId, questions)); }
}

function boundedQuestion(value: string): string { const text = typeof value === "string" ? value.trim().replaceAll(/\s+/g, " ") : ""; if (!text || text.length > 1_000) throw new TypeError("質問は1〜1000文字で入力してください。"); return text; }
export function normalizeIntent(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/(?:について|を|は|が|の)?(?:教えて|説明して|知りたい|わからない|分からない)(?:ください|下さい)?/g, "").replaceAll(/[\s\p{P}\p{S}]/gu, ""); }
export function sameIntent(left: string, right: string): boolean { if (left === right) return true; if (Math.min(left.length, right.length) < 4) return false; const leftPairs = pairs(left); const rightPairs = pairs(right); let overlap = 0; const remaining = new Map<string, number>(); leftPairs.forEach((pair) => remaining.set(pair, (remaining.get(pair) ?? 0) + 1)); rightPairs.forEach((pair) => { const count = remaining.get(pair) ?? 0; if (count > 0) { overlap += 1; remaining.set(pair, count - 1); } }); return (2 * overlap) / (leftPairs.length + rightPairs.length) >= 0.72; }
function pairs(value: string): string[] { return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)); }
function answerNowReason(priority: StoredQuestionThread["priority"]): string { if (priority.prerequisiteForNext) return "次の説明に必要な前提なので、授業中に回答します。"; if (priority.currentGoalRelated) return "現在の学習目標に近いため、授業中に回答します。"; if (priority.supporterCount > 1) return `${priority.supporterCount}人から同じ質問があるため、授業中に回答します。`; return "次の区切りで授業中に回答します。"; }
function afterClassReason(canAnswerNow: boolean, finished: boolean, index: number, priority: StoredQuestionThread["priority"]): string { if (finished) return "講義が終了しているため、授業後に回答します。"; if (!canAnswerNow) return "授業の残り時間が少ないため、授業後に回答します。"; if (index > 0) return `他の質問との優先度と残り時間を比較し、授業後に回答します。${priority.supporterCount > 1 ? ` 同じ質問は${priority.supporterCount}人です。` : ""}`; return "授業後に回答します。"; }
function toView(question: StoredQuestionThread): ClassroomQuestionView { return { id: question.id, text: question.text, coursePackageId: question.coursePackageId, coursePackageVersion: question.coursePackageVersion, sceneId: question.sceneId, semanticTargetId: question.semanticTargetId, lastCompletedUnitId: question.lastCompletedUnitId, submittedAt: question.submittedAt, updatedAt: question.updatedAt, supporterCount: question.supporterCount, status: question.status, resolution: question.resolution, disposition: question.disposition, reason: question.reason, priority: question.priority, origin: question.origin }; }
function sortQuestions(questions: readonly ClassroomQuestionView[]) { return [...questions].sort((left, right) => Number(right.disposition === "answer-now") - Number(left.disposition === "answer-now") || right.priority.score - left.priority.score || left.submittedAt.localeCompare(right.submittedAt)); }
