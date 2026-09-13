import { parseCoursePackage, type CoursePackage } from "@aituber/contracts";
import { describe, expect, it } from "vitest";
import { applyBoardPatches, createBoardState, focusSemanticTarget, focusSemanticTargets, localAssetUrl, resolveStageScene } from "./stage-model.ts";

const HASH = `sha256:${"b".repeat(64)}`;
const fixture = (): CoursePackage => ({
  schemaVersion: "1.0.0", id: "course.stage", version: 1, status: "available", contentHash: HASH,
  title: "二次関数", targetLevel: "高校", durationMinutes: 6,
  sources: [{ id: "source.main", kind: "markdown", fileName: "stage.md", contentHash: HASH, rights: { basis: "owned" } }],
  learningGoals: [{ id: "goal.vertex", description: "頂点を説明する" }], concepts: [],
  scenes: [{ id: "scene.vertex", title: "放物線の頂点", templateId: "split", targetIds: ["target.text", "target.formula"] }],
  semanticTargets: [
    { id: "target.text", sceneId: "scene.vertex", kind: "text", label: "説明", content: "グラフの最も低い点に注目します。", sourceIds: ["source.main"] },
    { id: "target.formula", sceneId: "scene.vertex", kind: "formula", label: "平方完成した式", content: "y = (x - 2)^2 - 1", sourceIds: ["source.main"] },
  ],
  teachingUnits: [{ id: "unit.vertex", kind: "main", learningGoalIds: ["goal.vertex"], prerequisiteUnitIds: [], postconditions: ["頂点を読める"], sceneId: "scene.vertex", boardPatches: [], focusTargetIds: ["target.formula"], speechText: "式から頂点を読みます。", captionText: "式から頂点を読みます。", skippable: false, estimatedDurationMs: 5_000, sourceIds: ["source.main"] }],
  assessments: [], preGeneratedSupplements: [], pronunciationDictionary: [],
  schedule: { orderedUnitIds: ["unit.vertex"], optionalUnitIds: [] },
});

describe("stage model", () => {
  it("resolves focus by stable semantic id after rebuilding a scene", () => {
    const course = parseCoursePackage(fixture());
    const focused = focusSemanticTarget(course, createBoardState(course, "scene.vertex"), "target.formula");
    expect(resolveStageScene(course, "scene.vertex", focused).targets.find((target) => target.focused)?.id).toBe("target.formula");
  });

  it("applies only known board targets and keeps content as text", () => {
    const course = parseCoursePackage(fixture());
    const state = applyBoardPatches(course, createBoardState(course, "scene.vertex"), [
      { operation: "replace", targetId: "target.text", content: "<script>alert(1)</script>" },
      { operation: "hide", targetId: "target.formula" },
    ]);
    const scene = resolveStageScene(course, "scene.vertex", state);
    expect(scene.targets[0]?.content).toBe("<script>alert(1)</script>");
    expect(scene.targets[1]?.visible).toBe(false);
    expect(() => applyBoardPatches(course, state, [{ operation: "show", targetId: "target.unknown" }])).toThrow(RangeError);
  });

  it("constructs same-origin asset URLs from validated ids", () => {
    expect(localAssetUrl("asset.diagram-1")).toBe("/assets/asset.diagram-1");
    expect(() => localAssetUrl("https://example.com/image.png")).toThrow(TypeError);
  });

  it("focuses every semantic target attached to the current speech segment", () => {
    const course = parseCoursePackage(fixture());
    const board = focusSemanticTargets(course, createBoardState(course, "scene.vertex"), ["target.text", "target.formula"]);
    const scene = resolveStageScene(course, "scene.vertex", board);
    expect(scene.targets.filter((target) => target.focused).map((target) => target.id)).toEqual(["target.text", "target.formula"]);
    expect(scene.focusedTargetIds).toEqual(new Set(["target.text", "target.formula"]));
  });
});
