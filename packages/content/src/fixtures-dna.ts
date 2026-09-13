import { parseCoursePackage, type CoursePackage } from "@aituber/contracts";
import { unit } from "./fixture-helpers.ts";

const sourceId = "source.dna";
const dna = {
  schemaVersion: "1.0.0", id: "course.dna-replication", version: 1, status: "available",
  contentHash: "sha256:2d56433fd7dd46cbc1a15aa81332a4b86712cd1fb165995aec61c01087d0bd2b",
  title: "DNA複製：二本の鎖がコピーされる仕組み", targetLevel: "高校生物", durationMinutes: 6,
  sources: [{ id: sourceId, kind: "markdown", fileName: "dna-replication.md", contentHash: "sha256:2d56433fd7dd46cbc1a15aa81332a4b86712cd1fb165995aec61c01087d0bd2b", rights: { basis: "owned" } }],
  learningGoals: [
    { id: "goal.dna.semi-conservative", description: "半保存的複製の意味を説明する" },
    { id: "goal.dna.enzyme-order", description: "DNA複製に関わる酵素の働きを順に説明する" },
    { id: "goal.dna.strands", description: "リーディング鎖とラギング鎖の違いを説明する" },
  ],
  concepts: [
    { id: "concept.dna.double-helix", label: "DNA二重らせん", prerequisiteConceptIds: [] },
    { id: "concept.dna.antiparallel", label: "逆平行", prerequisiteConceptIds: ["concept.dna.double-helix"] },
    { id: "concept.dna.polymerase", label: "DNAポリメラーゼ", prerequisiteConceptIds: ["concept.dna.antiparallel"] },
    { id: "concept.dna.fragments", label: "岡崎フラグメント", prerequisiteConceptIds: ["concept.dna.polymerase"] },
  ],
  scenes: [
    { id: "scene.dna.concept", title: "半保存的複製", templateId: "split", targetIds: ["target.dna.parent", "target.dna.daughters"] },
    { id: "scene.dna.fork", title: "複製フォーク", templateId: "board", targetIds: ["target.dna.helicase", "target.dna.primer", "target.dna.polymerase"] },
    { id: "scene.dna.strands", title: "二つの合成方法", templateId: "split", targetIds: ["target.dna.leading", "target.dna.lagging", "target.dna.direction"] },
    { id: "scene.dna.finish", title: "断片を一本につなぐ", templateId: "board", targetIds: ["target.dna.remove-primer", "target.dna.ligase", "target.dna.sequence"] },
  ],
  semanticTargets: [
    { id: "target.dna.parent", sceneId: "scene.dna.concept", kind: "diagram", label: "親DNA", content: "親鎖A ║ 親鎖B", sourceIds: [sourceId] },
    { id: "target.dna.daughters", sceneId: "scene.dna.concept", kind: "diagram", label: "二つの娘DNA", content: "親鎖A＋新生鎖 / 親鎖B＋新生鎖", sourceIds: [sourceId] },
    { id: "target.dna.helicase", sceneId: "scene.dna.fork", kind: "diagram", label: "1 ヘリカーゼ", content: "二本鎖をほどき、複製フォークを開く。", sourceIds: [sourceId] },
    { id: "target.dna.primer", sceneId: "scene.dna.fork", kind: "diagram", label: "2 プライマーゼ", content: "DNA合成を始めるRNAプライマーを置く。", sourceIds: [sourceId] },
    { id: "target.dna.polymerase", sceneId: "scene.dna.fork", kind: "diagram", label: "3 DNAポリメラーゼ", content: "プライマーから新生鎖を5'→3'へ伸ばす。", sourceIds: [sourceId] },
    { id: "target.dna.leading", sceneId: "scene.dna.strands", kind: "text", label: "リーディング鎖", content: "複製フォークへ向かい、連続的に合成される。", sourceIds: [sourceId] },
    { id: "target.dna.lagging", sceneId: "scene.dna.strands", kind: "text", label: "ラギング鎖", content: "フォークと反対向きに、岡崎フラグメントとして合成される。", sourceIds: [sourceId] },
    { id: "target.dna.direction", sceneId: "scene.dna.strands", kind: "formula", label: "合成方向", content: "5' → 3'", sourceIds: [sourceId] },
    { id: "target.dna.remove-primer", sceneId: "scene.dna.finish", kind: "diagram", label: "4 プライマー除去・置換", content: "RNA部分を除きDNAへ置き換える。", sourceIds: [sourceId] },
    { id: "target.dna.ligase", sceneId: "scene.dna.finish", kind: "diagram", label: "5 DNAリガーゼ", content: "岡崎フラグメント間の切れ目をつなぐ。", sourceIds: [sourceId] },
    { id: "target.dna.sequence", sceneId: "scene.dna.finish", kind: "text", label: "全体の順序", content: "ほどく → 始点を置く → 伸ばす → RNAを置換 → つなぐ", sourceIds: [sourceId] },
  ],
  teachingUnits: [
    unit({ id: "unit.dna.concept", kind: "main", learningGoalIds: ["goal.dna.semi-conservative"], prerequisiteUnitIds: [], sceneId: "scene.dna.concept", focusTargetIds: ["target.dna.parent", "target.dna.daughters"], speechText: "DNA複製は半保存的です。完成したDNAはそれぞれ、親から受け継いだ鎖一本と、新しく作った鎖一本を持ちます。", captionText: "娘DNAは、親鎖一本と新生鎖一本を持ちます。", estimatedDurationMs: 55_000, sourceId, postcondition: "半保存的複製を説明できる" }),
    unit({ id: "unit.dna.open", kind: "main", learningGoalIds: ["goal.dna.enzyme-order"], prerequisiteUnitIds: ["unit.dna.concept"], sceneId: "scene.dna.fork", focusTargetIds: ["target.dna.helicase"], speechText: "最初にヘリカーゼが塩基対の結合をほどきます。開いた境界を複製フォークと呼びます。", captionText: "ヘリカーゼが二本鎖をほどきます。", estimatedDurationMs: 50_000, sourceId, postcondition: "ヘリカーゼの働きを説明できる" }),
    unit({ id: "unit.dna.start", kind: "main", learningGoalIds: ["goal.dna.enzyme-order"], prerequisiteUnitIds: ["unit.dna.open"], sceneId: "scene.dna.fork", focusTargetIds: ["target.dna.primer", "target.dna.polymerase"], speechText: "プライマーゼが短いRNAの始点を置き、DNAポリメラーゼがそこから新しいDNAを伸ばします。", captionText: "プライマーを始点にDNAポリメラーゼが伸長します。", estimatedDurationMs: 55_000, sourceId, postcondition: "合成開始の順序を説明できる" }),
    unit({ id: "unit.dna.direction", kind: "main", learningGoalIds: ["goal.dna.strands"], prerequisiteUnitIds: ["unit.dna.start"], sceneId: "scene.dna.strands", focusTargetIds: ["target.dna.direction", "target.dna.leading", "target.dna.lagging"], speechText: "ポリメラーゼが伸ばせる方向は5プライムから3プライムだけです。鋳型が逆平行なので、片方は連続、もう片方は断片的になります。", captionText: "5'→3'の制約から、連続鎖と不連続鎖が生じます。", estimatedDurationMs: 75_000, sourceId, postcondition: "二つの合成方法が生じる理由を説明できる" }),
    unit({ id: "unit.dna.join", kind: "main", learningGoalIds: ["goal.dna.enzyme-order", "goal.dna.strands"], prerequisiteUnitIds: ["unit.dna.direction"], sceneId: "scene.dna.finish", focusTargetIds: ["target.dna.remove-primer", "target.dna.ligase"], speechText: "ラギング鎖ではRNAプライマーをDNAへ置き換え、DNAリガーゼが岡崎フラグメント間の切れ目をつなぎます。", captionText: "プライマー置換後、DNAリガーゼが断片をつなぎます。", estimatedDurationMs: 60_000, sourceId, postcondition: "ラギング鎖の完成過程を説明できる" }),
    unit({ id: "unit.dna.summary", kind: "checkpoint", learningGoalIds: ["goal.dna.semi-conservative", "goal.dna.enzyme-order", "goal.dna.strands"], prerequisiteUnitIds: ["unit.dna.join"], sceneId: "scene.dna.finish", focusTargetIds: ["target.dna.sequence"], speechText: "ほどく、始点を置く、伸ばす、RNAを置き換える、つなぐ。この順序と、常に5プライムから3プライムへ伸びる点を押さえましょう。", captionText: "ほどく → 始点 → 伸長 → 置換 → 連結の順です。", estimatedDurationMs: 60_000, sourceId, postcondition: "DNA複製の順序を説明できる" }),
    unit({ id: "unit.dna.supplement-okazaki", kind: "supplement", learningGoalIds: ["goal.dna.strands"], prerequisiteUnitIds: ["unit.dna.direction"], sceneId: "scene.dna.strands", focusTargetIds: ["target.dna.lagging", "target.dna.direction"], speechText: "ラギング鎖も合成方向は5プライムから3プライムです。フォークが開くたびに新しい始点を作るため、短い断片に分かれます。", captionText: "同じ5'→3'合成を繰り返すため断片になります。", estimatedDurationMs: 45_000, sourceId, postcondition: "岡崎フラグメントが生じる理由を説明できる", skippable: true }),
  ],
  assessments: [{ id: "assessment.dna.order", learningGoalIds: ["goal.dna.enzyme-order"], afterUnitId: "unit.dna.summary", prompt: "DNAポリメラーゼが伸長を始める前に必要な出来事はどれですか。", responseKind: "multiple-choice", options: ["RNAプライマーが置かれる", "DNAリガーゼが断片をつなぐ", "岡崎フラグメントが除去される"], rubric: { criteria: ["RNAプライマーが置かれるを選ぶ"], commonMistakes: ["DNAリガーゼを合成開始酵素と混同する"] } }],
  preGeneratedSupplements: [{ id: "supplement.dna.okazaki", triggerQuestions: ["なぜラギング鎖だけ断片になりますか", "岡崎フラグメントとは何ですか"], unitIds: ["unit.dna.supplement-okazaki"], autoPlayEligible: true }],
  pronunciationDictionary: [{ surface: "5'→3'", reading: "ファイブプライムからスリープライム" }, { surface: "DNA", reading: "ディーエヌエー" }],
  schedule: { orderedUnitIds: ["unit.dna.concept", "unit.dna.open", "unit.dna.start", "unit.dna.direction", "unit.dna.join", "unit.dna.summary"], optionalUnitIds: ["unit.dna.supplement-okazaki"] },
} satisfies CoursePackage;

export const dnaReplicationFixture = parseCoursePackage(dna);
