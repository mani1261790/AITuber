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
}

export interface ClassroomReconnectRequest {
  readonly accessToken: string;
}

export interface ClassroomStreamMessage {
  readonly type: "snapshot";
  readonly snapshot: ClassroomSnapshot;
  readonly room: ClassroomRoomView;
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
