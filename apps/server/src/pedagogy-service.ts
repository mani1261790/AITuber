import type { AssessmentEvaluationView, FixedSessionView, LearningEvidenceSummaryView, ReadonlyCoursePackage, SubmitLearningEvidenceRequest } from "@aituber/contracts";
import type { LearningEvidenceStore, StoredEvidenceJudgment, StoredLearningEvidence } from "@aituber/storage";
import type { FixedLectureService } from "./fixed-lecture-service.ts";
import type { QuestionQueueService } from "./question-queue-service.ts";

export class PedagogyService {
  readonly #store: LearningEvidenceStore;
  readonly #lecture: FixedLectureService;
  readonly #questions: QuestionQueueService;

  constructor(options: { readonly store: LearningEvidenceStore; readonly lecture: FixedLectureService; readonly questions: QuestionQueueService }) {
    this.#store = options.store; this.#lecture = options.lecture; this.#questions = options.questions;
  }

  recordQuestion(input: { readonly sessionId: string; readonly participantId: string; readonly semanticTargetId: string; readonly text: string; readonly submittedAt: string }): void {
    const session = this.#lecture.getSession(input.sessionId); const scopeId = scopeForTarget(session, input.semanticTargetId);
    this.#store.record({ sessionId: input.sessionId, participantId: input.participantId, kind: "learner-question", scopeId, assessmentId: null, semanticTargetId: input.semanticTargetId, observedValue: input.text, automaticJudgment: "support", finalJudgment: "support", rationale: "学習者が対象を指定して質問したため、支援希望として記録しました。", correction: null, linkedSupplementId: null, recordedAt: input.submittedAt });
    this.#refresh(input.sessionId);
  }

  submitEvidence(input: { readonly sessionId: string; readonly participantId: string; readonly request: SubmitLearningEvidenceRequest }): FixedSessionView {
    validateEvidenceRequest(input.request); const session = this.#lecture.getSession(input.sessionId); validateTarget(session, input.request.sceneId, input.request.semanticTargetId);
    const judgment = evidenceJudgment(input.request.kind, input.request.value);
    this.#store.record({ sessionId: input.sessionId, participantId: input.participantId, kind: input.request.kind, scopeId: scopeForTarget(session, input.request.semanticTargetId), assessmentId: null, semanticTargetId: input.request.semanticTargetId, observedValue: input.request.value, automaticJudgment: judgment, finalJudgment: judgment, rationale: evidenceRationale(input.request.value), correction: null, linkedSupplementId: null });
    this.#refresh(input.sessionId);
    if (input.request.value === "need-help" || input.request.value === "recheck") {
      const target = session.course.semanticTargets.find((item) => item.id === input.request.semanticTargetId)!;
      this.#questions.submitPedagogyTrigger({ sessionId: input.sessionId, sceneId: input.request.sceneId, semanticTargetId: input.request.semanticTargetId, text: `${target.label}について、学習者が${input.request.value === "need-help" ? "支援を求めています" : "再確認を求めています"}。教材に沿って短く補足してください。` });
    }
    return this.#lecture.getSession(input.sessionId);
  }

  answer(input: { readonly sessionId: string; readonly participantId: string; readonly answer: string }): FixedSessionView {
    if (typeof input.answer !== "string" || !input.answer.trim() || input.answer.length > 2_000) throw new TypeError("回答は1〜2000文字で入力してください。");
    const session = this.#lecture.getSession(input.sessionId); const assessment = session.assessment;
    if (session.status !== "CHECKPOINT" || !assessment) throw new TypeError("The session is not waiting for an answer");
    const result = evaluate(assessment, input.answer); const linkedSupplementId = session.liveSupplement?.status === "completed" ? session.liveSupplement.id : null;
    const records = assessment.learningGoalIds.map((scopeId) => this.#store.record({ sessionId: input.sessionId, participantId: input.participantId, kind: "checkpoint-answer", scopeId, assessmentId: assessment.id, semanticTargetId: null, observedValue: input.answer.trim(), automaticJudgment: result.judgment, finalJudgment: result.judgment, rationale: result.rationale, correction: null, linkedSupplementId }));
    const evaluation: AssessmentEvaluationView = { evidenceId: records[0]!.id, assessmentId: assessment.id, answer: input.answer.trim(), outcome: result.judgment === "confirmed" ? "correct" : result.judgment === "struggle" ? "incorrect" : "unknown", rationale: result.rationale, automaticJudgment: publicJudgment(result.judgment), finalJudgment: publicJudgment(result.judgment), correction: null, linkedSupplementId, recordedAt: records[0]!.recordedAt };
    if (result.judgment === "struggle") {
      const unit = session.course.teachingUnits.find((item) => item.id === assessment.afterUnitId)!; const targetId = unit.focusTargetIds[0]!;
      this.#questions.submitPedagogyTrigger({ sessionId: input.sessionId, sceneId: unit.sceneId, semanticTargetId: targetId, text: `確認問題「${assessment.prompt}」への回答「${input.answer.trim()}」にはつまずきがありました。${assessment.rubric.commonMistakes.join("、")}を避け、教材に沿って考え方を補足してください。` });
    }
    this.#lecture.updateLearningEvidence(input.sessionId, this.#summaries(session), evaluation);
    return this.#lecture.command(input.sessionId, { command: "answer", answer: input.answer.trim(), assessmentEvaluation: evaluation });
  }

  #refresh(sessionId: string) { const session = this.#lecture.getSession(sessionId); this.#lecture.updateLearningEvidence(sessionId, this.#summaries(session)); }
  #summaries(session: FixedSessionView): readonly LearningEvidenceSummaryView[] { const evidence = this.#store.list(session.id); return session.course.learningGoals.map((goal) => summarize(goal.id, goal.description, evidence.filter((item) => item.scopeId === goal.id))); }
}

function evaluate(assessment: ReadonlyCoursePackage["assessments"][number], rawAnswer: string): { readonly judgment: StoredEvidenceJudgment; readonly rationale: string } {
  const answer = normalize(rawAnswer); if (!answer) return { judgment: "unknown", rationale: "回答は観測されていません。" };
  if (assessment.responseKind === "multiple-choice") {
    const expected = assessment.options.find((option) => assessment.rubric.criteria.some((criterion) => normalize(criterion).includes(normalize(option))));
    if (!expected) return { judgment: "unknown", rationale: "ルーブリックから正答選択肢を確定できませんでした。" };
    return normalize(expected) === answer ? { judgment: "confirmed", rationale: "回答がルーブリックの正答選択肢と一致しました。" } : { judgment: "struggle", rationale: "回答がルーブリックの正答選択肢と一致しませんでした。" };
  }
  if (assessment.rubric.commonMistakes.some((mistake) => matchesStatement(rawAnswer, mistake))) return { judgment: "struggle", rationale: "回答が教材に登録された典型的な誤りと一致しました。" };
  const matched = assessment.rubric.criteria.some((criterion) => matchesStatement(rawAnswer, criterion));
  return matched ? { judgment: "confirmed", rationale: "回答内容がこの問題のルーブリック条件に一致しました。" } : { judgment: "struggle", rationale: "回答内容をこの問題のルーブリック条件で確認できませんでした。" };
}

function summarize(scopeId: string, label: string, evidence: readonly StoredLearningEvidence[]): LearningEvidenceSummaryView {
  const meaningful = evidence.filter((item) => item.finalJudgment !== "unknown"); const last = meaningful.at(-1);
  let state: LearningEvidenceSummaryView["state"] = "unconfirmed";
  if (last?.kind === "checkpoint-answer" && last.linkedSupplementId && last.finalJudgment === "confirmed") state = "confirmed-for-item";
  else if (meaningful.some((item) => item.finalJudgment === "confirmed") && meaningful.some((item) => item.finalJudgment === "struggle")) state = "conflicting";
  else if (last?.finalJudgment === "confirmed") state = "confirmed-for-item";
  else if (last?.finalJudgment === "struggle") state = "struggle-evidence";
  else if (last?.finalJudgment === "support") state = "support-requested";
  return { scopeId, label, state, evidenceCount: evidence.length, lastEvidenceAt: evidence.at(-1)?.recordedAt ?? null };
}

function scopeForTarget(session: FixedSessionView, targetId: string): string { return session.course.teachingUnits.find((unit) => unit.focusTargetIds.includes(targetId))?.learningGoalIds[0] ?? session.course.learningGoals[0]!.id; }
function validateTarget(session: FixedSessionView, sceneId: string, targetId: string) { const target = session.course.semanticTargets.find((item) => item.id === targetId); if (!target || target.sceneId !== sceneId) throw new TypeError("証拠の対象が現在の教材に存在しません。"); }
function validateEvidenceRequest(request: SubmitLearningEvidenceRequest) { if (!new Set(["self-report", "explicit-action"]).has(request.kind) || !new Set(["understood", "need-help", "recheck", "target-selected"]).has(request.value)) throw new TypeError("学習証拠の種類または値が不正です。"); if (request.kind === "explicit-action" && request.value !== "target-selected" || request.kind === "self-report" && request.value === "target-selected") throw new TypeError("学習証拠の種類と値が一致しません。"); }
function evidenceJudgment(kind: SubmitLearningEvidenceRequest["kind"], value: SubmitLearningEvidenceRequest["value"]): StoredEvidenceJudgment { if (value === "need-help") return "support"; if (value === "recheck") return "struggle"; return kind === "explicit-action" ? "unknown" : "unknown"; }
function evidenceRationale(value: SubmitLearningEvidenceRequest["value"]): string { return value === "understood" ? "理解できたという自己申告です。問題への正答には置き換えません。" : value === "need-help" ? "学習者が明示的に支援を求めました。" : value === "recheck" ? "学習者が明示的に再確認を求めました。" : "学習者が質問対象を明示的に選択しました。理解済みとは扱いません。"; }
function publicJudgment(value: StoredEvidenceJudgment): AssessmentEvaluationView["automaticJudgment"] { return value === "support" ? "unknown" : value; }
function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replaceAll(/[^\p{L}\p{N}-]/gu, ""); }
function matchesStatement(rawAnswer: string, statement: string): boolean { const expectedNumbers = numbers(statement); if (expectedNumbers.length) { const actualNumbers = numbers(rawAnswer); return expectedNumbers.every((number) => actualNumbers.includes(number)); } const answer = normalize(rawAnswer); return answer.length >= 3 && normalize(statement).includes(answer); }
function numbers(value: string): readonly string[] { return value.normalize("NFKC").match(/-?\d+(?:\.\d+)?/g) ?? []; }
