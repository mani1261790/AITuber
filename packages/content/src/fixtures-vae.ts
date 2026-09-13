import { parseCoursePackage, type CoursePackage } from "@aituber/contracts";
import { unit } from "./fixture-helpers.ts";

const sourceId = "source.vae";
const vae = {
  schemaVersion: "1.0.0", id: "course.vae-reparameterization", version: 1, status: "available",
  contentHash: "sha256:94e6a368f8b08701428c6fa41ce216db050c88cfb3a710baa07dee3772a56c45",
  title: "VAE：再パラメータ化トリック", targetLevel: "大学・機械学習入門後", durationMinutes: 6,
  sources: [{ id: sourceId, kind: "markdown", fileName: "vae-reparameterization.md", contentHash: "sha256:94e6a368f8b08701428c6fa41ce216db050c88cfb3a710baa07dee3772a56c45", rights: { basis: "owned" } }],
  learningGoals: [
    { id: "goal.vae.problem", description: "直接サンプリングが逆伝播を難しくする理由を説明する" },
    { id: "goal.vae.transform", description: "再パラメータ化の式と各変数の役割を説明する" },
    { id: "goal.vae.gradient", description: "確率性を分離すると勾配を流せる理由を説明する" },
  ],
  concepts: [
    { id: "concept.vae.normal", label: "正規分布", prerequisiteConceptIds: [] },
    { id: "concept.vae.backprop", label: "逆伝播", prerequisiteConceptIds: [] },
    { id: "concept.vae.posterior", label: "近似事後分布", prerequisiteConceptIds: ["concept.vae.normal"] },
    { id: "concept.vae.reparameterization", label: "再パラメータ化", prerequisiteConceptIds: ["concept.vae.posterior", "concept.vae.backprop"] },
    { id: "concept.vae.elbo", label: "ELBO", prerequisiteConceptIds: ["concept.vae.reparameterization"] },
  ],
  scenes: [
    { id: "scene.vae.encoder", title: "エンコーダーが出す分布", templateId: "board", targetIds: ["target.vae.posterior", "target.vae.mu", "target.vae.sigma"] },
    { id: "scene.vae.problem", title: "確率的ノードの問題", templateId: "split", targetIds: ["target.vae.direct-sample", "target.vae.blocked-gradient"] },
    { id: "scene.vae.transform", title: "確率性をepsilonへ分離", templateId: "board", targetIds: ["target.vae.epsilon", "target.vae.transform", "target.vae.elementwise"] },
    { id: "scene.vae.gradient", title: "勾配が通る経路", templateId: "split", targetIds: ["target.vae.path", "target.vae.elbo"] },
  ],
  semanticTargets: [
    { id: "target.vae.posterior", sceneId: "scene.vae.encoder", kind: "formula", label: "近似事後分布", content: "q_\\phi(z \\mid x) = \\mathcal{N}(\\mu_\\phi(x), \\operatorname{diag}(\\sigma_\\phi(x)^2))", sourceIds: [sourceId] },
    { id: "target.vae.mu", sceneId: "scene.vae.encoder", kind: "text", label: "mu", content: "潜在分布の平均。エンコーダーの学習可能な出力。", sourceIds: [sourceId] },
    { id: "target.vae.sigma", sceneId: "scene.vae.encoder", kind: "text", label: "sigma", content: "潜在分布の標準偏差。正の値として表す。", sourceIds: [sourceId] },
    { id: "target.vae.direct-sample", sceneId: "scene.vae.problem", kind: "diagram", label: "直接サンプリング", content: "x → (mu, sigma) → [ z ~ q_phi(z|x) ] → decoder", sourceIds: [sourceId] },
    { id: "target.vae.blocked-gradient", sceneId: "scene.vae.problem", kind: "text", label: "問題点", content: "zを得る操作が確率的なため、通常の決定的計算グラフとして扱いにくい。", sourceIds: [sourceId] },
    { id: "target.vae.epsilon", sceneId: "scene.vae.transform", kind: "formula", label: "独立なノイズ", content: "\\varepsilon \\sim \\mathcal{N}(0, I)", sourceIds: [sourceId] },
    { id: "target.vae.transform", sceneId: "scene.vae.transform", kind: "formula", label: "再パラメータ化", content: "z = \\mu + \\sigma \\odot \\varepsilon", sourceIds: [sourceId] },
    { id: "target.vae.elementwise", sceneId: "scene.vae.transform", kind: "text", label: "要素積", content: "⊙はベクトルの対応する要素同士の積。", sourceIds: [sourceId] },
    { id: "target.vae.path", sceneId: "scene.vae.gradient", kind: "diagram", label: "勾配経路", content: "loss → z → mu, sigma → encoder parameters phi", sourceIds: [sourceId] },
    { id: "target.vae.elbo", sceneId: "scene.vae.gradient", kind: "formula", label: "ELBOの構成", content: "\\mathbb{E}_{q}[\\log p_\\theta(x \\mid z)] - \\operatorname{KL}(q_\\phi(z \\mid x) \\parallel p(z))", sourceIds: [sourceId] },
  ],
  teachingUnits: [
    unit({ id: "unit.vae.prerequisite", kind: "main", learningGoalIds: ["goal.vae.problem"], prerequisiteUnitIds: [], sceneId: "scene.vae.encoder", focusTargetIds: ["target.vae.posterior", "target.vae.mu", "target.vae.sigma"], speechText: "エンコーダーは潜在変数そのものではなく、入力ごとの平均と標準偏差を出し、近似事後分布を定めます。", captionText: "エンコーダーはq_phi(z|x)のmuとsigmaを出力します。", estimatedDurationMs: 60_000, sourceId, postcondition: "エンコーダー出力と近似事後分布を対応付けられる" }),
    unit({ id: "unit.vae.sampling-problem", kind: "main", learningGoalIds: ["goal.vae.problem"], prerequisiteUnitIds: ["unit.vae.prerequisite"], sceneId: "scene.vae.problem", focusTargetIds: ["target.vae.direct-sample", "target.vae.blocked-gradient"], speechText: "この分布からzを直接引く操作は確率的です。損失からエンコーダーへ通常の逆伝播をつなぐには、この確率性を扱いやすい形へ移す必要があります。", captionText: "直接サンプリングは、通常の決定的な勾配経路を作りにくくします。", estimatedDurationMs: 65_000, sourceId, postcondition: "直接サンプリングの問題を説明できる" }),
    unit({ id: "unit.vae.epsilon", kind: "main", learningGoalIds: ["goal.vae.transform"], prerequisiteUnitIds: ["unit.vae.sampling-problem"], sceneId: "scene.vae.transform", focusTargetIds: ["target.vae.epsilon"], speechText: "まずパラメーターに依存しない標準正規分布からepsilonを引きます。学習中の確率性は、このepsilonへ集めます。", captionText: "epsilonはN(0, I)から独立にサンプリングします。", estimatedDurationMs: 50_000, sourceId, postcondition: "epsilonの分布と独立性を説明できる" }),
    unit({ id: "unit.vae.transform", kind: "main", learningGoalIds: ["goal.vae.transform"], prerequisiteUnitIds: ["unit.vae.epsilon"], sceneId: "scene.vae.transform", focusTargetIds: ["target.vae.transform", "target.vae.elementwise"], speechText: "zはmuたすsigmaかけるepsilonと計算します。muとsigmaが分布の位置と広がりを決め、epsilonが今回の揺らぎを決めます。", captionText: "z = mu + sigma ⊙ epsilon と決定的に計算します。", estimatedDurationMs: 65_000, sourceId, postcondition: "再パラメータ化の式を説明できる" }),
    unit({ id: "unit.vae.gradient", kind: "main", learningGoalIds: ["goal.vae.gradient"], prerequisiteUnitIds: ["unit.vae.transform"], sceneId: "scene.vae.gradient", focusTargetIds: ["target.vae.path"], speechText: "epsilonを固定すれば、zはmuとsigmaの決定的な関数です。そのため損失の勾配をzからmuとsigma、さらにエンコーダーへ流せます。", captionText: "確率性をepsilonへ分離し、muとsigmaに勾配を流します。", estimatedDurationMs: 60_000, sourceId, postcondition: "勾配が流れる計算経路を説明できる" }),
    unit({ id: "unit.vae.elbo", kind: "checkpoint", learningGoalIds: ["goal.vae.gradient"], prerequisiteUnitIds: ["unit.vae.gradient"], sceneId: "scene.vae.gradient", focusTargetIds: ["target.vae.elbo", "target.vae.path"], speechText: "この経路で再構成項の期待値を最適化しながら、KL項で近似事後分布を事前分布へ近づけます。再パラメータ化はこの学習を実装可能にします。", captionText: "再構成項とKL項を含むELBOを勾配で最適化します。", estimatedDurationMs: 60_000, sourceId, postcondition: "再パラメータ化とELBO最適化を関連付けられる" }),
    unit({ id: "unit.vae.supplement-normal", kind: "supplement", learningGoalIds: ["goal.vae.transform"], prerequisiteUnitIds: ["unit.vae.prerequisite"], sceneId: "scene.vae.transform", focusTargetIds: ["target.vae.epsilon", "target.vae.transform"], speechText: "一次元では標準正規のepsilonをsigma倍すると標準偏差がsigmaになり、muを足すと平均がmuへ移ります。多次元ではこれを要素ごとに行います。", captionText: "標準正規をsigma倍しmuを足すと、目的の正規分布になります。", estimatedDurationMs: 50_000, sourceId, postcondition: "変換後の平均と標準偏差を説明できる", skippable: true }),
  ],
  assessments: [{ id: "assessment.vae.roles", learningGoalIds: ["goal.vae.transform", "goal.vae.gradient"], afterUnitId: "unit.vae.elbo", prompt: "再パラメータ化で、モデルのパラメーターから独立にサンプリングする変数はどれですか。", responseKind: "multiple-choice", options: ["epsilon", "mu", "sigma", "phi"], rubric: { criteria: ["epsilonを選ぶ", "epsilonがN(0, I)から引かれると説明する"], commonMistakes: ["z自体を独立ノイズとみなす", "muをサンプリング値とみなす"] } }],
  preGeneratedSupplements: [{ id: "supplement.vae.normal-transform", triggerQuestions: ["なぜこの式で同じ分布になりますか", "epsilonは何ですか", "sigmaを掛ける意味は何ですか"], unitIds: ["unit.vae.supplement-normal"], autoPlayEligible: true }],
  pronunciationDictionary: [
    { surface: "epsilon", reading: "イプシロン" },
    { surface: "sigma", reading: "シグマ" },
    { surface: "mu", reading: "ミュー" },
    { surface: "phi", reading: "ファイ" },
    { surface: "z", reading: "ゼット" },
    { surface: "⊙", reading: "要素ごとの積" },
    { surface: "ELBO", reading: "エルボ" },
    { surface: "KL", reading: "ケーエル" },
  ],
  schedule: { orderedUnitIds: ["unit.vae.prerequisite", "unit.vae.sampling-problem", "unit.vae.epsilon", "unit.vae.transform", "unit.vae.gradient", "unit.vae.elbo"], optionalUnitIds: ["unit.vae.supplement-normal"] },
} satisfies CoursePackage;

export const vaeReparameterizationFixture = parseCoursePackage(vae);
