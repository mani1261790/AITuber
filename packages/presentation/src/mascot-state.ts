export type MascotVisualState = "normal" | "mouth-open" | "pointing" | "reaction";

export interface MascotPresentation {
  readonly state: MascotVisualState;
  readonly mouthOpen: boolean;
  readonly targetId: string | null;
  readonly announcement: string;
}

export interface MascotTimelineInput {
  readonly audiblePlayback: boolean;
  readonly elapsedMs: number;
  readonly segment: { readonly startMs: number; readonly endMs: number } | null;
  readonly targetId: string | null;
  readonly targetLabel: string | null;
  readonly reactionActive: boolean;
}

const MOUTH_CYCLE_MS = 280;
const MOUTH_OPEN_MS = 160;

export function resolveMascotPresentation(input: MascotTimelineInput): MascotPresentation {
  const insideSegment = input.segment !== null
    && input.elapsedMs >= input.segment.startMs
    && input.elapsedMs < input.segment.endMs;
  const segmentElapsedMs = insideSegment ? input.elapsedMs - (input.segment?.startMs ?? 0) : 0;
  const mouthOpen = input.audiblePlayback && insideSegment && segmentElapsedMs % MOUTH_CYCLE_MS < MOUTH_OPEN_MS;

  if (input.reactionActive) {
    return { state: "reaction", mouthOpen: false, targetId: null, announcement: "節目に反応しています" };
  }
  if (input.targetId) {
    return {
      state: "pointing",
      mouthOpen,
      targetId: input.targetId,
      announcement: `${input.targetLabel ?? "現在の教材"}を案内しています`,
    };
  }
  if (mouthOpen) {
    return { state: "mouth-open", mouthOpen: true, targetId: null, announcement: "説明しています" };
  }
  return { state: "normal", mouthOpen: false, targetId: null, announcement: "講義を見守っています" };
}
