import type { ReadonlyCoursePackage } from "./course-package.ts";

export interface CourseSummary {
  readonly id: string;
  readonly title: string;
  readonly targetLevel: string;
  readonly durationMinutes: number;
  readonly learningGoals: readonly { readonly id: string; readonly description: string }[];
}

export interface FixedSessionView {
  readonly id: string;
  readonly course: ReadonlyCoursePackage;
  readonly configuredDurationMinutes: number;
  readonly status: "PREPARING" | "TEACHING" | "CHECKPOINT" | "PAUSED" | "RECOVERING" | "FINISHED";
  readonly epoch: number;
  readonly completedUnitIds: readonly string[];
  readonly unfinishedUnitIds: readonly string[];
  readonly currentUnitId: string | null;
  readonly displayUnitId: string | null;
  readonly progress: { readonly completed: number; readonly total: number };
  readonly assessment: ReadonlyCoursePackage["assessments"][number] | null;
  readonly speech: SessionSpeechView;
  readonly liveSupplement: LiveSupplementView | null;
  readonly boardCorrections: readonly { readonly sceneId: string; readonly targetId: string; readonly content: string }[];
  readonly learningEvidence: readonly LearningEvidenceSummaryView[];
  readonly lastAssessmentEvaluation: AssessmentEvaluationView | null;
  readonly afterClassAnswers: readonly AfterClassAnswerView[];
}

export type LearningEvidenceState = "unconfirmed" | "support-requested" | "struggle-evidence" | "confirmed-for-item" | "conflicting";
export type LearningEvidenceKind = "learner-question" | "checkpoint-answer" | "self-report" | "explicit-action";
export interface LearningEvidenceSummaryView {
  readonly scopeId: string;
  readonly label: string;
  readonly state: LearningEvidenceState;
  readonly evidenceCount: number;
  readonly lastEvidenceAt: string | null;
}
export interface AssessmentEvaluationView {
  readonly evidenceId: string;
  readonly assessmentId: string;
  readonly answer: string;
  readonly outcome: "correct" | "incorrect" | "unknown";
  readonly rationale: string;
  readonly automaticJudgment: "confirmed" | "struggle" | "unknown";
  readonly finalJudgment: "confirmed" | "struggle" | "unknown";
  readonly correction: string | null;
  readonly linkedSupplementId: string | null;
  readonly recordedAt: string;
}

export interface AfterClassAnswerView {
  readonly id: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly status: "preparing" | "available" | "unanswered";
  readonly answerText: string | null;
  readonly sourceIds: readonly string[];
  readonly knowledgeBasis: "course" | "general" | null;
  readonly failure: string | null;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SupplementOriginView {
  readonly lastCompletedUnitId: string | null;
  readonly unfinishedUnitIds: readonly string[];
  readonly nextUnitId: string | null;
  readonly displayUnitId: string | null;
  readonly questionTargetId: string;
  readonly remainingMs: number;
}

export interface LiveSupplementCandidateView {
  readonly speechText: string;
  readonly captionText: string;
  readonly sceneId: string;
  readonly focusTargetIds: readonly string[];
  readonly boardPatches: readonly { readonly operation: "show" | "replace"; readonly targetId: string; readonly content?: string }[];
  readonly sourceIds: readonly string[];
  readonly knowledgeBasis: "course" | "general";
  readonly calculations: readonly { readonly operator: "add" | "subtract" | "multiply" | "divide"; readonly left: number; readonly right: number; readonly result: number }[];
  readonly corrections: readonly { readonly targetId: string; readonly content: string; readonly rationale: string }[];
}

export interface LiveSupplementView {
  readonly id: string;
  readonly questionId: string;
  readonly status: "preparing" | "bridging" | "ready" | "playing" | "rejoining" | "completed" | "deferred";
  readonly attempt: number;
  readonly origin: SupplementOriginView;
  readonly candidate: LiveSupplementCandidateView | null;
  readonly failure: string | null;
  readonly adoptedAt: string;
  readonly firstAudioAt: string | null;
}

export interface SessionSpeechView {
  readonly mode: "preparing" | "fish-audio" | "caption-fallback" | "test";
  readonly playing: boolean;
  readonly epoch: number;
  readonly unitId: string | null;
  readonly text: string | null;
  readonly startedAt: string | null;
  readonly durationMs: number;
  readonly audioUrl: string | null;
  readonly segments: readonly {
    readonly text: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly semanticTargetIds: readonly string[];
  }[];
  readonly failure: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly voiceId: string | null;
  readonly firstAudioMs: number | null;
  readonly synthesisMs: number | null;
}

export interface CreateSessionRequest {
  readonly coursePackageId: string;
  readonly durationMinutes: number;
}

export interface SessionCommandRequest {
  readonly command: "pause" | "resume" | "finish" | "answer";
  readonly answer?: string;
  readonly assessmentEvaluation?: AssessmentEvaluationView;
}

export interface ClassroomRoomView {
  readonly code: string;
  readonly participantCount: number;
  readonly capacity: number;
}

export interface ClassroomSnapshot {
  readonly seq: number;
  readonly serverTime: string;
  readonly audioEpoch: number;
  readonly audioOffsetMs: number;
  readonly session: FixedSessionView;
}

export interface ClassroomParticipantAccess {
  readonly id: string;
  readonly accessToken: string;
}

export interface ClassroomJoinRequest {
  readonly code: string;
}

export interface ClassroomJoinResponse {
  readonly participant: ClassroomParticipantAccess;
  readonly room: ClassroomRoomView;
  readonly snapshot: ClassroomSnapshot;
  readonly questions: readonly ClassroomQuestionView[];
}

export interface ClassroomReconnectRequest {
  readonly accessToken: string;
}

export interface ClassroomStreamMessage {
  readonly type: "snapshot";
  readonly snapshot: ClassroomSnapshot;
  readonly room: ClassroomRoomView;
  readonly questions: readonly ClassroomQuestionView[];
}

export type QuestionDisposition = "answer-now" | "after-class";
export interface QuestionPrioritySignals {
  readonly score: number;
  readonly currentGoalRelated: boolean;
  readonly prerequisiteForNext: boolean;
  readonly supporterCount: number;
  readonly waitedMs: number;
  readonly remainingMs: number;
}
export interface ClassroomQuestionView {
  readonly id: string;
  readonly text: string;
  readonly coursePackageId: string;
  readonly coursePackageVersion: number;
  readonly sceneId: string;
  readonly semanticTargetId: string;
  readonly lastCompletedUnitId: string | null;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly supporterCount: number;
  readonly status: "accepted" | "answering" | "answered";
  readonly resolution: "pending" | "answered" | "deferred";
  readonly disposition: QuestionDisposition;
  readonly reason: string;
  readonly priority: QuestionPrioritySignals;
  readonly origin: "learner-question" | "pedagogy-trigger";
}
export interface SubmitQuestionRequest {
  readonly accessToken: string;
  readonly text: string;
  readonly sceneId: string;
  readonly semanticTargetId?: string;
}
export interface SubmitQuestionResponse {
  readonly question: ClassroomQuestionView;
  readonly questions: readonly ClassroomQuestionView[];
  readonly snapshot: ClassroomSnapshot;
}

export interface SubmitLearningEvidenceRequest {
  readonly accessToken: string;
  readonly kind: "self-report" | "explicit-action";
  readonly value: "understood" | "need-help" | "recheck" | "target-selected";
  readonly sceneId: string;
  readonly semanticTargetId: string;
}

export interface SubmitAfterClassSurveyRequest {
  readonly accessToken: string;
  readonly questionHelpfulness: number;
  readonly rejoinNaturalness: number;
  readonly comment?: string;
}

export interface LlmSettingsView {
  readonly apiKeyConfigured: boolean;
  readonly model: string;
  readonly baseUrl: string;
}

export interface UpdateLlmSettingsRequest {
  readonly apiKey?: string;
  readonly model: string;
  readonly baseUrl?: string;
}

export type AuthoringGateId = "source-alignment" | "factual-consistency" | "goal-alignment" | "prerequisites" | "references" | "renderability" | "speech-caption" | "safe-content" | "rights";
export interface AuthoringReviewGate { readonly id: AuthoringGateId; readonly passed: boolean; readonly rationale: string; readonly locations: readonly string[]; readonly repairInstruction: string }
export interface AuthoringReview { readonly gates: readonly AuthoringReviewGate[]; readonly repairMode: "local" | "regenerate"; readonly summary: string }
export interface AuthoringSourceUpload {
  readonly fileName: string;
  readonly mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "text/markdown" | "text/plain";
  readonly dataBase64: string;
  readonly rights: { readonly basis: "owned" | "licensed" | "public-domain" | "permission"; readonly note?: string };
}
export interface CreateAuthoringRequest { readonly durationMinutes: number; readonly sources: readonly AuthoringSourceUpload[]; readonly targetLevel?: string; readonly learningGoals?: readonly string[]; readonly timeBudgetMs?: number; readonly costBudgetUsd?: number }
export interface AuthoringJobView {
  readonly id: string;
  readonly status: "running" | "available" | "budget-exhausted" | "failed";
  readonly createdAt: string; readonly updatedAt: string;
  readonly request: { readonly durationMinutes: number; readonly targetLevel?: string; readonly learningGoals?: readonly string[]; readonly timeBudgetMs: number; readonly costBudgetUsd: number };
  readonly review: AuthoringReview | null; readonly attempts: number; readonly elapsedMs: number; readonly estimatedCostUsd: number; readonly error: string | null;
  readonly sourceCount: number; readonly course: ReadonlyCoursePackage | null;
}
export interface ResumeAuthoringRequest { readonly additionalTimeBudgetMs?: number; readonly additionalCostBudgetUsd?: number }
