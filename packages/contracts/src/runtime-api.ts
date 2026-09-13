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
}

export interface CreateSessionRequest {
  readonly coursePackageId: string;
  readonly durationMinutes: number;
}

export interface SessionCommandRequest {
  readonly command: "pause" | "resume" | "finish" | "answer";
  readonly answer?: string;
}
