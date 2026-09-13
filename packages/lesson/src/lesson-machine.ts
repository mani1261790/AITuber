export type LessonStatus =
  | "IDLE"
  | "PREPARING"
  | "TEACHING"
  | "CHECKPOINT"
  | "ASSESSING"
  | "BRANCHING"
  | "REJOINING"
  | "PAUSED"
  | "RECOVERING"
  | "FINISHED";

export interface LessonState {
  readonly sessionId: string;
  readonly epoch: number;
  readonly status: LessonStatus;
  readonly resumeStatus: Exclude<LessonStatus, "IDLE" | "PAUSED" | "RECOVERING" | "FINISHED"> | null;
  readonly orderedUnitIds: readonly string[];
  readonly completedUnitIds: readonly string[];
  readonly activeUnitId: string | null;
  readonly presentedUnitId: string | null;
  readonly branchOriginUnitId: string | null;
  readonly lastFailure: string | null;
}

export type LessonEvent =
  | { readonly type: "PREPARE_REQUESTED"; readonly epoch: number }
  | { readonly type: "PREPARATION_COMPLETED"; readonly epoch: number }
  | { readonly type: "PREPARATION_FAILED"; readonly epoch: number; readonly reason: string }
  | { readonly type: "UNIT_PRESENTED"; readonly epoch: number; readonly unitId: string }
  | { readonly type: "UNIT_AUDIO_COMPLETED"; readonly epoch: number; readonly unitId: string }
  | { readonly type: "CHECKPOINT_PRESENTED"; readonly epoch: number }
  | { readonly type: "ANSWER_RECEIVED"; readonly epoch: number }
  | { readonly type: "BRANCH_SELECTED"; readonly epoch: number; readonly supplementRequired: boolean }
  | { readonly type: "QUESTION_ACCEPTED"; readonly epoch: number }
  | { readonly type: "QUESTION_DEFERRED"; readonly epoch: number }
  | { readonly type: "SUPPLEMENT_COMPLETED"; readonly epoch: number }
  | { readonly type: "REJOIN_VERIFIED"; readonly epoch: number }
  | { readonly type: "PAUSE_REQUESTED"; readonly epoch: number }
  | { readonly type: "FAULT_DETECTED"; readonly epoch: number; readonly reason: string }
  | { readonly type: "RECOVERY_STARTED"; readonly epoch: number }
  | { readonly type: "RECOVERY_COMPLETED"; readonly epoch: number }
  | { readonly type: "FINISH_REQUESTED"; readonly epoch: number };

export interface TransitionResult {
  readonly state: LessonState;
  readonly ignored: boolean;
  readonly reason?: "stale_epoch";
}

export class InvalidLessonTransitionError extends Error {
  constructor(status: LessonStatus, eventType: LessonEvent["type"]) {
    super(`Event ${eventType} is not allowed while lesson is ${status}`);
    this.name = "InvalidLessonTransitionError";
  }
}

export function createLessonState(input: {
  sessionId: string;
  orderedUnitIds: readonly string[];
  epoch?: number;
}): LessonState {
  if (new Set(input.orderedUnitIds).size !== input.orderedUnitIds.length) {
    throw new TypeError("orderedUnitIds must be unique");
  }
  return {
    sessionId: input.sessionId,
    epoch: input.epoch ?? 1,
    status: "IDLE",
    resumeStatus: null,
    orderedUnitIds: [...input.orderedUnitIds],
    completedUnitIds: [],
    activeUnitId: null,
    presentedUnitId: null,
    branchOriginUnitId: null,
    lastFailure: null,
  };
}

export function transitionLesson(state: LessonState, event: LessonEvent): TransitionResult {
  if (event.epoch < state.epoch) return { state, ignored: true, reason: "stale_epoch" };
  if (event.epoch > state.epoch) throw new InvalidLessonTransitionError(state.status, event.type);

  const next = reduceCurrentEpoch(state, event);
  return { state: next, ignored: false };
}

export function replayLesson(initialState: LessonState, events: readonly LessonEvent[]): LessonState {
  return events.reduce((state, event) => transitionLesson(state, event).state, initialState);
}

export function pendingProviderActions(state: LessonState): readonly string[] {
  if (state.status === "IDLE" || state.status === "PAUSED" || state.status === "FINISHED") return [];
  if (state.status === "PREPARING") return ["prepare-course"];
  if (state.status === "BRANCHING") return ["prepare-supplement"];
  return [];
}

function reduceCurrentEpoch(state: LessonState, event: LessonEvent): LessonState {
  switch (event.type) {
    case "PREPARE_REQUESTED":
      requireStatus(state, event, "IDLE");
      return { ...state, status: "PREPARING", lastFailure: null };
    case "PREPARATION_COMPLETED":
      requireStatus(state, event, "PREPARING");
      return { ...state, status: "TEACHING", activeUnitId: nextUnitId(state) };
    case "PREPARATION_FAILED":
      requireStatus(state, event, "PREPARING");
      return pause(state, "PREPARING", event.reason);
    case "UNIT_PRESENTED":
      requireStatus(state, event, "TEACHING");
      if (event.unitId !== state.activeUnitId) throw new InvalidLessonTransitionError(state.status, event.type);
      return { ...state, presentedUnitId: event.unitId };
    case "UNIT_AUDIO_COMPLETED": {
      requireStatus(state, event, "TEACHING");
      if (event.unitId !== state.presentedUnitId || event.unitId !== state.activeUnitId) {
        throw new InvalidLessonTransitionError(state.status, event.type);
      }
      const completedUnitIds = [...state.completedUnitIds, event.unitId];
      return { ...state, completedUnitIds, activeUnitId: nextUnitId({ ...state, completedUnitIds }), presentedUnitId: null };
    }
    case "CHECKPOINT_PRESENTED":
      requireStatus(state, event, "TEACHING");
      return { ...state, status: "CHECKPOINT" };
    case "ANSWER_RECEIVED":
      requireStatus(state, event, "CHECKPOINT");
      return { ...state, status: "ASSESSING" };
    case "BRANCH_SELECTED":
      requireStatus(state, event, "ASSESSING");
      return event.supplementRequired
        ? { ...state, status: "BRANCHING", branchOriginUnitId: state.activeUnitId }
        : { ...state, status: "TEACHING" };
    case "QUESTION_ACCEPTED":
      requireStatus(state, event, "TEACHING");
      return { ...state, status: "BRANCHING", branchOriginUnitId: state.activeUnitId };
    case "QUESTION_DEFERRED":
      requireStatus(state, event, "BRANCHING");
      return { ...state, status: "TEACHING", branchOriginUnitId: null };
    case "SUPPLEMENT_COMPLETED":
      requireStatus(state, event, "BRANCHING");
      return { ...state, status: "REJOINING" };
    case "REJOIN_VERIFIED":
      requireStatus(state, event, "REJOINING");
      return { ...state, status: "TEACHING", branchOriginUnitId: null };
    case "PAUSE_REQUESTED":
      requireStatus(state, event, "PREPARING", "TEACHING", "CHECKPOINT", "ASSESSING", "BRANCHING", "REJOINING", "RECOVERING");
      return pause(state, resumableStatus(state.status), null);
    case "FAULT_DETECTED":
      requireStatus(state, event, "PREPARING", "TEACHING", "CHECKPOINT", "ASSESSING", "BRANCHING", "REJOINING", "RECOVERING");
      return pause(state, resumableStatus(state.status), event.reason);
    case "RECOVERY_STARTED":
      requireStatus(state, event, "PAUSED");
      return { ...state, status: "RECOVERING" };
    case "RECOVERY_COMPLETED":
      requireStatus(state, event, "RECOVERING");
      if (!state.resumeStatus) throw new InvalidLessonTransitionError(state.status, event.type);
      return { ...state, status: state.resumeStatus, resumeStatus: null, lastFailure: null };
    case "FINISH_REQUESTED":
      requireStatus(state, event, "TEACHING", "CHECKPOINT", "PAUSED");
      return { ...state, status: "FINISHED", activeUnitId: null, presentedUnitId: null, resumeStatus: null };
  }
}

function pause(state: LessonState, resumeStatus: LessonState["resumeStatus"], reason: string | null): LessonState {
  return { ...state, epoch: state.epoch + 1, status: "PAUSED", resumeStatus, presentedUnitId: null, lastFailure: reason };
}

function resumableStatus(status: LessonStatus): NonNullable<LessonState["resumeStatus"]> {
  return status === "RECOVERING" ? "TEACHING" : status as NonNullable<LessonState["resumeStatus"]>;
}

function nextUnitId(state: Pick<LessonState, "orderedUnitIds" | "completedUnitIds">): string | null {
  const completed = new Set(state.completedUnitIds);
  return state.orderedUnitIds.find((unitId) => !completed.has(unitId)) ?? null;
}

function requireStatus(state: LessonState, event: LessonEvent, ...allowed: LessonStatus[]) {
  if (!allowed.includes(state.status)) throw new InvalidLessonTransitionError(state.status, event.type);
}
