import { describe, expect, it } from "vitest";
import {
  assertCoursePackageRevision,
  CoursePackageSchema,
  CoursePackageValidationError,
  parseCoursePackage,
  type CoursePackage,
} from "./course-package.ts";

const HASH = `sha256:${"a".repeat(64)}`;

function validCoursePackage(): CoursePackage {
  return {
    schemaVersion: "1.0.0",
    id: "course.quadratic",
    version: 1,
    status: "available",
    contentHash: HASH,
    title: "二次関数",
    targetLevel: "高校数学",
    durationMinutes: 6,
    sources: [{ id: "source.main", kind: "markdown", fileName: "quadratic.md", contentHash: HASH, rights: { basis: "owned" } }],
    learningGoals: [{ id: "goal.vertex", description: "平方完成から頂点を求める" }],
    concepts: [{ id: "concept.square", label: "平方完成", prerequisiteConceptIds: [] }],
    scenes: [{ id: "scene.vertex", title: "放物線の頂点", templateId: "board", targetIds: ["target.formula"] }],
    semanticTargets: [{
      id: "target.formula",
      sceneId: "scene.vertex",
      kind: "formula",
      label: "平方完成した式",
      content: "y = (x - 2)^2 - 1",
      sourceIds: ["source.main"],
    }],
    teachingUnits: [{
      id: "unit.vertex",
      kind: "main",
      learningGoalIds: ["goal.vertex"],
      prerequisiteUnitIds: [],
      postconditions: ["頂点の座標を説明できる"],
      sceneId: "scene.vertex",
      boardPatches: [{ operation: "show", targetId: "target.formula" }],
      focusTargetIds: ["target.formula"],
      speechText: "平方完成した式から頂点を読み取ります。",
      captionText: "平方完成した式から頂点を読み取ります。",
      skippable: false,
      estimatedDurationMs: 12_000,
      sourceIds: ["source.main"],
    }],
    assessments: [{
      id: "assessment.vertex",
      learningGoalIds: ["goal.vertex"],
      afterUnitId: "unit.vertex",
      prompt: "頂点のx座標はどこから読み取りますか。",
      responseKind: "short-answer",
      options: [],
      rubric: { criteria: ["平方完成した式に言及する"], commonMistakes: [] },
    }],
    preGeneratedSupplements: [{
      id: "supplement.square",
      triggerQuestions: ["平方完成とは何ですか"],
      unitIds: ["unit.vertex"],
      autoPlayEligible: true,
    }],
    pronunciationDictionary: [{ surface: "x", reading: "エックス" }],
    schedule: { orderedUnitIds: ["unit.vertex"], optionalUnitIds: [] },
  };
}

function expectValidationIssue(input: unknown, path: string) {
  try {
    parseCoursePackage(input);
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CoursePackageValidationError);
    expect((error as CoursePackageValidationError).issues.some((issue) => issue.path === path)).toBe(true);
  }
}

describe("CoursePackageSchema", () => {
  it("is JSON Schema that rejects unknown fields", () => {
    expect(CoursePackageSchema.type).toBe("object");
    expect(CoursePackageSchema.additionalProperties).toBe(false);
    expectValidationIssue({ ...validCoursePackage(), unexpected: true }, "/unexpected");
  });

  it("rejects an array beyond its contract limit", () => {
    const input = validCoursePackage();
    input.learningGoals = Array.from({ length: 33 }, (_, index) => ({ id: `goal.g${index}`, description: `Goal ${index}` }));
    expectValidationIssue(input, "/learningGoals");
  });
});

describe("parseCoursePackage", () => {
  it("returns a recursively immutable validated package", () => {
    const parsed = parseCoursePackage(validCoursePackage());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.teachingUnits)).toBe(true);
    expect(Object.isFrozen(parsed.teachingUnits[0])).toBe(true);
  });

  it("rejects duplicate ids and missing references", () => {
    const input = validCoursePackage();
    input.semanticTargets.push({ ...input.semanticTargets[0]! });
    input.teachingUnits[0]!.focusTargetIds = ["target.missing"];
    try {
      parseCoursePackage(input);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CoursePackageValidationError);
      const paths = (error as CoursePackageValidationError).issues.map((issue) => issue.path);
      expect(paths).toContain("/semanticTargets/1/id");
      expect(paths).toContain("/teachingUnits/0/focusTargetIds/0");
    }
  });

  it("rejects malformed semantic ids", () => {
    const input = validCoursePackage();
    input.semanticTargets[0]!.id = "Rendered target 1";
    expectValidationIssue(input, "/semanticTargets/0/id");
  });

  it("rejects unsafe TeX commands before a package can be rendered", () => {
    const input = validCoursePackage(); input.semanticTargets[0]!.content = String.raw`\href{https://example.com}{x}`;
    expectValidationIssue(input, "/semanticTargets/0/content");
    const patched = validCoursePackage(); patched.teachingUnits[0]!.boardPatches = [{ operation: "replace", targetId: "target.formula", content: String.raw`\def\loop{\loop}\loop` }];
    expectValidationIssue(patched, "/teachingUnits/0/boardPatches/0/content");
  });
});

describe("assertCoursePackageRevision", () => {
  it("rejects direct changes to an available version", () => {
    const previous = parseCoursePackage(validCoursePackage());
    const candidate = validCoursePackage();
    candidate.title = "変更された二次関数";
    expect(() => assertCoursePackageRevision(previous, candidate)).toThrow("An available Course Package is immutable");
  });

  it("accepts a changed package saved as a higher version", () => {
    const previous = parseCoursePackage(validCoursePackage());
    const candidate = validCoursePackage();
    candidate.version = 2;
    candidate.title = "二次関数 改訂版";
    expect(assertCoursePackageRevision(previous, candidate).version).toBe(2);
  });
});
