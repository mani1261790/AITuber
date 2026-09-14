import type { StageTarget } from "@aituber/presentation";

export function DiagramView({ target }: { target: StageTarget }) {
  if (target.id === "target.math.graph") return <VertexGraph />;
  if (target.id === "target.math.complete-graph") return <CompletedSquareGraph />;
  return <span className="target-content">{target.content}</span>;
}

function VertexGraph() {
  return <svg className="lesson-diagram" viewBox="0 0 520 260" role="img" aria-label="頂点hコンマkと対称軸xイコールhを示す放物線">
    <title>頂点と対称軸</title>
    <g className="graph-grid"><path d="M40 210H490M90 235V25" /><path d="M40 160H490M40 110H490M40 60H490M140 235V25M190 235V25M240 235V25M290 235V25M340 235V25M390 235V25M440 235V25" /></g>
    <path className="graph-axis" d="M40 210H490M90 235V25" />
    <path className="graph-symmetry" d="M290 28V230" />
    <path className="graph-curve" d="M165 38 Q290 345 415 38" />
    <circle className="graph-point" cx="290" cy="192" r="7" />
    <g className="graph-labels"><text x="300" y="186">頂点 (h, k)</text><text x="302" y="48">x = h</text><text x="475" y="230">x</text><text x="70" y="35">y</text></g>
  </svg>;
}

function CompletedSquareGraph() {
  return <svg className="lesson-diagram" viewBox="0 0 520 260" role="img" aria-label="yイコールx二乗を右へ2、下へ1移動するグラフ">
    <title>平方完成で分かるグラフの移動</title>
    <defs><marker id="shift-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" /></marker></defs>
    <g className="graph-grid"><path d="M35 150H490M170 235V20" /><path d="M35 100H490M35 50H490M60 235V20M115 235V20M225 235V20M280 235V20M335 235V20M390 235V20M445 235V20" /></g>
    <path className="graph-axis" d="M35 150H490M170 235V20" />
    <path className="graph-curve graph-curve--origin" d="M85 20 Q170 280 255 20" />
    <path className="graph-symmetry" d="M280 35V230" />
    <path className="graph-curve" d="M195 60 Q280 320 365 60" />
    <path className="graph-shift" d="M178 157L270 192" markerEnd="url(#shift-arrow)" />
    <circle className="graph-point graph-point--origin" cx="170" cy="150" r="5" /><circle className="graph-point" cx="280" cy="190" r="7" />
    <g className="graph-labels"><text x="78" y="35">y = x²</text><text x="290" y="82">y = (x−2)²−1</text><text x="210" y="164">右へ2</text><text x="218" y="182">下へ1</text><text x="292" y="212">(2, −1)</text></g>
  </svg>;
}
