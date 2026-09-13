import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const MAX_SOURCES = 64;
const MAX_GOALS = 32;
const MAX_CONCEPTS = 128;
const MAX_SCENES = 256;
const MAX_TARGETS = 2_048;
const MAX_UNITS = 1_024;
const MAX_QUESTIONS = 256;
const MAX_SUPPLEMENTS = 256;
const MAX_TEXT = 20_000;

const Identifier = Type.String({
  minLength: 3,
  maxLength: 128,
  pattern: "^[a-z][a-z0-9._:-]*$",
});
const NonEmptyText = Type.String({ minLength: 1, maxLength: MAX_TEXT });
const ShortText = Type.String({ minLength: 1, maxLength: 512 });
const Hash = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });

function closedObject<T extends Record<string, TSchema>>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

export const SourceMaterialSchema = closedObject({
  id: Identifier,
  kind: Type.Union([
    Type.Literal("pdf"),
    Type.Literal("image"),
    Type.Literal("markdown"),
    Type.Literal("instructor-note"),
  ]),
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
  contentHash: Hash,
  rights: closedObject({
    basis: Type.Union([
      Type.Literal("owned"),
      Type.Literal("licensed"),
      Type.Literal("public-domain"),
      Type.Literal("permission"),
    ]),
    note: Type.Optional(Type.String({ maxLength: 2_000 })),
  }),
});

export const LearningGoalSchema = closedObject({ id: Identifier, description: ShortText });

export const ConceptSchema = closedObject({
  id: Identifier,
  label: ShortText,
  prerequisiteConceptIds: Type.Array(Identifier, { maxItems: MAX_CONCEPTS, uniqueItems: true }),
});

export const SemanticTargetSchema = closedObject({
  id: Identifier,
  sceneId: Identifier,
  kind: Type.Union([
    Type.Literal("text"),
    Type.Literal("image"),
    Type.Literal("formula"),
    Type.Literal("diagram"),
  ]),
  label: ShortText,
  content: NonEmptyText,
  assetId: Type.Optional(Identifier),
  altText: Type.Optional(ShortText),
  sourceIds: Type.Array(Identifier, { minItems: 1, maxItems: MAX_SOURCES, uniqueItems: true }),
});

export const SceneSchema = closedObject({
  id: Identifier,
  title: ShortText,
  templateId: Type.Union([
    Type.Literal("document"),
    Type.Literal("board"),
    Type.Literal("split"),
    Type.Literal("full-image"),
  ]),
  targetIds: Type.Array(Identifier, { minItems: 1, maxItems: MAX_TARGETS, uniqueItems: true }),
});

export const BoardPatchSchema = closedObject({
  operation: Type.Union([Type.Literal("show"), Type.Literal("hide"), Type.Literal("replace")]),
  targetId: Identifier,
  content: Type.Optional(NonEmptyText),
});

export const TeachingUnitSchema = closedObject({
  id: Identifier,
  kind: Type.Union([
    Type.Literal("main"),
    Type.Literal("checkpoint"),
    Type.Literal("transition"),
    Type.Literal("supplement"),
  ]),
  learningGoalIds: Type.Array(Identifier, { minItems: 1, maxItems: MAX_GOALS, uniqueItems: true }),
  prerequisiteUnitIds: Type.Array(Identifier, { maxItems: MAX_UNITS, uniqueItems: true }),
  postconditions: Type.Array(ShortText, { minItems: 1, maxItems: 32, uniqueItems: true }),
  sceneId: Identifier,
  boardPatches: Type.Array(BoardPatchSchema, { maxItems: 128 }),
  focusTargetIds: Type.Array(Identifier, { maxItems: 64, uniqueItems: true }),
  speechText: NonEmptyText,
  captionText: NonEmptyText,
  skippable: Type.Boolean(),
  estimatedDurationMs: Type.Integer({ minimum: 250, maximum: 900_000 }),
  sourceIds: Type.Array(Identifier, { minItems: 1, maxItems: MAX_SOURCES, uniqueItems: true }),
});

export const AssessmentSchema = closedObject({
  id: Identifier,
  learningGoalIds: Type.Array(Identifier, { minItems: 1, maxItems: MAX_GOALS, uniqueItems: true }),
  afterUnitId: Identifier,
  prompt: NonEmptyText,
  responseKind: Type.Union([Type.Literal("multiple-choice"), Type.Literal("short-answer")]),
  options: Type.Array(ShortText, { maxItems: 12, uniqueItems: true }),
  rubric: closedObject({
    criteria: Type.Array(ShortText, { minItems: 1, maxItems: 16 }),
    commonMistakes: Type.Array(ShortText, { maxItems: 32 }),
  }),
});

export const PreGeneratedSupplementSchema = closedObject({
  id: Identifier,
  triggerQuestions: Type.Array(ShortText, { minItems: 1, maxItems: 32 }),
  unitIds: Type.Array(Identifier, { minItems: 1, maxItems: 64, uniqueItems: true }),
  autoPlayEligible: Type.Boolean(),
});

export const CoursePackageSchema = closedObject({
  schemaVersion: Type.Literal("1.0.0"),
  id: Identifier,
  version: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
  status: Type.Union([
    Type.Literal("draft"),
    Type.Literal("reviewing"),
    Type.Literal("available"),
    Type.Literal("rejected"),
    Type.Literal("retired"),
  ]),
  contentHash: Hash,
  title: ShortText,
  targetLevel: ShortText,
  durationMinutes: Type.Integer({ minimum: 1, maximum: 480 }),
  sources: Type.Array(SourceMaterialSchema, { minItems: 1, maxItems: MAX_SOURCES }),
  learningGoals: Type.Array(LearningGoalSchema, { minItems: 1, maxItems: MAX_GOALS }),
  concepts: Type.Array(ConceptSchema, { maxItems: MAX_CONCEPTS }),
  scenes: Type.Array(SceneSchema, { minItems: 1, maxItems: MAX_SCENES }),
  semanticTargets: Type.Array(SemanticTargetSchema, { minItems: 1, maxItems: MAX_TARGETS }),
  teachingUnits: Type.Array(TeachingUnitSchema, { minItems: 1, maxItems: MAX_UNITS }),
  assessments: Type.Array(AssessmentSchema, { maxItems: MAX_QUESTIONS }),
  preGeneratedSupplements: Type.Array(PreGeneratedSupplementSchema, { maxItems: MAX_SUPPLEMENTS }),
  pronunciationDictionary: Type.Array(
    closedObject({
      surface: Type.String({ minLength: 1, maxLength: 256 }),
      reading: Type.String({ minLength: 1, maxLength: 512 }),
    }),
    { maxItems: 2_048 },
  ),
  schedule: closedObject({
    orderedUnitIds: Type.Array(Identifier, { minItems: 1, maxItems: MAX_UNITS, uniqueItems: true }),
    optionalUnitIds: Type.Array(Identifier, { maxItems: MAX_UNITS, uniqueItems: true }),
  }),
});

export type CoursePackage = Static<typeof CoursePackageSchema>;
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
export type ReadonlyCoursePackage = DeepReadonly<CoursePackage>;

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class CoursePackageValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const firstIssue = issues[0];
    const detail = firstIssue ? `: ${firstIssue.path} ${firstIssue.message}` : "";
    super(`Course Package validation failed with ${issues.length} issue(s)${detail}`);
    this.name = "CoursePackageValidationError";
    this.issues = issues;
  }
}

export function parseCoursePackage(input: unknown): ReadonlyCoursePackage {
  const schemaIssues = [...Value.Errors(CoursePackageSchema, input)].map((issue) => ({
    path: issue.path || "/",
    message: issue.message,
  }));
  if (schemaIssues.length > 0) throw new CoursePackageValidationError(schemaIssues);

  const coursePackage = input as CoursePackage;
  const referenceIssues = validateReferences(coursePackage);
  if (referenceIssues.length > 0) throw new CoursePackageValidationError(referenceIssues);

  return deepFreeze(Value.Clone(coursePackage));
}

export function assertCoursePackageRevision(
  previous: ReadonlyCoursePackage,
  candidateInput: unknown,
): ReadonlyCoursePackage {
  const candidate = parseCoursePackage(candidateInput);
  if (candidate.id !== previous.id) {
    throw new CoursePackageValidationError([
      { path: "/id", message: "A revision must keep the same Course Package id" },
    ]);
  }

  const changed = stableStringify(previous) !== stableStringify(candidate);
  if (previous.status === "available" && changed && candidate.version <= previous.version) {
    throw new CoursePackageValidationError([
      {
        path: "/version",
        message: "An available Course Package is immutable; save changes with a higher version",
      },
    ]);
  }
  if (candidate.version < previous.version) {
    throw new CoursePackageValidationError([
      { path: "/version", message: "A revision cannot decrease the Course Package version" },
    ]);
  }
  return candidate;
}

function validateReferences(coursePackage: CoursePackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceIds = collectUniqueIds(coursePackage.sources, "/sources", issues);
  const goalIds = collectUniqueIds(coursePackage.learningGoals, "/learningGoals", issues);
  const conceptIds = collectUniqueIds(coursePackage.concepts, "/concepts", issues);
  const sceneIds = collectUniqueIds(coursePackage.scenes, "/scenes", issues);
  const targetIds = collectUniqueIds(coursePackage.semanticTargets, "/semanticTargets", issues);
  const unitIds = collectUniqueIds(coursePackage.teachingUnits, "/teachingUnits", issues);
  collectUniqueIds(coursePackage.assessments, "/assessments", issues);
  collectUniqueIds(coursePackage.preGeneratedSupplements, "/preGeneratedSupplements", issues);

  coursePackage.concepts.forEach((concept, index) =>
    checkReferences(concept.prerequisiteConceptIds, conceptIds, `/concepts/${index}/prerequisiteConceptIds`, issues),
  );
  coursePackage.scenes.forEach((scene, index) =>
    checkReferences(scene.targetIds, targetIds, `/scenes/${index}/targetIds`, issues),
  );
  coursePackage.semanticTargets.forEach((target, index) => {
    checkReference(target.sceneId, sceneIds, `/semanticTargets/${index}/sceneId`, issues);
    checkReferences(target.sourceIds, sourceIds, `/semanticTargets/${index}/sourceIds`, issues);
    if (target.kind === "image" && (!target.assetId || !target.altText)) {
      issues.push({
        path: `/semanticTargets/${index}`,
        message: "An image target requires assetId and altText",
      });
    }
    if (target.kind !== "image" && (target.assetId !== undefined || target.altText !== undefined)) {
      issues.push({
        path: `/semanticTargets/${index}`,
        message: "Only image targets can define assetId or altText",
      });
    }
  });
  coursePackage.teachingUnits.forEach((unit, index) => {
    checkReferences(unit.learningGoalIds, goalIds, `/teachingUnits/${index}/learningGoalIds`, issues);
    checkReferences(unit.prerequisiteUnitIds, unitIds, `/teachingUnits/${index}/prerequisiteUnitIds`, issues);
    checkReference(unit.sceneId, sceneIds, `/teachingUnits/${index}/sceneId`, issues);
    checkReferences(unit.focusTargetIds, targetIds, `/teachingUnits/${index}/focusTargetIds`, issues);
    checkReferences(unit.sourceIds, sourceIds, `/teachingUnits/${index}/sourceIds`, issues);
    unit.boardPatches.forEach((patch, patchIndex) => {
      checkReference(patch.targetId, targetIds, `/teachingUnits/${index}/boardPatches/${patchIndex}/targetId`, issues);
      if (patch.operation === "replace" && patch.content === undefined) {
        issues.push({
          path: `/teachingUnits/${index}/boardPatches/${patchIndex}/content`,
          message: "A replace board patch requires content",
        });
      }
    });
  });
  coursePackage.assessments.forEach((assessment, index) => {
    checkReferences(assessment.learningGoalIds, goalIds, `/assessments/${index}/learningGoalIds`, issues);
    checkReference(assessment.afterUnitId, unitIds, `/assessments/${index}/afterUnitId`, issues);
    if (assessment.responseKind === "multiple-choice" && assessment.options.length < 2) {
      issues.push({ path: `/assessments/${index}/options`, message: "A multiple-choice assessment requires at least two options" });
    }
    if (assessment.responseKind === "short-answer" && assessment.options.length > 0) {
      issues.push({ path: `/assessments/${index}/options`, message: "A short-answer assessment cannot define options" });
    }
  });
  coursePackage.preGeneratedSupplements.forEach((supplement, index) =>
    checkReferences(supplement.unitIds, unitIds, `/preGeneratedSupplements/${index}/unitIds`, issues),
  );
  checkReferences(coursePackage.schedule.orderedUnitIds, unitIds, "/schedule/orderedUnitIds", issues);
  checkReferences(coursePackage.schedule.optionalUnitIds, unitIds, "/schedule/optionalUnitIds", issues);

  const scheduled = new Set(coursePackage.schedule.orderedUnitIds);
  coursePackage.teachingUnits.forEach((unit, index) => {
    if (unit.kind === "main" && !scheduled.has(unit.id)) {
      issues.push({ path: `/teachingUnits/${index}/id`, message: `Main teaching unit ${unit.id} is missing from the schedule` });
    }
  });
  return issues;
}

function collectUniqueIds(values: readonly { id: string }[], path: string, issues: ValidationIssue[]): ReadonlySet<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id)) issues.push({ path: `${path}/${index}/id`, message: `Duplicate id ${value.id}` });
    ids.add(value.id);
  });
  return ids;
}

function checkReferences(references: readonly string[], knownIds: ReadonlySet<string>, path: string, issues: ValidationIssue[]) {
  references.forEach((reference, index) => checkReference(reference, knownIds, `${path}/${index}`, issues));
}

function checkReference(reference: string, knownIds: ReadonlySet<string>, path: string, issues: ValidationIssue[]) {
  if (!knownIds.has(reference)) issues.push({ path, message: `Unknown reference ${reference}` });
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value as DeepReadonly<T>;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
