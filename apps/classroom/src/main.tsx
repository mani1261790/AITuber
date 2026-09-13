import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseCoursePackage, type CoursePackage } from "@aituber/contracts";
import { createBoardState, focusSemanticTarget, resolveStageScene } from "@aituber/presentation";
import { TargetView } from "./target-view.tsx";
import "./styles.css";

const HASH = `sha256:${"c".repeat(64)}`;
const demoCourse = parseCoursePackage({
  schemaVersion: "1.0.0", id: "course.preview", version: 1, status: "available", contentHash: HASH,
  title: "二次関数：放物線の頂点", targetLevel: "高校数学", durationMinutes: 6,
  sources: [{ id: "source.preview", kind: "markdown", fileName: "preview.md", contentHash: HASH, rights: { basis: "owned" } }],
  learningGoals: [{ id: "goal.vertex", description: "平方完成した式から放物線の頂点を読み取る" }],
  concepts: [{ id: "concept.vertex", label: "放物線の頂点", prerequisiteConceptIds: [] }],
  scenes: [{ id: "scene.vertex", title: "平方完成と頂点", templateId: "split", targetIds: ["target.explanation", "target.reading", "target.formula"] }],
  semanticTargets: [
    { id: "target.explanation", sceneId: "scene.vertex", kind: "text", label: "頂点の見つけ方", content: "平方完成すると、放物線の頂点を式から直接読み取れます。", sourceIds: ["source.preview"] },
    { id: "target.formula", sceneId: "scene.vertex", kind: "formula", label: "平方完成した式", content: "y = (x − 2)² − 1", sourceIds: ["source.preview"] },
    { id: "target.reading", sceneId: "scene.vertex", kind: "diagram", label: "頂点の読み取り", content: "x = 2 のとき最小値 −1。頂点は (2, −1)。", sourceIds: ["source.preview"] },
  ],
  teachingUnits: [{ id: "unit.vertex", kind: "main", learningGoalIds: ["goal.vertex"], prerequisiteUnitIds: [], postconditions: ["頂点を読み取れる"], sceneId: "scene.vertex", boardPatches: [], focusTargetIds: ["target.formula"], speechText: "平方完成した式の2とマイナス1に注目してください。", captionText: "平方完成した式の2とマイナス1に注目してください。", skippable: false, estimatedDurationMs: 8_000, sourceIds: ["source.preview"] }],
  assessments: [], preGeneratedSupplements: [], pronunciationDictionary: [], schedule: { orderedUnitIds: ["unit.vertex"], optionalUnitIds: [] },
} satisfies CoursePackage);

function ClassroomApp() {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>("target.formula");
  const scene = useMemo(() => {
    const board = focusSemanticTarget(demoCourse, createBoardState(demoCourse, "scene.vertex"), selectedTargetId);
    return resolveStageScene(demoCourse, "scene.vertex", board);
  }, [selectedTargetId]);

  return (
    <main className="classroom-shell">
      <header className="lesson-header">
        <div>
          <p className="lesson-status"><span aria-hidden="true">●</span> 講義中</p>
          <h1>{demoCourse.title}</h1>
          <p className="current-concept">現在の概念: <strong>放物線の頂点</strong></p>
        </div>
        <p className="lesson-progress" aria-label="講義の進行状況">2 / 5</p>
      </header>

      <section className="stage" aria-labelledby="scene-title">
        <div className="scene-heading">
          <h2 id="scene-title">{scene.title}</h2>
          <p>質問したい箇所を選べます</p>
        </div>
        <div className={`scene-grid scene-grid--${scene.templateId}`}>
          {scene.targets.filter((target) => target.visible).map((target) => (
            <TargetView key={target.id} target={target} onSelect={setSelectedTargetId} />
          ))}
        </div>
      </section>

      <section className="caption" aria-labelledby="caption-title" aria-live="polite">
        <h2 id="caption-title">字幕</h2>
        <p>平方完成した式の2とマイナス1に注目してください。</p>
      </section>

      <nav className="target-list" aria-label="質問対象">
        <h2>質問する箇所</h2>
        <div className="target-controls">
          {scene.targets.map((target) => (
            <button key={target.id} type="button" aria-pressed={target.focused} onClick={() => setSelectedTargetId(target.id)}>
              {target.label}{target.focused ? "（選択中）" : ""}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Classroom root element was not found");
createRoot(root).render(<StrictMode><ClassroomApp /></StrictMode>);
