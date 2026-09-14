import type { CoursePackage } from "@aituber/contracts";

type TeachingUnit = CoursePackage["teachingUnits"][number];

export function unit(input: Omit<TeachingUnit, "postconditions" | "boardPatches" | "sourceIds" | "skippable"> & {
  sourceId: string;
  postcondition: string;
  skippable?: boolean;
  boardPatches?: TeachingUnit["boardPatches"];
}): TeachingUnit {
  const { sourceId, postcondition, skippable = false, boardPatches, ...rest } = input;
  return {
    ...rest,
    postconditions: [postcondition],
    boardPatches: boardPatches ?? rest.focusTargetIds.map((targetId) => ({ operation: "show" as const, targetId })),
    sourceIds: [sourceId],
    skippable,
  };
}
