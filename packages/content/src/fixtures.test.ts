import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCoursePackage } from "@aituber/contracts";
import {
  coursePackageFixtures,
  dnaReplicationFixture,
  fixtureQuestionScenarios,
  quadraticFunctionsFixture,
  vaeReparameterizationFixture,
} from "./fixtures.ts";

const MIN_MAIN_DURATION_MS = 330_000;
const MAX_MAIN_DURATION_MS = 390_000;
const INTERACTION_ALLOWANCE_MS = 120_000;
const TOTAL_TRIAL_LIMIT_MS = 25 * 60_000;

function mainDuration(course: (typeof coursePackageFixtures)[number]) {
  const ordered = new Set(course.schedule.orderedUnitIds);
  return course.teachingUnits
    .filter((unit) => ordered.has(unit.id))
    .reduce((sum, unit) => sum + unit.estimatedDurationMs, 0);
}

describe("fixed Course Package fixtures", () => {
  it("contains the three required subjects at two education levels", () => {
    expect(coursePackageFixtures.map((course) => course.id)).toEqual([
      "course.quadratic-functions",
      "course.dna-replication",
      "course.vae-reparameterization",
    ]);
    expect(quadraticFunctionsFixture.targetLevel).toContain("高校");
    expect(dnaReplicationFixture.targetLevel).toContain("高校");
    expect(vaeReparameterizationFixture.targetLevel).toContain("大学");
  });

  it("passes the runtime contract and has no orphan semantic targets", () => {
    for (const course of coursePackageFixtures) {
      expect(parseCoursePackage(JSON.parse(JSON.stringify(course))).id).toBe(course.id);
      expect(Object.isFrozen(course)).toBe(true);
      const sceneTargets = new Map(course.scenes.map((scene) => [scene.id, new Set(scene.targetIds)]));
      course.semanticTargets.forEach((target) => expect(sceneTargets.get(target.sceneId)?.has(target.id)).toBe(true));
    }
  });

  it("orders prerequisites before each scheduled teaching unit", () => {
    for (const course of coursePackageFixtures) {
      const positions = new Map(course.schedule.orderedUnitIds.map((unitId, index) => [unitId, index]));
      for (const unit of course.teachingUnits.filter((candidate) => positions.has(candidate.id))) {
        for (const prerequisiteId of unit.prerequisiteUnitIds) {
          expect(positions.get(prerequisiteId)!).toBeLessThan(positions.get(unit.id)!);
        }
      }
    }
  });

  it("keeps each main lecture near six minutes and the trial below 25 minutes", () => {
    const durations = coursePackageFixtures.map(mainDuration);
    durations.forEach((duration) => expect(duration).toBeGreaterThanOrEqual(MIN_MAIN_DURATION_MS));
    durations.forEach((duration) => expect(duration).toBeLessThanOrEqual(MAX_MAIN_DURATION_MS));
    expect(durations.reduce((sum, duration) => sum + duration + INTERACTION_ALLOWANCE_MS, 0)).toBeLessThanOrEqual(TOTAL_TRIAL_LIMIT_MS);
  });

  it("uses the exact SHA-256 of each owned source fixture", async () => {
    for (const course of coursePackageFixtures) {
      for (const source of course.sources) {
        const contents = await readFile(resolve(process.cwd(), "tests/fixtures/sources", source.fileName));
        const actual = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
        expect(source.contentHash).toBe(actual);
        expect(course.contentHash).toBe(actual);
      }
    }
  });

  it("covers formulas, graph targeting, partial expressions, and calculation", () => {
    const ids = new Set(quadraticFunctionsFixture.semanticTargets.map((target) => target.id));
    expect(ids.has("target.math.graph")).toBe(true);
    expect(ids.has("target.math.h-term")).toBe(true);
    expect(ids.has("target.math.k-term")).toBe(true);
    expect(quadraticFunctionsFixture.semanticTargets.some((target) => target.kind === "formula")).toBe(true);
    expect(quadraticFunctionsFixture.assessments.some((assessment) => assessment.responseKind === "short-answer")).toBe(true);
  });

  it("covers DNA diagrams, ordered steps, and terminology support", () => {
    expect(dnaReplicationFixture.semanticTargets.filter((target) => target.kind === "diagram").length).toBeGreaterThanOrEqual(5);
    expect(dnaReplicationFixture.semanticTargets.find((target) => target.id === "target.dna.sequence")?.content).toContain("→");
    expect(dnaReplicationFixture.preGeneratedSupplements[0]?.triggerQuestions.join(" ")).toContain("岡崎フラグメント");
  });

  it("covers VAE prerequisites, formulas, supplements, and two rejoin depths", () => {
    const transform = vaeReparameterizationFixture.semanticTargets.find((target) => target.id === "target.vae.transform");
    expect(transform).toMatchObject({ kind: "formula" });
    expect(transform?.content).toContain("epsilon");
    expect(vaeReparameterizationFixture.teachingUnits.find((unit) => unit.id === "unit.vae.gradient")?.prerequisiteUnitIds).toEqual(["unit.vae.transform"]);
    const vaeScenarios = fixtureQuestionScenarios.filter((scenario) => scenario.coursePackageId === vaeReparameterizationFixture.id);
    expect(vaeScenarios.map((scenario) => scenario.expectedResumeUnitId)).toEqual(["unit.vae.epsilon", "unit.vae.gradient"]);
  });

  it("keeps every scenario reference inside its Course Package", () => {
    for (const scenario of fixtureQuestionScenarios) {
      const course = coursePackageFixtures.find((candidate) => candidate.id === scenario.coursePackageId);
      expect(course).toBeDefined();
      const unitIds = new Set(course?.teachingUnits.map((unit) => unit.id));
      const supplementIds = new Set(course?.preGeneratedSupplements.map((supplement) => supplement.id));
      expect(unitIds.has(scenario.afterUnitId)).toBe(true);
      expect(unitIds.has(scenario.expectedResumeUnitId)).toBe(true);
      expect(supplementIds.has(scenario.supplementId)).toBe(true);
    }
  });
});
