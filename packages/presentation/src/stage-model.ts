import type { ReadonlyCoursePackage } from "@aituber/contracts";

type SemanticTarget = ReadonlyCoursePackage["semanticTargets"][number];
type BoardPatch = ReadonlyCoursePackage["teachingUnits"][number]["boardPatches"][number];

export interface StageTarget extends SemanticTarget {
  readonly visible: boolean;
  readonly focused: boolean;
}

export interface StageScene {
  readonly id: string;
  readonly title: string;
  readonly templateId: ReadonlyCoursePackage["scenes"][number]["templateId"];
  readonly targets: readonly StageTarget[];
  readonly focusedTargetId: string | null;
  readonly focusedTargetIds: ReadonlySet<string>;
}

export interface BoardState {
  readonly visibleTargetIds: ReadonlySet<string>;
  readonly replacementContent: ReadonlyMap<string, string>;
  readonly focusedTargetIds: ReadonlySet<string>;
}

export function createBoardState(coursePackage: ReadonlyCoursePackage, sceneId: string): BoardState {
  const scene = coursePackage.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new RangeError(`Unknown scene ${sceneId}`);
  return {
    visibleTargetIds: new Set(scene.targetIds),
    replacementContent: new Map(),
    focusedTargetIds: new Set(),
  };
}

export function applyBoardPatches(
  coursePackage: ReadonlyCoursePackage,
  state: BoardState,
  patches: readonly BoardPatch[],
): BoardState {
  const knownIds = new Set(coursePackage.semanticTargets.map((target) => target.id));
  const visibleTargetIds = new Set(state.visibleTargetIds);
  const replacementContent = new Map(state.replacementContent);

  for (const patch of patches) {
    if (!knownIds.has(patch.targetId)) throw new RangeError(`Unknown semantic target ${patch.targetId}`);
    if (patch.operation === "show") visibleTargetIds.add(patch.targetId);
    if (patch.operation === "hide") visibleTargetIds.delete(patch.targetId);
    if (patch.operation === "replace") {
      if (!patch.content) throw new TypeError("A replace patch requires content");
      if (coursePackage.semanticTargets.find((target) => target.id === patch.targetId)?.kind === "formula") assertSafeFormulaInput(patch.content);
      replacementContent.set(patch.targetId, patch.content);
      visibleTargetIds.add(patch.targetId);
    }
  }
  return { visibleTargetIds, replacementContent, focusedTargetIds: state.focusedTargetIds };
}

export function focusSemanticTarget(
  coursePackage: ReadonlyCoursePackage,
  state: BoardState,
  targetId: string | null,
): BoardState {
  return focusSemanticTargets(coursePackage, state, targetId === null ? [] : [targetId]);
}

export function focusSemanticTargets(
  coursePackage: ReadonlyCoursePackage,
  state: BoardState,
  targetIds: readonly string[],
): BoardState {
  const knownIds = new Set(coursePackage.semanticTargets.map((target) => target.id));
  for (const targetId of targetIds) {
    if (!knownIds.has(targetId)) throw new RangeError(`Unknown semantic target ${targetId}`);
  }
  return { ...state, focusedTargetIds: new Set(targetIds) };
}

export function resolveStageScene(
  coursePackage: ReadonlyCoursePackage,
  sceneId: string,
  boardState: BoardState,
): StageScene {
  const scene = coursePackage.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new RangeError(`Unknown scene ${sceneId}`);
  const targetById = new Map(coursePackage.semanticTargets.map((target) => [target.id, target]));
  const targets = scene.targetIds.map((targetId) => {
    const target = targetById.get(targetId);
    if (!target) throw new RangeError(`Scene ${sceneId} references unknown target ${targetId}`);
    return {
      ...target,
      content: boardState.replacementContent.get(target.id) ?? target.content,
      visible: boardState.visibleTargetIds.has(target.id),
      focused: boardState.focusedTargetIds.has(target.id),
    };
  });
  const focusedTargetIds = new Set([...boardState.focusedTargetIds].filter((targetId) => scene.targetIds.includes(targetId)));
  return { id: scene.id, title: scene.title, templateId: scene.templateId, targets, focusedTargetId: [...focusedTargetIds][0] ?? null, focusedTargetIds };
}

export function localAssetUrl(assetId: string): string {
  if (!/^[a-z][a-z0-9._:-]{2,127}$/.test(assetId)) throw new TypeError("Invalid asset id");
  return `/assets/${encodeURIComponent(assetId)}`;
}

function assertSafeFormulaInput(value: string): void {
  const forbiddenCommand = /\\(?:href|url|includegraphics|html(?:Class|Id|Style|Data)|def|gdef|edef|xdef|newcommand|renewcommand|providecommand|catcode|require)\b/i;
  const markupTag = /<\s*\/?\s*(?:script|style|svg|math|iframe|object|embed|img|link|meta)\b/i;
  if (value.length > 4_096 || forbiddenCommand.test(value) || markupTag.test(value)) throw new TypeError("formula contains unsafe or unsupported rendering input");
}
