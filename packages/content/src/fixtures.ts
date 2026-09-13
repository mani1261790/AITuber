import { parseCoursePackage, type CoursePackage, type ReadonlyCoursePackage } from "@aituber/contracts";
import { unit } from "./fixture-helpers.ts";
import { dnaReplicationFixture } from "./fixtures-dna.ts";
import { vaeReparameterizationFixture } from "./fixtures-vae.ts";

const quadratic = {
  schemaVersion: "1.0.0", id: "course.quadratic-functions", version: 1, status: "available",
  contentHash: "sha256:1f598c02a2f59cb8b4c5de5a84296f2ed519ebaafae853468eaed75097f8c485",
  title: "二次関数：平方完成から頂点を読む", targetLevel: "高校数学I", durationMinutes: 6,
  sources: [{ id: "source.quadratic", kind: "markdown", fileName: "quadratic-functions.md", contentHash: "sha256:1f598c02a2f59cb8b4c5de5a84296f2ed519ebaafae853468eaed75097f8c485", rights: { basis: "owned" } }],
  learningGoals: [
    { id: "goal.math.vertex-form", description: "頂点形式から放物線の頂点と対称軸を読み取る" },
    { id: "goal.math.complete-square", description: "一般形を平方完成して頂点形式へ変形する" },
    { id: "goal.math.calculate", description: "具体的な二次関数の頂点と値を計算する" },
  ],
  concepts: [
    { id: "concept.math.quadratic", label: "二次関数", prerequisiteConceptIds: [] },
    { id: "concept.math.parabola", label: "放物線", prerequisiteConceptIds: ["concept.math.quadratic"] },
    { id: "concept.math.completing-square", label: "平方完成", prerequisiteConceptIds: ["concept.math.quadratic"] },
    { id: "concept.math.vertex", label: "頂点", prerequisiteConceptIds: ["concept.math.parabola", "concept.math.completing-square"] },
  ],
  scenes: [
    { id: "scene.math.form", title: "頂点形式", templateId: "board", targetIds: ["target.math.vertex-form", "target.math.h-term", "target.math.k-term"] },
    { id: "scene.math.graph", title: "放物線と対称軸", templateId: "split", targetIds: ["target.math.graph", "target.math.axis"] },
    { id: "scene.math.complete", title: "平方完成", templateId: "board", targetIds: ["target.math.general-form", "target.math.square-step", "target.math.completed-form"] },
    { id: "scene.math.example", title: "例題", templateId: "split", targetIds: ["target.math.example-formula", "target.math.example-answer"] },
  ],
  semanticTargets: [
    { id: "target.math.vertex-form", sceneId: "scene.math.form", kind: "formula", label: "頂点形式", content: "y = a(x - h)^2 + k", sourceIds: ["source.quadratic"] },
    { id: "target.math.h-term", sceneId: "scene.math.form", kind: "formula", label: "hの項", content: "(x - h)", sourceIds: ["source.quadratic"] },
    { id: "target.math.k-term", sceneId: "scene.math.form", kind: "formula", label: "kの項", content: "+ k", sourceIds: ["source.quadratic"] },
    { id: "target.math.graph", sceneId: "scene.math.graph", kind: "diagram", label: "放物線の模式グラフ", content: "頂点(h, k)を中心に左右対称なU字形。a<0では上下反転。", sourceIds: ["source.quadratic"] },
    { id: "target.math.axis", sceneId: "scene.math.graph", kind: "formula", label: "対称軸", content: "x = h", sourceIds: ["source.quadratic"] },
    { id: "target.math.general-form", sceneId: "scene.math.complete", kind: "formula", label: "一般形", content: "y = x^2 - 4x + 3", sourceIds: ["source.quadratic"] },
    { id: "target.math.square-step", sceneId: "scene.math.complete", kind: "formula", label: "平方を作る部分", content: "x^2 - 4x = (x - 2)^2 - 4", sourceIds: ["source.quadratic"] },
    { id: "target.math.completed-form", sceneId: "scene.math.complete", kind: "formula", label: "平方完成後", content: "y = (x - 2)^2 - 1", sourceIds: ["source.quadratic"] },
    { id: "target.math.example-formula", sceneId: "scene.math.example", kind: "formula", label: "計算対象", content: "y = x^2 - 4x + 3", sourceIds: ["source.quadratic"] },
    { id: "target.math.example-answer", sceneId: "scene.math.example", kind: "text", label: "読み取り結果", content: "頂点は(2, -1)、対称軸はx = 2。", sourceIds: ["source.quadratic"] },
  ],
  teachingUnits: [
    unit({ id: "unit.math.intro", kind: "main", learningGoalIds: ["goal.math.vertex-form"], prerequisiteUnitIds: [], sceneId: "scene.math.form", focusTargetIds: ["target.math.vertex-form"], speechText: "二次関数を頂点形式で見ると、グラフの中心となる頂点を式から直接読み取れます。", captionText: "頂点形式から、放物線の頂点を直接読み取れます。", estimatedDurationMs: 50_000, sourceId: "source.quadratic", postcondition: "頂点形式を識別できる" }),
    unit({ id: "unit.math.parts", kind: "main", learningGoalIds: ["goal.math.vertex-form"], prerequisiteUnitIds: ["unit.math.intro"], sceneId: "scene.math.form", focusTargetIds: ["target.math.h-term", "target.math.k-term"], speechText: "括弧の中は符号を反対に読んでh、式の末尾からkを読みます。頂点はhコンマkです。", captionText: "(x - h)のhと末尾のkから、頂点(h, k)を読みます。", estimatedDurationMs: 55_000, sourceId: "source.quadratic", postcondition: "式の部分と頂点座標を対応付けられる" }),
    unit({ id: "unit.math.graph", kind: "main", learningGoalIds: ["goal.math.vertex-form"], prerequisiteUnitIds: ["unit.math.parts"], sceneId: "scene.math.graph", focusTargetIds: ["target.math.graph", "target.math.axis"], speechText: "放物線は頂点を通る縦線を軸に左右対称です。頂点のx座標hが、そのまま対称軸xイコールhになります。", captionText: "放物線はx = hを軸に左右対称です。", estimatedDurationMs: 55_000, sourceId: "source.quadratic", postcondition: "頂点と対称軸の関係を説明できる" }),
    unit({ id: "unit.math.complete", kind: "main", learningGoalIds: ["goal.math.complete-square"], prerequisiteUnitIds: ["unit.math.graph"], sceneId: "scene.math.complete", focusTargetIds: ["target.math.general-form", "target.math.square-step", "target.math.completed-form"], speechText: "一般形では、xの係数の半分を使って平方を作ります。足した分と同じだけ引き、値を変えずに頂点形式へ直します。", captionText: "xの係数の半分を使い、値を保ったまま平方完成します。", estimatedDurationMs: 75_000, sourceId: "source.quadratic", postcondition: "例の一般形を平方完成できる" }),
    unit({ id: "unit.math.example", kind: "checkpoint", learningGoalIds: ["goal.math.calculate"], prerequisiteUnitIds: ["unit.math.complete"], sceneId: "scene.math.example", focusTargetIds: ["target.math.example-formula", "target.math.example-answer"], speechText: "平方完成した結果から、頂点は2コンママイナス1、対称軸はxイコール2と確認できます。", captionText: "頂点は(2, -1)、対称軸はx = 2です。", estimatedDurationMs: 55_000, sourceId: "source.quadratic", postcondition: "具体例の頂点と対称軸を求められる" }),
    unit({ id: "unit.math.summary", kind: "main", learningGoalIds: ["goal.math.vertex-form", "goal.math.complete-square", "goal.math.calculate"], prerequisiteUnitIds: ["unit.math.example"], sceneId: "scene.math.example", focusTargetIds: ["target.math.example-answer"], speechText: "頂点形式へ直す、hとkを読む、対称軸を確認する。この順番で二次関数の形をつかめます。", captionText: "平方完成、頂点の読み取り、対称軸の確認が基本手順です。", estimatedDurationMs: 55_000, sourceId: "source.quadratic", postcondition: "頂点を求める手順を説明できる" }),
    unit({ id: "unit.math.supplement-sign", kind: "supplement", learningGoalIds: ["goal.math.vertex-form"], prerequisiteUnitIds: ["unit.math.intro"], sceneId: "scene.math.form", focusTargetIds: ["target.math.h-term"], speechText: "xマイナスhがゼロになるのはxイコールhです。そのため括弧内の見た目とは反対の符号で読みます。", captionText: "(x - h) = 0となるx = hを読みます。", estimatedDurationMs: 40_000, sourceId: "source.quadratic", postcondition: "hの符号を正しく読める", skippable: true }),
  ],
  assessments: [{ id: "assessment.math.vertex", learningGoalIds: ["goal.math.calculate"], afterUnitId: "unit.math.example", prompt: "y = (x + 3)^2 - 4 の頂点を答えてください。", responseKind: "short-answer", options: [], rubric: { criteria: ["頂点を(-3, -4)と答える", "xの符号を反対に読む"], commonMistakes: ["(3, -4)と答える", "(-3, 4)と答える"] } }],
  preGeneratedSupplements: [{ id: "supplement.math.sign", triggerQuestions: ["なぜ括弧の符号を反対に読むのですか", "x + 3のときhはいくつですか"], unitIds: ["unit.math.supplement-sign"], autoPlayEligible: true }],
  pronunciationDictionary: [
    { surface: "a(x - h)^2 + k", reading: "エーかける、エックスひくエイチの二乗、たすケー" },
    { surface: "x", reading: "エックス" },
    { surface: "h", reading: "エイチ" },
    { surface: "k", reading: "ケー" },
  ],
  schedule: { orderedUnitIds: ["unit.math.intro", "unit.math.parts", "unit.math.graph", "unit.math.complete", "unit.math.example", "unit.math.summary"], optionalUnitIds: ["unit.math.supplement-sign"] },
} satisfies CoursePackage;

export const quadraticFunctionsFixture = parseCoursePackage(quadratic);

export { dnaReplicationFixture, vaeReparameterizationFixture };
export const coursePackageFixtures: readonly ReadonlyCoursePackage[] = [
  quadraticFunctionsFixture,
  dnaReplicationFixture,
  vaeReparameterizationFixture,
];

export interface FixtureQuestionScenario {
  readonly id: string;
  readonly coursePackageId: string;
  readonly afterUnitId: string;
  readonly question: string;
  readonly supplementId: string;
  readonly expectedResumeUnitId: string;
}

export const fixtureQuestionScenarios: readonly FixtureQuestionScenario[] = [
  {
    id: "scenario.math.sign",
    coursePackageId: quadraticFunctionsFixture.id,
    afterUnitId: "unit.math.parts",
    question: "なぜ括弧の符号を反対に読むのですか。",
    supplementId: "supplement.math.sign",
    expectedResumeUnitId: "unit.math.graph",
  },
  {
    id: "scenario.dna.okazaki",
    coursePackageId: dnaReplicationFixture.id,
    afterUnitId: "unit.dna.direction",
    question: "なぜラギング鎖だけ断片になりますか。",
    supplementId: "supplement.dna.okazaki",
    expectedResumeUnitId: "unit.dna.join",
  },
  {
    id: "scenario.vae.prerequisite-rejoin",
    coursePackageId: vaeReparameterizationFixture.id,
    afterUnitId: "unit.vae.sampling-problem",
    question: "標準正規分布から目的の分布を作れるのはなぜですか。",
    supplementId: "supplement.vae.normal-transform",
    expectedResumeUnitId: "unit.vae.epsilon",
  },
  {
    id: "scenario.vae.later-rejoin",
    coursePackageId: vaeReparameterizationFixture.id,
    afterUnitId: "unit.vae.transform",
    question: "sigmaを掛ける意味をもう一度説明してください。",
    supplementId: "supplement.vae.normal-transform",
    expectedResumeUnitId: "unit.vae.gradient",
  },
];
